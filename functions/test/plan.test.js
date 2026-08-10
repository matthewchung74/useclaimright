import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { FINDING_TYPES, findingsSchema } from "../schema.js";
import { planApplies, mergeSbcTrackers, deductibleTarget, planYearStartMonthFrom } from "../../web/js/plan.js";
import { planSchema, buildDigest, replaceDecision, planTermsBlock, applyPlanGate } from "../plan.js";

const ajv = new Ajv({ allErrors: true });

test("schema v3: plan finding types exist", () => {
  for (const t of ["copay_mismatch", "coinsurance_mismatch", "deductible_misapplied", "not_covered_per_plan"]) {
    assert.ok(FINDING_TYPES.includes(t), `${t} missing`);
  }
});

test("schema v3: a plan finding with sbcQuote validates; missing sbcQuote fails", () => {
  const validate = ajv.compile(findingsSchema);
  const base = {
    serviceDates: ["2026-03-20"], provider: "Testville PT", payerRemarks: [],
    accumulators: { deductibleToDate: null, deductibleLimit: null, oopToDate: null, oopLimit: null, deductibleAppliedThisClaim: null },
    totals: { billed: 120, eobAllowed: 120, patientResponsibility: 120, totalAtStake: 60 },
    occurrenceTable: [{ code: "97110", description: "Therapeutic exercise", count: 1, unitCharges: [120], dates: ["2026-03-20"] }],
    findings: [{
      type: "copay_mismatch", lineRef: "97110",
      description: "Bill applies $120.00 where your plan says a $60 copay.",
      amountAtStake: 60, confidence: "medium",
      evidence: { billQuote: "97110 Therapeutic exercise $120.00", eobQuote: "", sbcQuote: "Rehabilitation services — $60 copay/visit, deductible does not apply" },
    }],
  };
  assert.equal(validate(base), true, ajv.errorsText(validate.errors));
  delete base.findings[0].evidence.sbcQuote;
  assert.equal(validate(base), false, "sbcQuote must be required");
});

const PLAN = { planYearStart: "2026-01-01", planYearEnd: "2026-12-31", deductible: { individual: 1500, family: null } };

test("planApplies: in-window date applies; all-out dates do not; no plan / no dates reported", () => {
  assert.deepEqual(planApplies(["2026-03-20"], PLAN), { applies: true, reason: null });
  assert.deepEqual(planApplies(["2025-11-02"], PLAN), { applies: false, reason: "out_of_period" });
  assert.deepEqual(planApplies(["2026-03-20"], null), { applies: false, reason: "no_plan" });
  assert.deepEqual(planApplies([], PLAN), { applies: false, reason: "no_dates" });
  // mixed dates: any in-window date applies
  assert.equal(planApplies(["2025-12-30", "2026-01-02"], PLAN).applies, true);
  // boundary dates are inclusive on both ends
  assert.equal(planApplies(["2026-01-01"], PLAN).applies, true);
  assert.equal(planApplies(["2026-12-31"], PLAN).applies, true);
  // garbage date strings never apply
  assert.equal(planApplies(["not-a-date"], PLAN).applies, false);
  // a plan missing either bound cannot be applied
  assert.deepEqual(planApplies(["2026-03-20"], { planYearStart: "2026-01-01", planYearEnd: null }), { applies: false, reason: "no_plan" });
});

