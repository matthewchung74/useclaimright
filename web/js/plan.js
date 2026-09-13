// Pure plan (SBC) logic. No DOM, no globals — unit-testable in Node.
// All dates are ISO YYYY-MM-DD strings; lexical comparison is date comparison.

// A plan year that is printed once, on a page we did not send.
//
// An employer booklet prints the coverage period in its Plan Information
// section, not on each schedule of benefits — so a real booklet extracted with
// planYearStart set and planYearEnd null. Requiring both meant the plan was on
// file, named on the card, resolved from the member's own EOB, and then applied
// to nothing: every audit reported "no_plan" and told them to add the Summary of
// Benefits they had just added. Found on a member's real UMR booklet 2026-09-10.
//
// A plan year is a year. Inferring the end from the start is a smaller leap than
// discarding a plan we correctly extracted — and the card says which end date is
// being used, so an inference that is wrong is visible rather than silent.
export function planYearEndFrom(structured) {
  if (structured?.planYearEnd) return { end: structured.planYearEnd, inferred: false };
  const start = structured?.planYearStart;
  if (!start) return { end: null, inferred: false };
  const d = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { end: null, inferred: false };
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return { end: d.toISOString().slice(0, 10), inferred: true };
}

export function planApplies(serviceDates, structured) {
  if (!structured || !structured.planYearStart) {
    return { applies: false, reason: "no_plan" };
  }
  const { end } = planYearEndFrom(structured);
  if (!end) return { applies: false, reason: "no_plan" };
  const dates = (serviceDates || []).filter(Boolean);
  if (!dates.length) return { applies: false, reason: "no_dates" };
  const inWin = dates.some((d) => d >= structured.planYearStart && d <= end);
  return inWin ? { applies: true, reason: null } : { applies: false, reason: "out_of_period" };
}

const norm = (c) => String(c).trim().toUpperCase();

// SBC-derived limits become trackers, but never at a manual tracker's expense:
// overlap with a manual tracker blocks creation; overlap with an sbc-sourced
// tracker updates it in place (re-uploads refresh their own trackers only).
// Returns { create, update, remove }. `remove` is the half that was missing:
// an SBC tracker belongs to the plan that created it, which is why removing the
// plan removes them — but REPLACING the plan only ever added.
//
// Found on production 2026-09-12 running C1 then C2. After replacing a UMR
// booklet with Kaiser CalPERS and then with BCBS Kansas, the coverage list held
// "Private Duty Nursing 0/14", "Developmental Delays 1/20" and "Refractions
// 0/1" — UMR's benefits, on a Kansas plan, each badged "from your plan (SBC)".
// A member who changes insurer accumulates limits from every plan they have
// ever uploaded, presented as their current coverage, and the whole point of
// the card is telling them what is left of it.
export function mergeSbcTrackers(existing, limits, planYearStartMonth) {
  const create = [], update = [], kept = new Set();
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
      // Label and limit are PRINTED on the SBC, so a newer one is authoritative.
      // The codes are not printed — the model infers them from the row label,
      // which is exactly why the card asks the member to check them.
      //
      // Once they have, that answer is theirs and re-uploading must not discard
      // it. Found live 2026-08-31: the same SBC read as a scan inferred
      // 97110/97140 where the text version inferred 97110/97161/97165, so
      // Replace silently changed which visits counted — a 97161 visit that
      // counted yesterday stopped counting, with no notice and nothing on screen
      // to explain why.
      const changes = sbcHit.confirmed
        ? { label: lim.label, limit: lim.visitsPerYear }
        : { label: lim.label, codes, limit: lim.visitsPerYear };
      update.push({ id: sbcHit.id, changes });
      kept.add(sbcHit.id);
    } else {
      create.push({ label: lim.label, codes, limit: lim.visitsPerYear, planYearStartMonth, source: "sbc" });
    }
  }
  // Everything the incoming plan did not claim. Only source "sbc": limits the
  // member added themselves, or accepted from an EOB remark, are theirs and
  // survive — the same line Remove draws, and the same words it uses.
  const remove = existing.filter((t) => t.source === "sbc" && !kept.has(t.id)).map((t) => t.id);
  return { create, update, remove };
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
function limitTarget(sbcIndividual, sbcFamily, eobLimit, toDate) {
  const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1;

  if (near(sbcFamily, eobLimit) && !near(sbcIndividual, eobLimit)) {
    return { limit: sbcFamily, source: "sbc", scope: "family", conflict: false, sbcLimit: sbcFamily };
  }
  // You cannot have accrued more than the limit you are accruing toward. When
  // the insurer's running total exceeds the SBC's figure, the SBC is not the
  // plan this member is on, and measuring against it printed "$5,000.00 of
  // $500.00" — a card claiming 1000% progress, which reads as broken even
  // though a note underneath explained it. Found with a member's real EOB
  // against a plan from a different document, 2026-09-10.
  if (typeof toDate === "number" && typeof sbcIndividual === "number" &&
      toDate > sbcIndividual && typeof eobLimit === "number" && eobLimit >= toDate) {
    return { limit: eobLimit, source: "eob", scope: null, conflict: true, sbcLimit: sbcIndividual };
  }
  if (typeof sbcIndividual === "number") {
    return {
      limit: sbcIndividual, source: "sbc", scope: "individual",
      conflict: typeof eobLimit === "number" && !near(sbcIndividual, eobLimit),
      sbcLimit: sbcIndividual,
    };
  }
  if (typeof eobLimit === "number") return { limit: eobLimit, source: "eob", scope: null, conflict: false, sbcLimit: null };
  return { limit: null, source: null, scope: null, conflict: false, sbcLimit: null };
}

export function deductibleTarget(structured, snapshot) {
  return limitTarget(structured?.deductible?.individual, structured?.deductible?.family,
    snapshot?.deductibleLimit, snapshot?.deductibleToDate);
}

// Out-of-pocket max: same precedence, and the reason the OOP card can finally
// render — oopToDate/oopLimit have been extracted since v2 but never shown.
export function oopTarget(structured, snapshot) {
  return limitTarget(structured?.oopMax?.individual, structured?.oopMax?.family,
    snapshot?.oopLimit, snapshot?.oopToDate);
}

// Which of the plan's two numbers a card is measured against.
//
// limitTarget picks between them — the EOB is the only document that says which
// one a household actually accrues toward — but the cards never said which it
// had chosen. So a member of a family plan seeing "$640.00 of $1,000.00" had no
// way to tell the correct family target from a bug rendering the wrong number,
// and the one question the card exists to answer went unanswered. Naming it
// costs one word.
export const targetLabel = (scope) =>
  scope === "family" ? "Family target" : scope === "individual" ? "Individual target" : "Target";

export function planYearStartMonthFrom(planYearStart) {
  const m = Number(String(planYearStart || "").split("-")[1]);
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : 1;
}
