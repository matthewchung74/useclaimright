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
   As part of this, ADD UP the EOB's own per-line patient-responsibility amounts and compare
   that sum against the single total the EOB states the patient owes. When the two disagree,
   the insurer's own arithmetic is wrong: report cost_share_error with amountAtStake set to the
   difference, and quote both the line amounts and the stated total as evidence. This is money
   the member may not owe no matter what the provider billed, so it is a finding in its own
   right rather than something to fold into billed_vs_allowed_mismatch. Only report it when
   BOTH the per-line amounts and the stated total are actually printed on the EOB — never infer
   or reconstruct either figure.
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
- statementId: the identifier printed on the BILL that names this statement — "Account #",
  "Statement #", "Invoice #", "Bill #" or equivalent, copied exactly as printed including any
  prefix. This identifies the piece of paper, not the visit. Do NOT substitute the member ID,
  the MRN, the claim number, or a date. Empty string if the bill prints no such number.
- patientName: the person the BILL is for, exactly as printed. Take it from the patient
  field, never the guarantor, subscriber or responsible party — on a child's bill those
  name a parent. Empty string if the bill does not say.
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

// Output is billed at five times input, and nothing bounded it. A transcription
// plus findings runs ~2k tokens; this is generous room above that, and a hard
// stop under a model that decides to think at length.
// Output is billed at five times input, so it needs a ceiling — but a flat one is
// the wrong shape, because what the model must WRITE scales with how many pages
// it had to READ. A document sent as images must be transcribed back; one sent as
// text need not be.
//
// A five-page scanned SBC overran a flat 8192 and failed with "produced more
// output than we can handle", so a photographed plan — every plan anyone scans —
// could not be extracted at all. The audit path has the same shape and allows up
// to MAX_PAGES (20) images under that same flat ceiling, so it was one long
// document away from the identical failure.
//
// A ceiling, not a budget: only a document that genuinely has that much printed
// on it ever reaches it. Verified 2026-08-31 against a 110dpi render of
// cms-2025.pdf, whose five pages yielded 15 verbatim cost-share rows.
const outputCeiling = (pageCount) => Math.min(65536, 8192 + 3072 * (pageCount || 0));

// A response cut off mid-JSON is not retryable. It fails schema validation, the
// retry sends the SAME oversized request, and a ceiling meant to cap cost
// doubles it instead. Detect the truncation and stop.
function assertComplete(response) {
  const reason = response?.candidates?.[0]?.finishReason;
  if (reason === "MAX_TOKENS") {
    const err = new Error("Model response hit the output ceiling and was truncated.");
    err.terminal = true;
    throw err;
  }
}

// Token counts as the API reports them. Null rather than 0 when absent, so a
// provider that reports nothing is distinguishable from a genuinely free call.
const usageOf = (response) => ({
  input: response?.usageMetadata?.promptTokenCount ?? null,
  output: response?.usageMetadata?.candidatesTokenCount ?? null,
  total: response?.usageMetadata?.totalTokenCount ?? null,
});

const IMAGE_NOTE = `Some documents below are attached as page images instead of text. Read them.
For each one supplied as images, also return what you read: the bill's full text in billText
and the EOB's in eobText, verbatim, including headers and line items. Every evidence quote you
give must appear either in the text supplied to you or in the text you return.`;

const PATIENT_NOTE = `Return patientName as the person the BILL is for, and eobPatients as the
list of people the EOB's CLAIMS are for — one name per claim, however many there are. Read
eobPatients from the claim lines only, NOT from the subscriber or policyholder block: a family
statement names the subscriber once at the top and a different patient on each claim, and those
are not the same question. If the EOB is for one person, eobPatients has one entry. If no EOB was
supplied, return an empty array.`;

// Each document arrives as text or as page images, and the two combine freely —
// a photographed bill against a downloaded EOB is an ordinary upload.
//
// This used to branch once for the whole request: if ANYTHING was an image, the
// text branch was skipped and every text document was silently dropped. A
// photographed bill with a text EOB therefore reached the model with no EOB at
// all, which it correctly reported as "missing from the EOB" — inflating
// "worth disputing" by the whole bill, with no error anywhere. Found by running
// S1 on production 2026-08-25.
//
// Exported for tests: the assembly is the part worth checking, not the API call.
export function buildAuditParts(bill, eob, instructions) {
  const parts = [{ text: instructions }];
  const addDoc = (label, doc) => {
    const images = doc?.images || [];
    if (images.length) {
      parts.push({ text: `\n===== ${label} — ${images.length} page image(s) follow =====` });
      for (const data of images) parts.push({ inlineData: { mimeType: "image/jpeg", data } });
    } else if (doc?.text?.trim()) {
      parts.push({ text: `\n===== ${label} =====\n${doc.text}` });
    }
  };
  addDoc("ITEMIZED BILL", bill);
  addDoc("EOB", eob);
  return parts;
}

// Which Google endpoint the same model is reached through.
//
// The Gemini DEVELOPER API (an AI Studio key) and VERTEX AI serve the same
// models but sit under different terms. The developer API's data handling turns
// on whether billing is enabled on the key's project — and that project is not
// this one, so a promise the app makes to members ("not used for training")
// rests on a billing toggle in a project nobody looks at. Vertex authenticates
// as this function's own service account, is covered by Google Cloud's HIPAA
// BAA, and makes the data terms contractual rather than incidental.
//
// Defaults to vertex; "developer" rolls back to the AI Studio key.
function makeClient({ apiKey, backend, project, location }) {
  if (backend === "vertex") {
    // No API key: Application Default Credentials, i.e. the runtime service
    // account. GOOGLE_CLOUD_PROJECT is set for us in the Functions runtime.
    return new GoogleGenAI({
      vertexai: true,
      project: project || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
      location: location || "global",
    });
  }
  return new GoogleGenAI({ apiKey });
}

// Provider adapter contract: runAudit(bill, eob, opts)
//   -> { data: validated-shape object, usage: {input, output, total} }.
// Swapping providers means adding a sibling file with the same signature.
export async function runAudit(bill, eob, opts, planDigest = null) {
  const { modelId } = opts;
  const ai = makeClient(opts);
  const billImages = bill.images || [];
  const eobImages = eob.images || [];
  const asImages = billImages.length > 0 || eobImages.length > 0;

  let instructions = AUDIT_INSTRUCTIONS + (planDigest ? planTermsBlock(planDigest) : "");
  if (!eob.text?.trim() && !eobImages.length) instructions += `\n\n${BILL_ONLY_NOTE}`;
  if (asImages) instructions += `\n\n${IMAGE_NOTE}`;
  instructions += `\n\n${PATIENT_NOTE}`;

  const parts = buildAuditParts(bill, eob, instructions);

  const response = await ai.models.generateContent({
    model: modelId,
    contents: [{ role: "user", parts }],
    config: {
      temperature: 0,
      maxOutputTokens: outputCeiling(billImages.length + eobImages.length),
      responseMimeType: "application/json",
      responseJsonSchema: findingsSchema,
    },
  });
  assertComplete(response);
  return { data: JSON.parse(response.text), usage: usageOf(response) };
}

export async function runPlanExtract(sbc, opts) {
  const { modelId } = opts;
  const ai = makeClient(opts);
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
      maxOutputTokens: outputCeiling(images.length),
    },
  });
  assertComplete(response);
  return { data: JSON.parse(response.text), usage: usageOf(response) };
}