test("mergeSbcTrackers: creates new, updates sbc-sourced, never touches manual", () => {
  const limits = [{ label: "Outpatient mental health", codesHint: ["90832", "90834", "90837"], visitsPerYear: 6 }];
  const fresh = mergeSbcTrackers([], limits, 1);
  assert.equal(fresh.create.length, 1);
  assert.deepEqual(fresh.create[0], { label: "Outpatient mental health", codes: ["90832", "90834", "90837"], limit: 6, planYearStartMonth: 1, source: "sbc" });
  // manual tracker with overlapping codes blocks creation
  const manual = [{ id: "m1", label: "Therapy", codes: ["90837"], limit: 6 }];
  assert.deepEqual(mergeSbcTrackers(manual, limits, 1), { create: [], update: [] });
  // sbc-sourced tracker with overlapping codes gets updated in place
  const sbcOwned = [{ id: "s1", label: "Old label", codes: ["90837"], limit: 5, source: "sbc" }];
  const upd = mergeSbcTrackers(sbcOwned, limits, 1);
  assert.equal(upd.create.length, 0);
  assert.deepEqual(upd.update, [{ id: "s1", changes: { label: "Outpatient mental health", codes: ["90832", "90834", "90837"], limit: 6 } }]);
  // a limit without visitsPerYear or codes creates nothing
  assert.deepEqual(mergeSbcTrackers([], [{ label: "X", codesHint: [], visitsPerYear: null }], 1), { create: [], update: [] });
  // two SBC rows sharing a code must not create two overlapping trackers
  const twoRows = mergeSbcTrackers([], [
    { label: "Mental health", codesHint: ["90837"], visitsPerYear: 6 },
    { label: "Therapy visits", codesHint: ["90837", "90834"], visitsPerYear: 6 },
  ], 1);
  assert.equal(twoRows.create.length, 1);
  // code matching is case/whitespace-insensitive
  const ci = mergeSbcTrackers([{ id: "m1", label: "T", codes: [" 90837 "], limit: 6 }],
    [{ label: "MH", codesHint: ["90837"], visitsPerYear: 6 }], 1);
  assert.deepEqual(ci, { create: [], update: [] });
});

test("deductibleTarget: SBC owns the limit; EOB fills gaps; conflict when both differ > $1", () => {
  assert.deepEqual(deductibleTarget(PLAN, null), { limit: 1500, source: "sbc", conflict: false });
  assert.deepEqual(deductibleTarget(null, { deductibleLimit: 1500 }), { limit: 1500, source: "eob", conflict: false });
  assert.deepEqual(deductibleTarget(PLAN, { deductibleLimit: 2000 }), { limit: 1500, source: "sbc", conflict: true });
  assert.deepEqual(deductibleTarget(PLAN, { deductibleLimit: 1500.5 }), { limit: 1500, source: "sbc", conflict: false });
  assert.deepEqual(deductibleTarget(null, null), { limit: null, source: null, conflict: false });
  // family-only SBC deductible (individual null): individual target intentionally stays null/EOB-sourced
  assert.deepEqual(deductibleTarget({ deductible: { individual: null, family: 3000 } }, { deductibleLimit: 1500 }),
    { limit: 1500, source: "eob", conflict: false });
});

test("planYearStartMonthFrom: extracts month, defaults to 1", () => {
  assert.equal(planYearStartMonthFrom("2026-07-01"), 7);
  assert.equal(planYearStartMonthFrom(null), 1);
  assert.equal(planYearStartMonthFrom("garbage"), 1);
});

const STRUCTURED = {
  planName: "Acme Silver PPO", planYearStart: "2026-01-01", planYearEnd: "2026-12-31",
  deductible: { individual: 1500, family: 3000 }, oopMax: { individual: 6000, family: 12000 },
  limits: [{ label: "Outpatient mental health", codesHint: ["90837"], visitsPerYear: 6 }],
  costShares: [{ category: "Rehabilitation services", verbatim: "Rehabilitation services — $60 copay/visit, deductible does not apply", copay: 60, coinsurancePct: null, deductibleApplies: false }],
};

test("planSchema validates the structured shape; rejects extra properties", () => {
  const validate = new Ajv({ allErrors: true }).compile(planSchema);
  assert.equal(validate(STRUCTURED), true, new Ajv().errorsText(validate?.errors));
  assert.equal(validate({ ...STRUCTURED, bogus: 1 }), false);
});

const ALL_NULL = {
  planName: null, planYearStart: null, planYearEnd: null,
  deductible: { individual: null, family: null }, oopMax: { individual: null, family: null },
  limits: [], costShares: [],
};

test("planSchema ACCEPTS an all-null plan — the not-an-SBC gate depends on this", () => {
  // A junk upload makes the model return nulls; validation must pass so the
  // callable can reject with the clean "doesn't look like an SBC" message
  // instead of a confusing "invalid output" error.
  const validate = new Ajv({ allErrors: true }).compile(planSchema);
  assert.equal(validate(ALL_NULL), true);
});

test("buildDigest survives an all-null plan without crashing", () => {
  const d = buildDigest(ALL_NULL);
  assert.equal(typeof d, "string");
  assert.ok(d.includes("not stated"));
});

