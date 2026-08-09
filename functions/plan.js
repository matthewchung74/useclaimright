// Plan (SBC) server-side pure logic: extraction schema + prompt, digest
// builder, and the replace decision. Mirrors schema.js conventions.

const nullableNumber = { type: ["number", "null"] };
const nullableString = { type: ["string", "null"] };
const nullableBool = { type: ["boolean", "null"] };

export const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["planName", "planYearStart", "planYearEnd", "deductible", "oopMax", "limits", "costShares"],
  properties: {
    planName: nullableString,
    planYearStart: nullableString, // ISO YYYY-MM-DD from the SBC "Coverage Period"
    planYearEnd: nullableString,
    deductible: {
      type: "object", additionalProperties: false, required: ["individual", "family"],
      properties: { individual: nullableNumber, family: nullableNumber },
    },
    oopMax: {
      type: "object", additionalProperties: false, required: ["individual", "family"],
      properties: { individual: nullableNumber, family: nullableNumber },
    },
    limits: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["label", "codesHint", "visitsPerYear"],
        properties: {
          label: { type: "string" },
          codesHint: { type: "array", items: { type: "string" } }, // model-proposed CPT codes; UI flags "check the codes"
          visitsPerYear: nullableNumber,
        },
      },
    },
    costShares: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["category", "verbatim", "copay", "coinsurancePct", "deductibleApplies"],
        properties: {
          category: { type: "string" },
          verbatim: { type: "string" }, // the row copied word-for-word
          copay: nullableNumber,
          coinsurancePct: nullableNumber,
          deductibleApplies: nullableBool,
        },
      },
    },
  },
};

export const PLAN_EXTRACT_INSTRUCTIONS = `You are reading the de-identified text of a Summary of
Benefits and Coverage (SBC) — the standardized ACA document with an "Important Questions" table
and a "Common Medical Events" cost-share grid. Personal identifiers are placeholders like [NAME_1].

Extract, verbatim from the document, NEVER inferred or guessed:
- planName: the marketing/plan name as printed (null if absent).
- planYearStart / planYearEnd: the Coverage Period dates, ISO YYYY-MM-DD (null if absent).
- deductible.individual / .family and oopMax.individual / .family: the printed dollar numbers
  from the Important Questions table (null unless printed as a number).
- limits: every service with a printed visit/day/session-per-year maximum. label = the service
  name as printed; visitsPerYear = the printed number; codesHint = the CPT codes that most
  commonly bill that service, from your medical coding knowledge (this is the ONLY field where
  your knowledge is allowed — everything else must appear in the document).
- costShares: one row per "Common Medical Events" line relevant to outpatient/office/therapy/
  emergency/imaging/lab care. category = the row label as printed; verbatim = the full row text
  word-for-word; copay / coinsurancePct = printed numbers or null; deductibleApplies = true/false
  only when the row states it, else null.

If the document has no Coverage Period AND no Important Questions numbers, it is not an SBC:
return every field null/empty rather than guessing.`;

// Deterministic digest for the audit prompt: key numbers + verbatim rows, hard-capped.
export function buildDigest(structured) {
  const lines = [];
  const money = (n) => (typeof n === "number" ? `$${n}` : "not stated");
  lines.push(`Plan: ${structured.planName || "(name not stated)"} · Coverage ${structured.planYearStart || "?"} to ${structured.planYearEnd || "?"}`);
  lines.push(`Deductible: individual ${money(structured.deductible?.individual)}, family ${money(structured.deductible?.family)}`);
  lines.push(`Out-of-pocket max: individual ${money(structured.oopMax?.individual)}, family ${money(structured.oopMax?.family)}`);
  for (const l of structured.limits || []) {
    lines.push(`Limit: ${l.label} — ${l.visitsPerYear ?? "?"} visits/year`);
  }
  for (const c of structured.costShares || []) {
    lines.push(`Row: ${c.verbatim}`);
  }
  let out = "";
  for (const line of lines) {
    if (out.length + line.length + 1 > 2000) break;
    out += (out ? "\n" : "") + line;
  }
  return out;
}

// Older SBC uploads need explicit confirmation; everything else stores.
export function replaceDecision(existing, incoming, force) {
  if (force || !existing) return "store";
  const a = existing.planYearStart, b = incoming.planYearStart;
  if (a && b && b < a) return "confirm_older";
  return "store";
}

// Post-response gate: decide applicability from the audit's own service dates
// and, when the plan does not apply, strip any straggler plan findings the
// model emitted anyway (the prompt date-gates them; this is defense in depth).
const PLAN_FINDING_TYPES = new Set(["copay_mismatch", "coinsurance_mismatch", "deductible_misapplied", "not_covered_per_plan"]);

export function applyPlanGate(result, structured) {
  const dates = (result.serviceDates || []).filter(Boolean);
  let planApplied = false, planReason = "no_plan";
  if (structured?.planYearStart && structured?.planYearEnd) {
    if (!dates.length) planReason = "no_dates";
    else if (dates.some((d) => d >= structured.planYearStart && d <= structured.planYearEnd)) {
      planApplied = true; planReason = null;
    } else planReason = "out_of_period";
  }
  if (!planApplied && (result.findings || []).some((f) => PLAN_FINDING_TYPES.has(f.type))) {
    const dropped = result.findings.filter((f) => PLAN_FINDING_TYPES.has(f.type));
    result = {
      ...result,
      findings: result.findings.filter((f) => !PLAN_FINDING_TYPES.has(f.type)),
      totals: {
        ...result.totals,
        totalAtStake: Math.max(0, result.totals.totalAtStake - dropped.reduce((s, f) => s + (f.amountAtStake || 0), 0)),
      },
    };
  }
  return { planApplied, planReason, result };
}

export function planTermsBlock(digest) {
  return `

PLAN TERMS (from the member's Summary of Benefits; quote these verbatim in sbcQuote when citing a mismatch):
---
${digest}
---
Cross-check instructions: compare the bill and EOB lines against the matching plan rows above.
Report copay_mismatch / coinsurance_mismatch / deductible_misapplied / not_covered_per_plan findings
only when the plan term is explicit and the discrepancy is arithmetic, not interpretive. Apply plan
comparisons ONLY to services whose dates fall within the plan's coverage period; if none do, emit no
plan findings. Word not_covered_per_plan findings as "worth asking about", never as a definitive
coverage determination. Every plan finding MUST quote the plan row verbatim in evidence.sbcQuote and
default to "medium" confidence unless the plan row names the exact billed service. Non-plan findings
keep sbcQuote as "".`;
}
