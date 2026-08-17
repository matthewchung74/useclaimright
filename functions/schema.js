// Findings schema — the discrepancy taxonomy, machine-enforced.
// Used two ways: as Gemini's responseSchema (structured output) and as the
// Ajv validation schema for whatever the model returns.

export const FINDING_TYPES = [
  "duplicate_charge",
  "unbundling",
  "wrong_code",
  "billed_vs_allowed_mismatch",
  "not_in_eob",
  "cost_share_error",
  "charity_care_eligible",
  // v3 — plan (SBC) cross-check findings
  "copay_mismatch",
  "coinsurance_mismatch",
  "deductible_misapplied",
  "not_covered_per_plan",
];

// Advisory findings: real and worth surfacing, but NOT money you may not owe.
// charity_care_eligible flags that a nonprofit hospital's financial-assistance
// program may apply — its amount IS the patient responsibility, so adding it to
// "worth disputing" double-counts the very figure it refers to.
export const ADVISORY_FINDING_TYPES = new Set(["charity_care_eligible"]);

// The at-stake total, computed from the findings rather than trusted from the
// model. The prompt never specified how to sum it, so the exclusion above held
// only by luck: one E1 run returned $990.50 (= $804.15 + the $186.35 charity
// figure) instead of $804.15.
export function computeAtStake(findings) {
  return (findings || [])
    .filter((f) => !ADVISORY_FINDING_TYPES.has(f.type))
    .reduce((sum, f) => sum + (typeof f.amountAtStake === "number" ? f.amountAtStake : 0), 0);
}

const nullableNumber = { type: ["number", "null"] };

export const findingsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "totals", "occurrenceTable", "serviceDates", "provider", "payerRemarks", "accumulators"],
  properties: {
    // v2 fields — extracted verbatim from the documents, never inferred.
    serviceDates: { type: "array", items: { type: "string" } }, // ISO YYYY-MM-DD
    provider: { type: "string" },
    payerRemarks: { type: "array", items: { type: "string" } },
    accumulators: {
      type: "object",
      additionalProperties: false,
      required: ["deductibleToDate", "deductibleLimit", "oopToDate", "oopLimit", "deductibleAppliedThisClaim"],
      properties: {
        deductibleToDate: nullableNumber,
        deductibleLimit: nullableNumber,
        oopToDate: nullableNumber,
        oopLimit: nullableNumber,
        deductibleAppliedThisClaim: nullableNumber,
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "lineRef", "description", "amountAtStake", "confidence", "evidence"],
        properties: {
          type: { type: "string", enum: FINDING_TYPES },
          lineRef: { type: "string" },
          description: { type: "string" },
          amountAtStake: { type: "number" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          evidence: {
            type: "object",
            additionalProperties: false,
            required: ["billQuote", "eobQuote", "sbcQuote"],
            properties: {
              billQuote: { type: "string" },
              eobQuote: { type: "string" },
              sbcQuote: { type: "string" }, // "" unless the finding cites the plan
            },
          },
        },
      },
    },
    totals: {
      type: "object",
      additionalProperties: false,
      required: ["billed", "eobAllowed", "patientResponsibility", "totalAtStake"],
      properties: {
        billed: { type: "number" },
        eobAllowed: { type: "number" },
        patientResponsibility: { type: "number" },
        totalAtStake: { type: "number" },
      },
    },
    occurrenceTable: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "description", "count", "unitCharges", "dates"],
        properties: {
          code: { type: "string" },
          description: { type: "string" },
          count: { type: "integer" },
          unitCharges: { type: "array", items: { type: "number" } },
          dates: { type: "array", items: { type: "string" } }, // dates of service for this code, when determinable
        },
      },
    },
  },
};