test("buildDigest is deterministic, contains verbatim rows and key numbers, caps at 2000 chars", () => {
  const d1 = buildDigest(STRUCTURED), d2 = buildDigest(STRUCTURED);
  assert.equal(d1, d2);
  assert.ok(d1.includes("Acme Silver PPO"));
  assert.ok(d1.includes("$60 copay/visit"));
  assert.ok(d1.includes("1500"));
  assert.ok(d1.length <= 2000);
  const bloated = { ...STRUCTURED, costShares: Array.from({ length: 100 }, (_, i) => ({ category: `C${i}`, verbatim: "x".repeat(80), copay: null, coinsurancePct: null, deductibleApplies: null })) };
  assert.ok(buildDigest(bloated).length <= 2000);
});

test("replaceDecision: store fresh/newer/forced; confirm on older", () => {
  assert.equal(replaceDecision(null, STRUCTURED, false), "store");
  const older = { ...STRUCTURED, planYearStart: "2025-01-01", planYearEnd: "2025-12-31" };
  assert.equal(replaceDecision(STRUCTURED, older, false), "confirm_older");
  assert.equal(replaceDecision(STRUCTURED, older, true), "store");
  assert.equal(replaceDecision(older, STRUCTURED, false), "store"); // newer replaces older freely
  assert.equal(replaceDecision(STRUCTURED, { ...STRUCTURED, planYearStart: null }, false), "store"); // unknown period: store (upload-time warning is the client's job)
});

test("planTermsBlock fences the digest and forbids inference", () => {
  const b = planTermsBlock("DIGEST");
  assert.ok(b.includes("PLAN TERMS"));
  assert.ok(b.includes("DIGEST"));
  assert.ok(/only when the plan term is explicit/i.test(b));
});

test("planTermsBlock guards the two false-positive modes seen live", () => {
  const b = planTermsBlock("DIGEST");
  // 1. Wrong-row matching: psychotherapy matched the generic "specialist visit" row.
  assert.ok(/most specific wins/i.test(b), "must require most-specific row matching");
  assert.ok(/behavioral-health\s+codes belong to the mental-health row/i.test(b));
  assert.ok(/emit NO plan finding/i.test(b), "must require silence when the mapping is a guess");
  // 2. "after deductible" misread as "deductible does not apply".
  assert.ok(/after deductible[\s\S]*applying the charge to the deductible is CORRECT/i.test(b));
  assert.ok(/deductible_misapplied ONLY when the matched row\s*\n?explicitly states the deductible does NOT apply/i.test(b));
});

test("applyPlanGate: applies in-window (inclusive bounds), strips straggler plan findings when not applied, clamps totals", () => {
  const mk = (dates, findings = [], totalAtStake = 0) => ({
    serviceDates: dates,
    findings,
    totals: { billed: 0, eobAllowed: 0, patientResponsibility: 0, totalAtStake },
  });
  const planFinding = { type: "copay_mismatch", amountAtStake: 60 };
  const normalFinding = { type: "duplicate_charge", amountAtStake: 145.5 };

  // applies: boundary date, nothing stripped
  let r = applyPlanGate(mk(["2026-12-31"], [planFinding, normalFinding], 205.5), STRUCTURED);
  assert.equal(r.planApplied, true);
  assert.equal(r.planReason, null);
  assert.equal(r.result.findings.length, 2);

  // out of period: plan findings stripped, totalAtStake reduced
  r = applyPlanGate(mk(["2025-06-01"], [planFinding, normalFinding], 205.5), STRUCTURED);
  assert.equal(r.planApplied, false);
  assert.equal(r.planReason, "out_of_period");
  assert.deepEqual(r.result.findings, [normalFinding]);
  assert.equal(r.result.totals.totalAtStake, 145.5);

  // clamp: stragglers larger than the stated total never go negative
  r = applyPlanGate(mk(["2025-06-01"], [{ type: "deductible_misapplied", amountAtStake: 999 }], 10), STRUCTURED);
  assert.equal(r.result.totals.totalAtStake, 0);

  // no plan / no dates
  assert.equal(applyPlanGate(mk(["2026-03-01"]), null).planReason, "no_plan");
  assert.equal(applyPlanGate(mk([]), STRUCTURED).planReason, "no_dates");
});
