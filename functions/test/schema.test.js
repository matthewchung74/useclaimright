import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { findingsSchema, computeAtStake, verifyEvidence, linesIn } from "../schema.js";

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(findingsSchema);

const validResult = {
  serviceDates: ["2026-06-12"],
  provider: "St. Verification General Hospital",
  payerRemarks: [],
  accumulators: {
    deductibleToDate: null, deductibleLimit: null, oopToDate: null, oopLimit: null,
    deductibleAppliedThisClaim: null,
  },
  findings: [
    {
      type: "duplicate_charge",
      lineRef: "Bill lines 4 and 7",
      description: "CPT 80053 billed twice on the same date of service.",
      amountAtStake: 145.5,
      confidence: "high",
      evidence: { billQuote: "80053 COMPREHENSIVE METABOLIC PANEL 145.50", eobQuote: "80053 allowed 41.20", sbcQuote: "" },
    },
  ],
  totals: { billed: 2300, eobAllowed: 900, patientResponsibility: 250, totalAtStake: 145.5 },
  occurrenceTable: [
    { code: "80053", description: "Comprehensive metabolic panel", count: 2, unitCharges: [145.5, 145.5], dates: ["2026-06-12"] },
  ],
};

test("valid findings object passes the schema", () => {
  assert.equal(validate(validResult), true, ajv.errorsText(validate.errors));
});

test("unknown finding type is rejected", () => {
  const bad = structuredClone(validResult);
  bad.findings[0].type = "made_up_type";
  assert.equal(validate(bad), false);
});

test("missing evidence is rejected", () => {
  const bad = structuredClone(validResult);
  delete bad.findings[0].evidence;
  assert.equal(validate(bad), false);
});

test("non-numeric amount is rejected", () => {
  const bad = structuredClone(validResult);
  bad.findings[0].amountAtStake = "$145.50";
  assert.equal(validate(bad), false);
});

test("extra top-level properties are rejected", () => {
  const bad = structuredClone(validResult);
  bad.extra = true;
  assert.equal(validate(bad), false);
});

test("empty findings with zeroed totals is valid (unreadable-document case)", () => {
  const empty = {
    serviceDates: [],
    provider: "",
    payerRemarks: [],
    accumulators: { deductibleToDate: null, deductibleLimit: null, oopToDate: null, oopLimit: null, deductibleAppliedThisClaim: null },
    findings: [],
    totals: { billed: 0, eobAllowed: 0, patientResponsibility: 0, totalAtStake: 0 },
    occurrenceTable: [],
  };
  assert.equal(validate(empty), true, ajv.errorsText(validate.errors));
});

test("stated accumulators validate as numbers", () => {
  const withAcc = structuredClone(validResult);
  withAcc.accumulators = { deductibleToDate: 720, deductibleLimit: 1500, oopToDate: 900, oopLimit: 6000, deductibleAppliedThisClaim: 120 };
  withAcc.payerRemarks = ["BENEFIT MAXIMUM REACHED: your plan covers 6 outpatient mental health visits per calendar year."];
  assert.equal(validate(withAcc), true, ajv.errorsText(validate.errors));
});

// --- computeAtStake ---

test("E1: charity care is excluded from the at-stake total", () => {
  // The live regression: a run returned $990.50 — $804.15 plus the $186.35
  // charity figure, which IS the patient responsibility and so double-counts it.
  const findings = [
    { type: "duplicate_charge", amountAtStake: 145.5 },
    { type: "billed_vs_allowed_mismatch", amountAtStake: 658.65 },
    { type: "charity_care_eligible", amountAtStake: 186.35 },
  ];
  assert.equal(Number(computeAtStake(findings).toFixed(2)), 804.15);
});

