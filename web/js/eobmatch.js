// Pure saved-EOB matching. No DOM, no globals — unit-testable in Node.
// Given the library entries (with metadata saved at audit time) and the raw
// extracted text of a new bill, find the saved EOB most likely to cover it:
// the bill mentioning the EOB's provider and/or one of its service dates is
// the signal. Entries saved before metadata existed are skipped gracefully.

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

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
