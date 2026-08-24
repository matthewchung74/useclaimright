import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { findingsSchema, computeAtStake, verifyEvidence } from "../schema.js";

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
