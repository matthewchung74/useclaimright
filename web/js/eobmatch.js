import { samePerson } from "./person.js";
export { samePerson };

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

export function datesIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(ISO_DATE)) out.add(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of String(text).matchAll(US_DATE)) {
    out.add(`${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`);
  }
  return out;
}

// A US ZIP is five digits and so is a CPT code, so the code regex cannot tell them
// apart on shape alone. Context can: a ZIP follows a two-letter state abbreviation,
// a procedure code never does. Left unstripped, two providers in the same town share
// a "code", documentsRelated() calls a mismatched pair RELATED, and the wrong-EOB
// warning goes silent — the one guard that stops a member acting on an audit of two
// documents that have nothing to do with each other. The fixtures only pass because
// they happen to print different ZIPs; a member's own address on both would not.
const ZIP_IN_ADDRESS = /\b[A-Z]{2}[.,]?\s+\d{5}(?:-\d{4})?\b/g;

export function codesIn(text) {
  const out = new Set();
  const scrubbed = String(text).replace(ZIP_IN_ADDRESS, " ");
  for (const m of scrubbed.matchAll(CODE)) out.add(m[1]);
  return out;
}

// True when the bill's patient is definitely NOT among the people the EOB's
// claims are for. Returns false whenever it cannot tell — an unknown patient or
// an EOB with no claim names must never raise a false alarm, because "you have
// the wrong person's EOB" is a serious thing to say to someone who does not.
export function wrongPatient(billPatient, eobPatients) {
  const bill = String(billPatient || "").trim();
  const list = (eobPatients || []).map((n) => String(n || "").trim()).filter(Boolean);
  if (!bill || !list.length) return false;
  return !list.some((n) => samePerson(bill, n));
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

