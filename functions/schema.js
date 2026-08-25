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

// The lines a finding refers to, parsed out of the model's free-text lineRef.
// Seen in production: "Line 2", "Line 1 - Line 6", "Header". Anything we cannot
// read returns an empty set, which means "cannot judge" — such a finding is
// never de-overlapped, so an unparseable ref can only ever cost us a deduction
// we were not sure about.
export function linesIn(lineRef) {
  const s = String(lineRef || "").toLowerCase();
  const nums = [];
  let sawRange = false;
  for (const m of s.matchAll(/(\d+)\s*(?:-|–|—|to|through)\s*(?:lines?\s*)?(\d+)/g)) {
    sawRange = true;
    const a = Number(m[1]), b = Number(m[2]);
    // A nonsensical span ("line 1 - 99999") is refused outright rather than
    // degraded to its first line: a wrong line set drives a wrong containment
    // decision, whereas an empty one only declines to judge.
    if (b >= a && b - a < 200) for (let i = a; i <= b; i++) nums.push(i);
  }
  if (sawRange) return new Set(nums);
  for (const m of s.matchAll(/lines?\s*(\d+)/g)) nums.push(Number(m[1]));
  return new Set(nums);
}

const strictlyContains = (outer, inner) =>
  outer.size > inner.size && inner.size > 0 && [...inner].every((n) => outer.has(n));

// The at-stake total, computed from the findings rather than trusted from the
// model. The prompt never specified how to sum it, so the exclusion above held
// only by luck: one E1 run returned $990.50 (= $804.15 + the $186.35 charity
// figure) instead of $804.15.
//
// Findings also overlap. Live on 2026-08-25 a mismatched pair produced
// not_in_eob over "Line 1 - Line 6" ($2,115.00 — the whole bill) alongside
// duplicate_charge over "Line 2" ($145.50), and the sum came to $2,260.50 on a
// $2,115.00 bill. A headline larger than the bill is indefensible: it is the
// figure a member acts on when deciding what to withhold. The $145.50 is not
// additional money, it is a reason inside the larger claim.
//
// Only strict containment is deducted. Partial overlaps are ambiguous and are
// left summed, with the billed cap as the backstop — overstating is the failure
// that costs the product its credibility, so both rules round that way.
export function computeAtStake(findings, billed) {
  const items = (findings || [])
    .filter((f) => !ADVISORY_FINDING_TYPES.has(f.type))
    .map((f) => ({ lines: linesIn(f.lineRef), amt: typeof f.amountAtStake === "number" ? f.amountAtStake : 0 }));

  const total = items
    .filter((a) => !items.some((b) => b !== a && strictlyContains(b.lines, a.lines)))
    .reduce((sum, x) => sum + x.amt, 0);

  return typeof billed === "number" && billed > 0 ? Math.min(total, billed) : total;
}

// Evidence, verified. The schema proves a quote is a STRING; it cannot prove the
// string is in the document. That gap matters more than it looks: every finding
// is rendered under its quote, and buildDisputeEmail puts those quotes in a
// letter the member sends to a provider. A fabricated quote is therefore not a
// display bug, it is a false accusation with the member's name on it.
//
// computeAtStake already exists because the model's arithmetic was not worth
// trusting. This is the same distrust applied one level down, to the quotes the
// arithmetic rests on.
//
//   model result ──▶ ajv (shape) ──▶ applyPlanGate ──▶ verifyEvidence ──▶ total
//                                                            │
//                                          quote not in source ──▶ drop finding
//
// Normalization is deliberately light. Whitespace and case vary constantly
// between a PDF's text layer and a model's rendering of it; the punctuation
// swaps below are the ones models make silently. Anything more aggressive
// (stripping digits, punctuation, or short words) would start matching text
// that is not really there, which defeats the point.
const normalizeForMatch = (s) =>
  String(s || "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    // Currency notation is the model's choice, not the document's evidence:
    // a bill printing "145.50" and a quote writing "$145.50" are the same fact,
    // and so are "2,400.00" and "2400.00".
    .replace(/\$/g, "")
    .replace(/(\d),(?=\d{3}(\D|$))/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// Distinctive tokens: the ones a fabrication cannot get right. Amounts, codes
// and dates carry nearly all the evidentiary weight; "the" appearing in a bill
// proves nothing. Single characters are dropped as noise.
const tokensOf = (s) =>
  s.split(" ")
    .map((t) => t.replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9%]+$/, ""))
    .filter((t) => t.length >= 2);

