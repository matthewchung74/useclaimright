// Which of a booklet's plans is this member's?
//
// An employer booklet describes every plan the employer offers and never says
// which one you chose. A member's real UMR booklet held three — EPO with no
// deductible, PPO at $500/$1,500, HDHP at $2,500/$5,000 — and picking wrong is
// not a small error: it measures every bill they ever upload against terms they
// are not on, and reports a copay violation for a copay their plan does not have.
//
// Asking is a bad question. "Are you EPO, PPO or HDHP?" is insurance jargon, and
// a confident wrong answer is worse than no answer because the app then trusts
// it completely. The EOB knows: it is written by the insurer about the plan the
// member is actually enrolled in.
//
// Two signals, strongest first.

// 1. THE EOB SAYS IT IN WORDS. A member's real EOB reads "This is a High
//    Deductible Health Plan." No numbers, no matching, no ambiguity.
const PLAN_TYPES = [
  { key: "hdhp", re: /high[- ]deductible health plan|\bhdhp\b/i },
  { key: "ppo", re: /\bppo\b|preferred provider/i },
  { key: "epo", re: /\bepo\b|exclusive provider/i },
  { key: "hmo", re: /\bhmo\b|health maintenance/i },
  { key: "pos", re: /\bpos plan\b|point of service/i },
];

const typeOf = (text) => PLAN_TYPES.find((t) => t.re.test(text || ""))?.key ?? null;

const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1;

// Returns { index, why } or { index: null, why } — never a guess. `why` is shown
// to the member, because a plan chosen on their behalf that they cannot see or
// correct is the same silent wrongness in a nicer wrapper.
export function resolvePlan(candidates, eob = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) return { index: null, why: "" };
  if (list.length === 1) return { index: 0, why: "Your plan document describes one plan." };

  // Words beat numbers: two plans can share a deductible, but the insurer naming
  // the type is a statement about this member.
  const stated = typeOf(eob.text);
  if (stated) {
    const hits = list.map((p, i) => [i, typeOf(p?.planName)]).filter(([, t]) => t === stated);
    if (hits.length === 1) {
      return { index: hits[0][0], why: `Your EOB says this is a ${stated.toUpperCase()} plan.` };
    }
  }

  // Numbers as corroboration. Only when EXACTLY one plan matches — two plans
  // sharing a deductible is common, and "one of these two" is not an answer.
  for (const [field, limit, label] of [
    ["deductible", eob.deductibleLimit, "deductible"],
    ["oopMax", eob.oopLimit, "out-of-pocket maximum"],
  ]) {
    if (typeof limit !== "number") continue;
    const hits = list
      .map((p, i) => [i, near(p?.[field]?.individual, limit) || near(p?.[field]?.family, limit)])
      .filter(([, m]) => m);
    if (hits.length === 1) {
      return { index: hits[0][0], why: `Your EOB's ${label} matches this plan.` };
    }
  }

  return {
    index: null,
    why: `Your plan document covers ${list.length} plans and your EOBs do not say which is yours.`,
  };
}
