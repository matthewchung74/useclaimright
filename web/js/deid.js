// On-device de-identification. Three passes, most deterministic first:
//   1. LABELED-FIELD HARVEST — medical documents label their PII ("Patient:",
//      "DOB:", "MRN:", "Member ID:"). Harvest each labeled value, then replace
//      EVERY occurrence of that value across the document (names recur in
//      footers and signature lines).
//   2. OpenMed PII NER (transformers.js, ONNX) — catches unlabeled mentions.
//      transformers.js token output carries no character offsets, so spans are
//      reconstructed by walking the tokens through the chunk with a cursor.
//   3. Regex backstop — SSN / phone / email / street address, regardless of
//      what the model caught.
// Generic dates are KEPT (dates of service are audit keys); DOB is redacted
// via the labeled-field harvest. Provider/insurer names are kept — they are
// the counterparty, not patient PII.
// Placeholders are typed and numbered by first appearance; the same surface
// string maps to the same placeholder across both documents. Nothing here
// touches the network except the one-time model download (a GET of public
// weights — document text is never uploaded).

const NER_MODEL = "onnx-community/OpenMed-PII-SuperClinical-Base-184M-v1-ONNX";

// NER label → placeholder base. null = deliberately kept.
const LABEL_MAP = {
  PATIENT: "NAME", NAME: "NAME", PER: "NAME", PERSON: "NAME", STAFF: "NAME", DOCTOR: "NAME",
  DOB: "DOB", AGE: "AGE",
  DATE: null, DATE_TIME: null, TIME: null, // service/statement dates are audit keys — keep
  ID: "ID", IDNUM: "ID", MEDICALRECORD: "MRN", MRN: "MRN", ACCOUNT: "ACCOUNT",
  PHONE: "PHONE", PHONE_NUMBER: "PHONE", FAX: "PHONE", EMAIL: "EMAIL", EMAIL_ADDRESS: "EMAIL", URL: "URL",
  STREET: "ADDRESS", STREET_ADDRESS: "ADDRESS", ADDRESS: "ADDRESS", LOCATION: "ADDRESS",
  CITY: null, STATE: null, ZIP: "ZIP", ZIPCODE: "ZIP",
  SSN: "SSN", US_SSN: "SSN", HEALTHPLAN: "PLAN_ID", INSURANCE_ID: "PLAN_ID", LICENSE: "LICENSE",
  USERNAME: "ID", DEVICE: "ID", BIOID: "ID",
  HOSPITAL: null, ORGANIZATION: null, ORG: null, CLINIC: null, COMPANY: null,
};

