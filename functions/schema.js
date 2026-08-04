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
];

export const findingsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "totals", "occurrenceTable"],
  properties: {
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
            required: ["billQuote", "eobQuote"],
            properties: {
              billQuote: { type: "string" },
              eobQuote: { type: "string" },
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
        required: ["code", "description", "count", "unitCharges"],
        properties: {
          code: { type: "string" },
          description: { type: "string" },
          count: { type: "integer" },
          unitCharges: { type: "array", items: { type: "number" } },
        },
      },
    },
  },
};
