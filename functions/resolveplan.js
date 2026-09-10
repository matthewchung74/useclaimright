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
//
// Takes SEVERAL EOBs, not the newest one. Reading only the newest let a single
// stray document decide everything — a spouse's EOB, or an old one from a
// previous employer's PPO, wins by being most recent. Requiring the ones that
// name a plan type to agree costs a resolution we would otherwise have made,
// and buys not silently moving someone onto a plan they are not on.
export function resolvePlan(candidates, eobs = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const docs = Array.isArray(eobs) ? eobs : [eobs];
  if (list.length === 0) return { index: null, why: "" };
  if (list.length === 1) return { index: 0, why: "Your plan document describes one plan." };

  // Words beat numbers: two plans can share a deductible, but the insurer naming
  // the type is a statement about this member.
  const stated = [...new Set(docs.map((e) => typeOf(e?.text)).filter(Boolean))];
  if (stated.length > 1) {
    return {
      index: null,
      why: `Your EOBs disagree about your plan — ${stated.map((t) => t.toUpperCase()).join(" and ")}. Choose the one you are on.`,
    };
  }
  if (stated.length === 1) {
    const hits = list.map((p, i) => [i, typeOf(p?.planName)]).filter(([, t]) => t === stated[0]);
    if (hits.length === 1) {
      return { index: hits[0][0], why: `Your EOB says this is a ${stated[0].toUpperCase()} plan.` };
    }
  }

  // Numbers as corroboration. Only when EXACTLY one plan matches — two plans
  // sharing a deductible is common, and "one of these two" is not an answer.
  for (const [field, key, label] of [
    ["deductible", "deductibleLimit", "deductible"],
    ["oopMax", "oopLimit", "out-of-pocket maximum"],
  ]) {
    const limits = [...new Set(docs.map((e) => e?.[key]).filter((n) => typeof n === "number"))];
    if (limits.length !== 1) continue; // none stated, or they disagree
    const hits = list
      .map((p, i) => [i, near(p?.[field]?.individual, limits[0]) || near(p?.[field]?.family, limits[0])])
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

// The marker that a member answered the plan question themselves. Compared, not
// just displayed — re-extraction has to tell a choice from a guess.
export const CHOSE_IT = "You chose this plan.";

// A member who corrected us stays corrected.
//
// Resolution runs again on every extraction, so re-uploading a booklet re-asked
// a question the member had already answered and overwrote their answer with a
// fresh guess. Seen for real 2026-09-10: a chosen HDHP flipped to PPO because a
// newer EOB happened to say so.
//
// Only the same plan, in the same position, still named the same. New candidates
// are a new question, and a stale answer must not be given to it.
export function keepChoice(prior, candidates, resolved) {
  const i = prior?.resolvedIndex;
  if (!Number.isInteger(i) || prior?.resolvedWhy !== CHOSE_IT) return resolved;
  const name = candidates?.[i]?.planName;
  if (!name || name !== prior?.candidates?.[i]?.planName) return resolved;
  return { index: i, why: CHOSE_IT };
}