test("computeAtStake sums plan findings and tolerates missing amounts", () => {
  assert.equal(computeAtStake([
    { type: "billed_vs_allowed_mismatch", amountAtStake: 115 },
    { type: "copay_mismatch", amountAtStake: 35 },
  ]), 150);
  assert.equal(computeAtStake([{ type: "wrong_code", amountAtStake: null }]), 0);
  assert.equal(computeAtStake([]), 0);
  assert.equal(computeAtStake(undefined), 0);
});

test("an all-advisory audit is worth $0 to dispute", () => {
  assert.equal(computeAtStake([{ type: "charity_care_eligible", amountAtStake: 186.35 }]), 0);
});

// --- de-overlap (live regression 2026-08-25) ---

test("E6: a finding inside another's line span is not added again", () => {
  // The live failure: $2,115.00 billed, $2,260.50 "worth disputing". not_in_eob
  // covered the whole bill and duplicate_charge covered one line inside it.
  const findings = [
    { type: "duplicate_charge", lineRef: "Line 2", amountAtStake: 145.5 },
    { type: "not_in_eob", lineRef: "Line 1 - Line 6", amountAtStake: 2115 },
    { type: "charity_care_eligible", lineRef: "Header", amountAtStake: 845 },
  ];
  assert.equal(computeAtStake(findings, 2115), 2115);
});

test("findings on separate lines still sum", () => {
  // The de-overlap must not eat real money: different lines, nothing contained.
  const findings = [
    { type: "duplicate_charge", lineRef: "Line 2", amountAtStake: 145.5 },
    { type: "billed_vs_allowed_mismatch", lineRef: "Line 4", amountAtStake: 658.65 },
  ];
  assert.equal(Number(computeAtStake(findings, 845).toFixed(2)), 804.15);
});

test("the total never exceeds what was billed", () => {
  const findings = [
    { type: "duplicate_charge", lineRef: "Line 1", amountAtStake: 400 },
    { type: "wrong_code", lineRef: "Line 2", amountAtStake: 400 },
  ];
  assert.equal(computeAtStake(findings, 500), 500);
  // ...and with no billed figure to cap against, it is left alone.
  assert.equal(computeAtStake(findings), 800);
});

test("an unreadable lineRef is never de-overlapped", () => {
  // "Header" parses to nothing, so it can neither contain nor be contained.
  const findings = [
    { type: "not_in_eob", lineRef: "Line 1 - Line 6", amountAtStake: 300 },
    { type: "wrong_code", lineRef: "Header", amountAtStake: 50 },
  ];
  assert.equal(computeAtStake(findings, 2000), 350);
});

test("linesIn parses the shapes the model actually emits", () => {
  assert.deepEqual([...linesIn("Line 2")], [2]);
  assert.deepEqual([...linesIn("Line 1 - Line 6")], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...linesIn("Lines 3-4")], [3, 4]);
  assert.deepEqual([...linesIn("Header")], []);
  assert.deepEqual([...linesIn(undefined)], []);
  // A runaway span is refused rather than expanded.
  assert.deepEqual([...linesIn("Line 1 - 99999")], []);
});

// --- verifyEvidence ---
// A quote that is not in the document is a fabrication. computeAtStake exists
// because the model's arithmetic was not trusted; these cover the same distrust
// applied to the quotes the arithmetic rests on.

const BILL = `ST. VERIFICATION GENERAL HOSPITAL
80053  COMPREHENSIVE METABOLIC PANEL      145.50
80053  COMPREHENSIVE METABOLIC PANEL      145.50`;
const EOB = `Claim 2026-06-12
80053 allowed 41.20   patient responsibility 0.00`;
const SBC = `Specialist visit: $60 copay per visit`;
const SRC = { bill: BILL, eob: EOB, sbc: SBC };

const finding = (evidence, over = {}) => ({
  type: "duplicate_charge", lineRef: "Bill lines 2 and 3",
  description: "billed twice", amountAtStake: 145.5, confidence: "high",
  evidence: { billQuote: "", eobQuote: "", sbcQuote: "", ...evidence },
  ...over,
});
const resultWith = (...findings) => ({
  ...structuredClone(validResult), findings,
  totals: { billed: 2300, eobAllowed: 900, patientResponsibility: 250, totalAtStake: computeAtStake(findings) },
});