// Labeled fields: capture the value after the label, replace it document-wide.
// [base, regex] — regex must have the value in capture group 1.
const LABELED_FIELDS = [
  ["NAME", /(?:Patient|Member|Guarantor|Subscriber|Insured|Responsible party)\s*(?:name)?\s*[:#]\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]*){0,3})/g],
  ["DOB", /(?:DOB|Date of birth|Birth\s?date)\s*[:#]?\s*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})/gi],
  ["MRN", /(?:MRN|Medical record(?:\s*(?:no|number|#))?)\s*[:#]?\s*([A-Za-z0-9-]{4,})/gi],
  ["ACCOUNT", /(?:Account|Acct)\s*(?:no|number|#)?\s*[:#]\s*([A-Za-z0-9-]{4,})/gi],
  ["PLAN_ID", /(?:Member|Policy|Subscriber|Insurance)\s*ID\s*[:#]?\s*([A-Za-z0-9-]{4,})/gi],
  ["SSN", /(?:SSN|Social security(?:\s*(?:no|number|#))?)\s*[:#]?\s*([0-9]{3}-?[0-9]{2}-?[0-9]{4})/gi],
  ["GROUP_ID", /Group\s*(?:no|number|#)?\s*[:#]\s*([A-Za-z0-9-]{3,})/gi],
];

const REGEX_BACKSTOP = [
  { base: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { base: "PHONE", re: /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g },
  { base: "EMAIL", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { base: "ADDRESS", re: /\b\d{1,5}\s+[A-Z][A-Za-z]*(?:\s+[A-Za-z]+)*\s+(?:Lane|Ln|Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Way|Drive|Dr|Court|Ct|Place|Pl|Terrace|Ter)\b\.?(?:,?\s*(?:Apt|Suite|Ste|Unit|#)\s*[A-Za-z0-9-]+)?/g },
];

let nerPipelinePromise = null;

export function loadNer(onProgress) {
  if (!nerPipelinePromise) {
    nerPipelinePromise = (async () => {
      const { pipeline } = await import(
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0"
      );
      return pipeline("token-classification", NER_MODEL, {
        dtype: "q8",
        progress_callback: onProgress,
      });
    })();
  }
  return nerPipelinePromise;
}

function normalizeLabel(raw) {
  const label = raw.replace(/^[BIES]-/, "").toUpperCase();
  if (!(label in LABEL_MAP)) return label.replace(/[^A-Z]/g, "_") || "ID";
  return LABEL_MAP[label]; // may be null = keep
}

// Shared registry so bill + EOB use consistent placeholders.
export function createRegistry() {
  return { bySurface: new Map(), counters: new Map() };
}

function placeholderFor(registry, base, surface) {
  const key = `${base} ${surface.toLowerCase().trim()}`;
  if (registry.bySurface.has(key)) return registry.bySurface.get(key);
  const n = (registry.counters.get(base) || 0) + 1;
  registry.counters.set(base, n);
  const ph = `[${base}_${n}]`;
  registry.bySurface.set(key, ph);
  return ph;
}

// transformers.js token-classification output has no char offsets. Reconstruct
// them by walking each token's text through the chunk with a cursor. Tokens
// arrive in document order; subwords are prefixed with ## (BERT) or Ġ/▁ (BPE).
function tokenSpan(chunk, cursor, word) {
  const clean = word.replace(/^##/, "").replace(/^[Ġ▁]/, "").trim();
  if (!clean) return null;
  const idx = chunk.toLowerCase().indexOf(clean.toLowerCase(), cursor);
  if (idx === -1) return null;
  return { start: idx, end: idx + clean.length };
}

const isWordChar = (c) => typeof c === "string" && /[A-Za-z0-9]/.test(c);

// A reconstructed span that cuts into a word is evidence the cursor walk
// matched the wrong occurrence: with ignore_labels:["O"] only entity tokens
// come back, so a short token is searched for across the whole chunk and can
// land almost anywhere. A live audit stored "Therape[COORDINATE_1]tic
// exercises" this way. Spans carrying real offsets are trusted as-is.
const wordAligned = (chunk, { start, end }) =>
  !(isWordChar(chunk[start - 1]) && isWordChar(chunk[start])) &&
  !(isWordChar(chunk[end]) && isWordChar(chunk[end - 1]));

function spansFromTokens(chunk, tokens) {
  const spans = [];
  let cursor = 0;
  for (const t of tokens) {
    let start = t.start, end = t.end, reconstructed = false;
    if (typeof start !== "number" || typeof end !== "number" || end <= start) {
      const s = tokenSpan(chunk, cursor, t.word ?? "");
      if (!s) continue;
      start = s.start; end = s.end; reconstructed = true;
    }
    cursor = Math.max(cursor, end);
    const rawLabel = (t.entity || t.entity_group || "").replace(/^[BIES]-/, "");
    const last = spans[spans.length - 1];
    // Merge adjacent same-label tokens (allow 1-char gaps for spaces/punct).
    if (last && last.rawLabel === rawLabel && start <= last.end + 2) {
      last.end = Math.max(last.end, end);
      last.reconstructed = last.reconstructed || reconstructed;
    } else {
      spans.push({ start, end, rawLabel, reconstructed });
    }
  }
  // Validated after merging: subword pieces of one entity ("John" + "##son")
  // are only word-aligned once joined, so filtering earlier would drop them.
  return spans.filter((s) => !s.reconstructed || wordAligned(chunk, s));
}

const CHUNK = 1500; // chars per NER call; keeps token counts within model limits

export async function deidentify(text, ner, registry) {
  let out = text;

  // Pass 1 — labeled-field harvest: capture values, replace document-wide.
  for (const [base, re] of LABELED_FIELDS) {
    for (const m of text.matchAll(re)) {
      let value = (m[1] || "").trim()
        .replace(/\s+(DOB|SSN|MRN|ID|Phone|Email|Address|Group|Plan|Account)$/i, "");
      if (value.length < 2) continue;
      const ph = placeholderFor(registry, base, value);
      out = out.split(value).join(ph);
    }
  }

  // Pass 2 — NER over the (partially redacted) text.
  let entityCount = 0;
  let nerOut = "";
  for (let offset = 0; offset < out.length; offset += CHUNK) {
    const chunk = out.slice(offset, offset + CHUNK);
    let replaced = chunk;
    try {
      const tokens = await ner(chunk, { ignore_labels: ["O"] });
      const spans = spansFromTokens(chunk, tokens ?? []);
      for (let i = spans.length - 1; i >= 0; i--) {
        const span = spans[i];
        const base = normalizeLabel(span.rawLabel);
        if (!base) continue;
        const surface = chunk.slice(span.start, span.end);
        if (!surface.trim() || surface.includes("[")) continue; // don't re-redact placeholders
        entityCount++;
        replaced =
          replaced.slice(0, span.start) +
          placeholderFor(registry, base, surface) +
          replaced.slice(span.end);
      }
    } catch (e) {
      console.warn("NER chunk failed; regex layers still apply", e);
    }
    nerOut += replaced;
  }
  out = nerOut;

  // Pass 3 — regex backstop on whatever remains.
  for (const { base, re } of REGEX_BACKSTOP) {
    out = out.replace(re, (m) => placeholderFor(registry, base, m));
  }

  return { redacted: out, entityCount };
}

// Manual redaction from the double-check screen.
export function manualRedact(text, selection, registry) {
  if (!selection.trim()) return text;
  const ph = placeholderFor(registry, "MANUAL", selection);
  return text.split(selection).join(ph);
}
