import { GoogleGenAI } from "@google/genai";
import { findingsSchema } from "../schema.js";
import { planSchema, PLAN_EXTRACT_INSTRUCTIONS, planTermsBlock } from "../plan.js";

const AUDIT_INSTRUCTIONS = `You are a medical billing auditor. You receive the text of a patient's
itemized medical bill and the matching insurance Explanation of Benefits (EOB), as printed —
including patient names, member and account numbers, and dates of birth. Never repeat a personal
identifier in a finding: quote the charge line, not the patient header. A person named identically
in the bill and the EOB is the same person, which is how a consolidated statement is attributed.

The EOB may be a CONSOLIDATED statement covering several claims, dates, providers, or family
members. Compare the bill only against the EOB claim lines that match its provider, service dates,
and codes; ignore unrelated claims. A bill service is not_in_eob only when no claim line anywhere
in the EOB corresponds to it. Accumulators still come from the EOB's stated totals.

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

Also extract, verbatim from the documents (NEVER inferred or guessed):
- serviceDates: every distinct date of service ON THE BILL BEING AUDITED, ISO format YYYY-MM-DD.
  Statement/processing dates are NOT dates of service. When the EOB is a consolidated statement
  covering other claims, do NOT include dates that appear only on the EOB — this bill's dates only.
- provider: the billing provider or facility name.
- payerRemarks: remark or note lines mentioning benefit maximums, visit limits, coverage denials,
  or accumulator status — copied word-for-word. Empty array when none.
- accumulators (from the EOB): deductibleToDate, deductibleLimit, oopToDate, oopLimit,
  deductibleAppliedThisClaim. Each null unless the document states it as a number.
- occurrenceTable rows include dates: the dates of service for that specific code when determinable, else [].

Hard rules:
- Every finding MUST include verbatim evidence quotes from the bill and the EOB (use "" for the EOB
  quote only when the finding type is not_in_eob and nothing corresponds).
- amountAtStake is the dollar amount supported by the quoted lines. Never estimate beyond the documents.
- If you are not sure, use confidence "low" rather than omitting a real concern — but NEVER invent
  a line item, amount, or code that does not appear in the text.
- If the documents are unreadable or clearly not a bill/EOB, return an empty findings array and
  zeroed totals rather than guessing.`;

const BILL_ONLY_NOTE = `NOTE: No EOB was provided for this audit. Audit the BILL ALONE:
duplicate charges, unbundling, and code/description mismatches only. Do NOT invent
any EOB comparison — every eobQuote must be an empty string, finding types
billed_vs_allowed_mismatch / not_in_eob / cost_share_error must not appear, and set
totals.eobAllowed and totals.patientResponsibility to 0.`;

// Token counts as the API reports them. Null rather than 0 when absent, so a
// provider that reports nothing is distinguishable from a genuinely free call.
const usageOf = (response) => ({
  input: response?.usageMetadata?.promptTokenCount ?? null,
  output: response?.usageMetadata?.candidatesTokenCount ?? null,
  total: response?.usageMetadata?.totalTokenCount ?? null,
});

const IMAGE_NOTE = `The documents are attached as page images, bill first. Read them.
Also return what you read: put the bill's full text in billText and the EOB's in eobText,
verbatim, including headers and line items. Every evidence quote you give must appear in
the text you return.`;

// Provider adapter contract: runAudit(bill, eob, opts)
//   -> { data: validated-shape object, usage: {input, output, total} }.
// Swapping providers means adding a sibling file with the same signature.
export async function runAudit(bill, eob, { modelId, apiKey }, planDigest = null) {
  const ai = new GoogleGenAI({ apiKey });
  const billImages = bill.images || [];
  const eobImages = eob.images || [];
  const asImages = billImages.length > 0 || eobImages.length > 0;

  let instructions = AUDIT_INSTRUCTIONS + (planDigest ? planTermsBlock(planDigest) : "");
  if (!eob.text?.trim() && !eobImages.length) instructions += `\n\n${BILL_ONLY_NOTE}`;
  if (asImages) instructions += `\n\n${IMAGE_NOTE}`;

  const parts = [];
  if (asImages) {
    parts.push({ text: `${instructions}\n\n${billImages.length} bill page(s), then ${eobImages.length} EOB page(s).` });
    for (const data of [...billImages, ...eobImages]) {
      parts.push({ inlineData: { mimeType: "image/jpeg", data } });
    }
  } else {
    const eobSection = eob.text.trim() ? `===== EOB =====\n${eob.text}` : "";
    parts.push({ text: `${instructions}\n\n===== ITEMIZED BILL =====\n${bill.text}\n\n${eobSection}` });
  }

  const response = await ai.models.generateContent({
    model: modelId,
    contents: [{ role: "user", parts }],
    config: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: findingsSchema },
  });
  return { data: JSON.parse(response.text), usage: usageOf(response) };
}

export async function runPlanExtract(sbc, { modelId, apiKey }) {
  const ai = new GoogleGenAI({ apiKey });
  const images = sbc.images || [];
  const parts = images.length
    ? [
        { text: `${PLAN_EXTRACT_INSTRUCTIONS}\n\nThe SBC is attached as ${images.length} page image(s). Read them, and return the text you read in sourceText.` },
        ...images.map((data) => ({ inlineData: { mimeType: "image/jpeg", data } })),
      ]
    : [{ text: `${PLAN_EXTRACT_INSTRUCTIONS}\n\n===== SUMMARY OF BENEFITS =====\n${sbc.text}` }];

  const response = await ai.models.generateContent({
    model: modelId,
    contents: [{ role: "user", parts }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: planSchema,
      temperature: 0,
    },
  });
  return { data: JSON.parse(response.text), usage: usageOf(response) };
}