test("a quote present verbatim is kept", () => {
  const r = verifyEvidence(resultWith(finding({ billQuote: "80053  COMPREHENSIVE METABOLIC PANEL      145.50" })), SRC);
  assert.equal(r.result.findings.length, 1);
  assert.equal(r.dropped.length, 0);
});

test("whitespace and line-break variance still matches", () => {
  const r = verifyEvidence(resultWith(finding({ billQuote: "80053 COMPREHENSIVE METABOLIC PANEL 145.50" })), SRC);
  assert.equal(r.result.findings.length, 1);
});

test("case variance still matches", () => {
  const r = verifyEvidence(resultWith(finding({ billQuote: "80053 comprehensive metabolic panel 145.50" })), SRC);
  assert.equal(r.result.findings.length, 1);
});

test("a fabricated quote drops the finding", () => {
  const r = verifyEvidence(resultWith(finding({ billQuote: "99285 EMERGENCY DEPARTMENT VISIT 2400.00" })), SRC);
  assert.equal(r.result.findings.length, 0);
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0].field, "billQuote");
});

test('an empty quote is not a claim, so it is skipped', () => {
  // sbcQuote is "" on every non-plan finding — that must not read as unverifiable.
  const r = verifyEvidence(resultWith(finding({ eobQuote: "80053 allowed 41.20" })), SRC);
  assert.equal(r.result.findings.length, 1);
});

test("all three quote fields are checked, not just the bill", () => {
  const eobLie = verifyEvidence(resultWith(finding({ eobQuote: "80053 allowed 999.99" })), SRC);
  assert.equal(eobLie.dropped[0].field, "eobQuote");
  const sbcLie = verifyEvidence(resultWith(finding({ sbcQuote: "Specialist visit: $10 copay per visit" })), SRC);
  assert.equal(sbcLie.dropped[0].field, "sbcQuote");
});

test("a finding quoting a document that was never uploaded is dropped", () => {
  const r = verifyEvidence(resultWith(finding({ eobQuote: "80053 allowed 41.20" })), { bill: BILL, eob: "", sbc: "" });
  assert.equal(r.result.findings.length, 0);
});

test("the at-stake total is re-derived from what survives", () => {
  const real = finding({ billQuote: "80053 COMPREHENSIVE METABOLIC PANEL 145.50" });
  const fake = finding({ billQuote: "99285 EMERGENCY DEPARTMENT VISIT 2400.00" }, { amountAtStake: 2400 });
  const r = verifyEvidence(resultWith(real, fake), SRC);
  assert.equal(r.result.findings.length, 1);
  assert.equal(r.result.totals.totalAtStake, 145.5); // not 2545.50
});

test("a clean result is returned untouched", () => {
  const input = resultWith(finding({ billQuote: "80053 COMPREHENSIVE METABOLIC PANEL 145.50" }));
  const r = verifyEvidence(input, SRC);
  assert.equal(r.result, input); // same reference — no needless copy
});

// --- verifyEvidence: the cases a scanned document actually produces ---
// Both of these were observed on the first live run against a rasterized
// fixture, and exact containment dropped both. They are TRUE findings.

test("a quote composed from two separate lines is supported", () => {
  // Observed: the model proved a duplicate by quoting both lines as one string.
  // Every token is in the bill; only the contiguity is the model's.
  const composed = "1 80053 Comprehensive metabolic panel 1 $145.50 / 2 80053 Comprehensive metabolic panel 1 $145.50";
  const r = verifyEvidence(resultWith(finding({ billQuote: composed })), SRC);
  assert.equal(r.result.findings.length, 1, "a composed quote is not a fabrication");
});

