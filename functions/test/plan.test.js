import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { FINDING_TYPES, findingsSchema } from "../schema.js";

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
