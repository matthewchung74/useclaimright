// Pure plan (SBC) logic. No DOM, no globals — unit-testable in Node.
// All dates are ISO YYYY-MM-DD strings; lexical comparison is date comparison.

export function planApplies(serviceDates, structured) {
  if (!structured || !structured.planYearStart || !structured.planYearEnd) {
    return { applies: false, reason: "no_plan" };
  }
  const dates = (serviceDates || []).filter(Boolean);
  if (!dates.length) return { applies: false, reason: "no_dates" };
  const inWin = dates.some((d) => d >= structured.planYearStart && d <= structured.planYearEnd);
  return inWin ? { applies: true, reason: null } : { applies: false, reason: "out_of_period" };
}

const norm = (c) => String(c).trim().toUpperCase();

// SBC-derived limits become trackers, but never at a manual tracker's expense:
// overlap with a manual tracker blocks creation; overlap with an sbc-sourced
// tracker updates it in place (re-uploads refresh their own trackers only).
export function mergeSbcTrackers(existing, limits, planYearStartMonth) {
  const create = [], update = [];
  const pendingCodes = new Set(); // codes already claimed by a create/update this run
  for (const lim of limits || []) {
    const codes = (lim.codesHint || []).filter(Boolean);
    if (!codes.length || !Number.isFinite(lim.visitsPerYear) || lim.visitsPerYear < 1) continue;
    const codeSet = new Set(codes.map(norm));
    if ([...codeSet].some((c) => pendingCodes.has(c))) continue; // two SBC rows sharing a code → first wins
    const overlap = (t) => (t.codes || []).some((c) => codeSet.has(norm(c)));
    const manualHit = existing.find((t) => t.source !== "sbc" && overlap(t));
    if (manualHit) continue;
    for (const c of codeSet) pendingCodes.add(c);
    const sbcHit = existing.find((t) => t.source === "sbc" && overlap(t));
    if (sbcHit) {
      update.push({ id: sbcHit.id, changes: { label: lim.label, codes, limit: lim.visitsPerYear } });
    } else {
      create.push({ label: lim.label, codes, limit: lim.visitsPerYear, planYearStartMonth, source: "sbc" });
    }
  }
  return { create, update };
}

// The SBC owns the deductible LIMIT; the EOB owns progress. When both state a
// limit and disagree by more than $1, surface the conflict (UI shows both).
export function deductibleTarget(structured, snapshot) {
  const sbcLimit = typeof structured?.deductible?.individual === "number" ? structured.deductible.individual : null;
  const eobLimit = typeof snapshot?.deductibleLimit === "number" ? snapshot.deductibleLimit : null;
  if (sbcLimit !== null) {
    return { limit: sbcLimit, source: "sbc", conflict: eobLimit !== null && Math.abs(eobLimit - sbcLimit) > 1 };
  }
  if (eobLimit !== null) return { limit: eobLimit, source: "eob", conflict: false };
  return { limit: null, source: null, conflict: false };
}

export function planYearStartMonthFrom(planYearStart) {
  const m = Number(String(planYearStart || "").split("-")[1]);
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : 1;
}
