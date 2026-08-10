// Pure saved-EOB matching. No DOM, no globals — unit-testable in Node.
// Given the library entries (with metadata saved at audit time) and the raw
// extracted text of a new bill, find the saved EOB most likely to cover it:
// the bill mentioning the EOB's provider and/or one of its service dates is
// the signal. Entries saved before metadata existed are skipped gracefully.

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// Do a bill and an EOB plausibly describe the same care? A genuine pair shares
// at least one date of service or one procedure code. Pairing the wrong EOB
// otherwise produces a report where every line reads "missing from the EOB"
// and the full bill lands in "worth disputing" — the loudest possible wrong
// answer, so it is worth warning about before analysis.
const ISO_DATE = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
const US_DATE = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g;
const CODE = /\b(\d{5}|[A-Z]\d{4})\b/g;

function datesIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(ISO_DATE)) out.add(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of String(text).matchAll(US_DATE)) {
    out.add(`${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`);
  }
  return out;
}

function codesIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(CODE)) out.add(m[1]);
  return out;
}

export function documentsRelated(billText, eobText) {
  const bd = datesIn(billText), ed = datesIn(eobText);
  const bc = codesIn(billText), ec = codesIn(eobText);
  const sharedDates = [...bd].filter((d) => ed.has(d));
  const sharedCodes = [...bc].filter((c) => ec.has(c));
  if (sharedDates.length || sharedCodes.length) {
    return { related: true, confident: true, sharedDates, sharedCodes };
  }
  // No signals at all in one document (OCR failure, image-only scan) means we
  // cannot judge — never raise a false alarm on unreadable input.
  const judgeable = (bd.size || bc.size) && (ed.size || ec.size);
  return judgeable
    ? { related: false, confident: true, sharedDates: [], sharedCodes: [] }
    : { related: true, confident: false, sharedDates: [], sharedCodes: [] };
}

// Returns {eob, reason, score} or null. Scores: provider+date 3, provider 2,
// date 1. Ties break toward the earlier entry (callers pass most-recent-first).
export function matchSavedEob(savedEobs, billText) {
  const text = norm(billText);
  if (!text) return null;
  let best = null;
  for (const e of savedEobs || []) {
    const provider = norm(e.provider);
    const dates = (e.serviceDates || []).filter(Boolean);
    if (!provider && !dates.length) continue; // legacy entry, no metadata
    const providerHit = provider.length > 0 && text.includes(provider);
    const dateHit = dates.some((d) => text.includes(d));
    const score = (providerHit ? 2 : 0) + (dateHit ? 1 : 0);
    if (score === 0) continue;
    if (!best || score > best.score) {
      const reason = providerHit && dateHit
        ? "matched by provider and service date"
        : providerHit ? "matched by provider" : "matched by service date";
      best = { eob: e, reason, score };
    }
  }
  return best;
}
