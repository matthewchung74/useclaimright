import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { FINDING_TYPES, findingsSchema } from "../schema.js";
import { planApplies, mergeSbcTrackers, deductibleTarget, planYearStartMonthFrom } from "../../web/js/plan.js";

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