test("a quote that tidies OCR noise is supported", () => {
  // Observed: the model silently corrected a mangled character. Demanding the
  // mangling back is demanding the model reproduce a scanning artifact.
  const ocr = "What you may owe the provider: $186.35 (deductibie $50.00 + coinsurance)";
  const clean = "What you may owe the provider: $186.35 (deductible $50.00 + coinsurance)";
  const r = verifyEvidence(resultWith(finding({ eobQuote: clean })), { bill: BILL, eob: ocr, sbc: "" });
  assert.equal(r.result.findings.length, 1);
});

test("real numbers with an invented description are still dropped", () => {
  // The failure mode the looser match must NOT let through: the amounts are
  // lifted from the bill, the service is imagined.
  const r = verifyEvidence(resultWith(finding({ billQuote: "80053 emergency department visit 145.50" })), SRC);
  assert.equal(r.result.findings.length, 0);
  assert.equal(r.dropped[0].field, "billQuote");
});

test("a near-miss on the amount is dropped", () => {
  // One digit different is the whole finding: $41.20 allowed is not $999.99.
  const r = verifyEvidence(resultWith(finding({ eobQuote: "80053 allowed 999.99" })), SRC);
  assert.equal(r.result.findings.length, 0);
});

test("a quote with no numbers at all needs its wording to hold up", () => {
  const ok = verifyEvidence(resultWith(finding({ eobQuote: "patient responsibility" })), SRC);
  assert.equal(ok.result.findings.length, 1);
  const no = verifyEvidence(resultWith(finding({ eobQuote: "prior authorization was never obtained" })), SRC);
  assert.equal(no.result.findings.length, 0);
});

test("verifyEvidence: no source text keeps findings instead of zeroing the audit", () => {
  // The main path: a PDF is sent as pages, so the model's billText is the only
  // bill text there is — and the schema does not require it. When it is absent
  // the old code dropped every quoted finding and re-derived the total to $0,
  // which reads as a confident "no discrepancies found" on a real dispute.
  const result = {
    findings: [
      { type: "not_in_eob", lineRef: "1", amountAtStake: 175,
        evidence: { billQuote: "90837 Psychotherapy 60 minutes $175.00" } },
    ],
    totals: { billed: 175, totalAtStake: 175 },
  };
  const v = verifyEvidence(result, { bill: "", eob: "", sbc: "", supplied: { bill: true } });
  assert.equal(v.result.findings.length, 1, "the finding survives an unavailable source");
  assert.equal(v.result.totals.totalAtStake, 175, "the total is not re-derived to zero");
  assert.equal(v.dropped.length, 0);
  assert.equal(v.unverifiable.length, 1, "and the audit records that it went unchecked");
});

test("verifyEvidence: an invented quote is still dropped when there IS a source", () => {
  const result = {
    findings: [
      { type: "not_in_eob", lineRef: "1", amountAtStake: 999,
        evidence: { billQuote: "99999 Cranial reattachment $9,999.00" } },
    ],
    totals: { billed: 175, totalAtStake: 999 },
  };
  const v = verifyEvidence(result, { bill: "90837 Psychotherapy 60 minutes $175.00", eob: "", sbc: "", supplied: { bill: true } });
  assert.equal(v.result.findings.length, 0);
  assert.equal(v.dropped.length, 1);
});

test("verifyEvidence: a quote from a document that was never supplied is still dropped", () => {
  // The distinction that makes the fail-open safe: "we hold no text for a
  // document you gave us" is not the same as "you never gave us that document".
  const result = {
    findings: [
      { type: "billed_above_eob", lineRef: "1", amountAtStake: 40,
        evidence: { eobQuote: "80053 allowed $41.20" } },
    ],
    totals: { billed: 175, totalAtStake: 40 },
  };
  const v = verifyEvidence(result, { bill: "90837 $175.00", eob: "", sbc: "", supplied: { bill: true } });
  assert.equal(v.result.findings.length, 0, "no EOB was uploaded, so the quote is invented");
  assert.equal(v.dropped.length, 1);
});
