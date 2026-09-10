// Plan (SBC) server-side pure logic: extraction schema + prompt, digest
// builder, and the replace decision. Mirrors schema.js conventions.

import { computeAtStake } from "./schema.js";

const nullableNumber = { type: ["number", "null"] };
const nullableString = { type: ["string", "null"] };
const nullableBool = { type: ["boolean", "null"] };

export const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["planName", "planYearStart", "planYearEnd", "deductible", "oopMax", "limits", "costShares"],
  properties: {
    // Set only when the SBC arrived as page images: what the model read. Stands
    // in for the extracted text so "View" can still show the plan's source.
    sourceText: { type: "string" },
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

// An employer booklet describes every plan the employer offers, and the member's
// is not marked. Extracting one plan from three meant the model either picked
// silently or — as it did on a real booklet — returned nulls and the whole
// document was rejected. So ask for all of them, and resolve later from the EOB.
export const plansSchema = {
  type: "object",
  additionalProperties: false,
  required: ["plans"],
  properties: {
    sourceText: { type: "string" },
    plans: { type: "array", items: planSchema },
  },
};

export const PLAN_EXTRACT_INSTRUCTIONS = `You are reading the text of a Summary of
Benefits and Coverage (SBC) — the standardized ACA document with an "Important Questions" table
and a "Common Medical Events" cost-share grid. When the SBC is given as page images rather
than text, also return what you read in sourceText.

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

// The booklet version.
//
// The first attempt inherited "also return what you read in sourceText" from the
// single-plan prompt and the model obliged — 6,858 tokens of page text in
// sourceText and `plans: []`. Schema-valid, and completely useless. So the array
// is stated first, stated as the point, and stated as never-empty.
export const PLANS_EXTRACT_INSTRUCTIONS = `Return a JSON object with a \`plans\` array.

A plan document may describe SEVERAL plans. An employer booklet usually carries a separate
schedule of benefits per plan it offers — "(EPO Plan)", "(PPO Plan)", "(HDHP Plans)" — each
with its own deductible, out-of-pocket maximum and copays.

RETURN ONE ENTRY IN \`plans\` PER PLAN, in the order they appear. A document describing a
single plan returns an array of one. \`plans\` must NOT be empty for any document containing
a benefits schedule, an "Important Questions" table, or a deductible figure — if you can see
a deductible anywhere, that is a plan and it belongs in the array.

Do NOT merge plans and do NOT choose between them. Nothing in the document says which plan
the reader is enrolled in, and guessing measures their bills against terms they are not on.
Returning all of them is the correct answer.

For EACH entry, extract verbatim from the document, NEVER inferred or guessed:
- planName: how the document distinguishes this plan, including the type in parentheses when
  printed — "MEDICAL SCHEDULE OF BENEFITS (HDHP Plans)".
- planYearStart / planYearEnd: the Coverage Period dates, ISO YYYY-MM-DD (null if absent —
  a booklet often prints these once, away from the schedules; null is correct then).
- deductible.individual / .family and oopMax.individual / .family: the printed dollar numbers.
  Where a schedule shows in-network and out-of-network columns, use the IN-NETWORK column.
  Rows may be labelled "Per Person / Per Family" or "Single Coverage / Family Coverage" —
  both mean individual / family. null unless printed as a number.
- limits: every service with a printed visit/day/session-per-year maximum. label = the service
  name as printed; visitsPerYear = the printed number; codesHint = the CPT codes that most
  commonly bill that service, from your medical coding knowledge (this is the ONLY field where
  your knowledge is allowed — everything else must appear in the document).
- costShares: one row per cost-share line for outpatient/office/therapy/emergency/imaging/lab
  care. category = the row label as printed; verbatim = the full row text word-for-word;
  copay / coinsurancePct = printed numbers or null; deductibleApplies = true/false only when
  the row states it, else null.

Only if the document was given as page images, ALSO set the top-level sourceText to the text
you read. Never let sourceText substitute for \`plans\`.

If the document contains no benefits schedule and no deductible figures anywhere, return
\`plans: []\`.`;

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
    // The category is what makes a row matchable to a billed service. Without
    // it an SBC where "Specialist visit" and "Rehabilitation services" share
    // the same cost-share text becomes two identical, unusable lines.
    lines.push(`Row: ${c.category ? `${c.category} — ` : ""}${c.verbatim}`);
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
    const kept = result.findings.filter((f) => !PLAN_FINDING_TYPES.has(f.type));
    // Re-derive from what survives rather than subtracting from the model's
    // figure. Subtracting was a second, weaker formula for the same number: it
    // inherited whatever the model asserted, so it kept advisory findings in the
    // total that computeAtStake excludes. One formula, one place.
    result = { ...result, findings: kept, totals: { ...result.totals, totalAtStake: computeAtStake(kept, result.totals?.billed) } };
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
keep sbcQuote as "".

Row matching (most specific wins): use the plan row whose category actually covers the billed
service, never a generic one that merely sounds close. Psychotherapy and other behavioral-health
codes belong to the mental-health row, NOT to a generic "specialist visit" row; physical or
occupational therapy belongs to the rehabilitation row, not the office-visit row. If no row
unambiguously covers the billed service, emit NO plan finding for it — silence is correct when the
mapping is a guess.

Deductible wording is decisive: "after deductible", "subject to the deductible", or "you must meet
your deductible first" all mean applying the charge to the deductible is CORRECT — never report
deductible_misapplied in those cases. Report deductible_misapplied ONLY when the matched row
explicitly states the deductible does NOT apply (e.g. "deductible does not apply") and the EOB
applied it anyway.`;
}
