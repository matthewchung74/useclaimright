import { GoogleGenAI } from "@google/genai";
import { findingsSchema } from "../schema.js";

const AUDIT_INSTRUCTIONS = `You are a medical billing auditor. You receive the de-identified text of
a patient's itemized medical bill and the matching insurance Explanation of Benefits (EOB).
Personal identifiers have been replaced with placeholders like [NAME_1], [DOB], [MRN] — treat them
as opaque tokens. Provider, hospital, and insurer names are real.

Your job, in order:
1. Extract every charge line from the bill: code (CPT/HCPCS/revenue code if present), description,
   quantity, and amount. Build the occurrenceTable: one row per distinct code with its count and
   each unit charge observed.
2. Cross-check the bill against the EOB: billed vs allowed amounts, patient responsibility,
   services on the bill missing from the EOB, cost-sharing arithmetic.
3. Report findings using ONLY these types:
   - duplicate_charge: the same service billed more times than plausibly performed
   - unbundling: services billed separately that standard coding bundles together
   - wrong_code: code and description clearly inconsistent
   - billed_vs_allowed_mismatch: patient billed above the EOB allowed/member-responsibility amount
   - not_in_eob: a billed service absent from the EOB
   - cost_share_error: deductible/copay/coinsurance math on the EOB does not add up
   - charity_care_eligible: signals the provider is a nonprofit hospital (501r financial assistance may apply)

Hard rules:
- Every finding MUST include verbatim evidence quotes from the bill and the EOB (use "" for the EOB
  quote only when the finding type is not_in_eob and nothing corresponds).
- amountAtStake is the dollar amount supported by the quoted lines. Never estimate beyond the documents.
- If you are not sure, use confidence "low" rather than omitting a real concern — but NEVER invent
  a line item, amount, or code that does not appear in the text.
- If the documents are unreadable or clearly not a bill/EOB, return an empty findings array and
  zeroed totals rather than guessing.`;

// Provider adapter contract: runAudit(redactedBill, redactedEob, opts) -> validated-shape object.
// Swapping providers means adding a sibling file with the same signature.
export async function runAudit(redactedBill, redactedEob, { modelId, apiKey }) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: modelId,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${AUDIT_INSTRUCTIONS}\n\n===== ITEMIZED BILL =====\n${redactedBill}\n\n===== EOB =====\n${redactedEob}`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: findingsSchema,
      temperature: 0,
    },
  });
  return JSON.parse(response.text);
}