// Does this quote actually come from this document?
//
// Exact containment is the common case and the fast path. It is not sufficient
// on its own, because a model reading a scan does two reasonable things that
// break a literal match: it cleans up OCR noise, and it joins two lines into
// one quote. Both were observed on the first real run against a scanned
// fixture, and both would have dropped a TRUE finding — including a $145.50
// duplicate charge, the headline number on that audit.
//
// So the fallback asks the question that actually matters: are the quote's
// distinctive tokens in the document? A model that tidies "$l86.35" to
// "$186.35" still matches. A model that invents "99285 EMERGENCY DEPARTMENT
// VISIT $2,400.00" for a lab-panel bill does not — its numbers are absent, and
// numbers are what a fabrication has to invent.
const NUMERIC_HIT = 0.8; // amounts and codes must be real
const WORD_HIT = 0.6;    // wording may drift; substance may not
function quoteIsSupported(quote, doc) {
  if (!doc) return false;
  if (doc.includes(quote)) return true;
  const tokens = [...new Set(tokensOf(quote))];
  if (!tokens.length) return false;
  const numeric = tokens.filter((t) => /\d/.test(t));
  const words = tokens.filter((t) => !/\d/.test(t));
  const hit = (list) => (list.length ? list.filter((t) => doc.includes(t)).length / list.length : 1);
  // With no numbers at all there is nothing hard to check against, so the
  // wording itself has to carry the burden.
  if (!numeric.length) return hit(words) >= 0.8;
  return hit(numeric) >= NUMERIC_HIT && hit(words) >= WORD_HIT;
}

// Each quote field is checked against the document it claims to come from. An
// empty quote is not a claim — sbcQuote is "" on every non-plan finding — so it
// is skipped rather than treated as unverifiable. A quote naming a document that
// was never uploaded fails, because the model cannot have read it.
//
// Returns the input object unchanged when nothing is dropped, so the common case
// allocates nothing. Drops carry the offending quote for the log.
export function verifyEvidence(result, sources) {
  const docs = {
    billQuote: normalizeForMatch(sources?.bill),
    eobQuote: normalizeForMatch(sources?.eob),
    sbcQuote: normalizeForMatch(sources?.sbc),
  };
  const dropped = [];
  const kept = (result?.findings || []).filter((f) => {
    for (const field of ["billQuote", "eobQuote", "sbcQuote"]) {
      const quote = normalizeForMatch(f?.evidence?.[field]);
      if (!quote) continue;
      if (!quoteIsSupported(quote, docs[field])) {
        dropped.push({ type: f.type, field, quote: f.evidence[field] });
        return false;
      }
    }
    return true;
  });
  if (!dropped.length) return { result, dropped };
  // Re-derive rather than subtract, for the reason applyPlanGate re-derives: one
  // formula, one place. Subtracting would inherit whatever the model asserted.
  return {
    result: { ...result, findings: kept, totals: { ...result.totals, totalAtStake: computeAtStake(kept, result.totals?.billed) } },
    dropped,
  };
}

const nullableNumber = { type: ["number", "null"] };

export const findingsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "totals", "occurrenceTable", "serviceDates", "provider", "payerRemarks", "accumulators"],
  properties: {
    // Present only when the documents arrived as images: the model's own
    // transcription. Evidence quotes are verified against it, and it stands in
    // for the extracted text everywhere the client used to need one — the bill
    // fingerprint, saved-EOB matching, the mismatched-pair backstop. Self-
    // consistency rather than independent ground truth, so it catches a quote
    // the model invented but not a page it misread wholesale.
    billText: { type: "string" },
    eobText: { type: "string" },

    // Who the bill is FOR. A household shares a plan and a provider, so
    // without this two family members seen the same day for the same code are
    // indistinguishable from one person billed twice — and the cross-bill
    // duplicate check reports the second as a double-bill.
    patientName: { type: "string" },

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
