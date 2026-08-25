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

// The SBC owns the LIMIT; the EOB owns progress. When both state a limit and
// disagree by more than $1, the SBC still wins and the UI shows the conflict.
//
// With one correction. A plan states TWO limits, individual and family, and a
// household accrues against one of them. The EOB is the only document that says
// which — it prints the limit this member's claims actually count toward. So a
// figure matching the plan's FAMILY number is not a disagreement with the
// individual one; it is the household's target.
//
// This read `.individual` unconditionally, so a family plan measured progress
// toward $1,000 against a $500 target and reported the EOB's correct family
// figure as a conflict. Reproduces with any file in test-fixtures/real-sbc/.
function limitTarget(sbcIndividual, sbcFamily, eobLimit) {
  const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1;

  if (near(sbcFamily, eobLimit) && !near(sbcIndividual, eobLimit)) {
    return { limit: sbcFamily, source: "sbc", scope: "family", conflict: false };
  }
  if (typeof sbcIndividual === "number") {
    return {
      limit: sbcIndividual, source: "sbc", scope: "individual",
      conflict: typeof eobLimit === "number" && !near(sbcIndividual, eobLimit),
    };
  }
  if (typeof eobLimit === "number") return { limit: eobLimit, source: "eob", scope: null, conflict: false };
  return { limit: null, source: null, scope: null, conflict: false };
}

export function deductibleTarget(structured, snapshot) {
  return limitTarget(structured?.deductible?.individual, structured?.deductible?.family, snapshot?.deductibleLimit);
}

// Out-of-pocket max: same precedence, and the reason the OOP card can finally
// render — oopToDate/oopLimit have been extracted since v2 but never shown.
export function oopTarget(structured, snapshot) {
  return limitTarget(structured?.oopMax?.individual, structured?.oopMax?.family, snapshot?.oopLimit);
}

export function planYearStartMonthFrom(planYearStart) {
  const m = Number(String(planYearStart || "").split("-")[1]);
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : 1;
}
