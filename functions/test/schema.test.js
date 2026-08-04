import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { findingsSchema } from "../schema.js";

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(findingsSchema);

const validResult = {
  findings: [
    {
      type: "duplicate_charge",
      lineRef: "Bill lines 4 and 7",
      description: "CPT 80053 billed twice on the same date of service.",
      amountAtStake: 145.5,
      confidence: "high",
      evidence: { billQuote: "80053 COMPREHENSIVE METABOLIC PANEL 145.50", eobQuote: "80053 allowed 41.20" },
    },
  ],
  totals: { billed: 2300, eobAllowed: 900, patientResponsibility: 250, totalAtStake: 145.5 },
  occurrenceTable: [
    { code: "80053", description: "Comprehensive metabolic panel", count: 2, unitCharges: [145.5, 145.5] },
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
    findings: [],
    totals: { billed: 0, eobAllowed: 0, patientResponsibility: 0, totalAtStake: 0 },
    occurrenceTable: [],
  };
  assert.equal(validate(empty), true, ajv.errorsText(validate.errors));
});
