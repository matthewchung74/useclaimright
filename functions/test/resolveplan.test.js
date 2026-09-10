import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePlan, keepChoice, CHOSE_IT } from "../resolveplan.js";

// The three plans in a member's real UMR booklet, with their real figures.
const BOOKLET = [
  { planName: "MEDICAL SCHEDULE OF BENEFITS (EPO Plan)", deductible: { individual: 0, family: 0 }, oopMax: { individual: 3000, family: 6000 } },
  { planName: "MEDICAL SCHEDULE OF BENEFITS (PPO Plan)", deductible: { individual: 500, family: 1500 }, oopMax: { individual: 5000, family: 10000 } },
  { planName: "MEDICAL SCHEDULE OF BENEFITS (HDHP Plans)", deductible: { individual: 2500, family: 5000 }, oopMax: { individual: 2500, family: 5000 } },
];

test("the EOB naming the plan type settles it", () => {
  const r = resolvePlan(BOOKLET, { text: "Your claim was processed at the in-network level of benefits. This is a High Deductible Health Plan." });
  assert.equal(r.index, 2);
  assert.match(r.why, /HDHP/);
});

// The signal that actually appears on a real EOB, alongside "$0.00 to go".
test("the EOB's deductible limit picks the plan when nothing names a type", () => {
  const r = resolvePlan(BOOKLET, { text: "Explanation of benefits", deductibleLimit: 5000 });
  assert.equal(r.index, 2, "$5,000 is the HDHP family deductible and no other plan's");
});

test("a single-plan document needs no resolving", () => {
  const r = resolvePlan([BOOKLET[1]], {});
  assert.equal(r.index, 0);
});

// Two plans sharing a figure is common. "One of these two" is not an answer.
test("an ambiguous number resolves to nothing rather than a coin flip", () => {
  const twins = [
    { planName: "Gold", deductible: { individual: 500, family: 1500 }, oopMax: {} },
    { planName: "Silver", deductible: { individual: 500, family: 1500 }, oopMax: {} },
  ];
  assert.equal(resolvePlan(twins, { deductibleLimit: 500 }).index, null);
});

test("no signal at all resolves to nothing, and says why", () => {
  const r = resolvePlan(BOOKLET, { text: "Explanation of benefits" });
  assert.equal(r.index, null);
  assert.match(r.why, /3 plans/);
});

// Words beat numbers: an EOB naming HDHP wins even if a different plan's
// deductible happens to match the accumulator.
test("the stated plan type outranks a matching number", () => {
  const r = resolvePlan(BOOKLET, { text: "This is a High Deductible Health Plan.", deductibleLimit: 500 });
  assert.equal(r.index, 2);
});

test("a plan type the booklet does not offer resolves to nothing", () => {
  assert.equal(resolvePlan(BOOKLET, { text: "This is an HMO plan." }).index, null);
});

test("no candidates is not a crash", () => {
  assert.deepEqual(resolvePlan(null, { text: "x" }), { index: null, why: "" });
});

// --- several EOBs, because one stray document should not decide --------------
//
// Resolution read only the newest EOB, so a spouse's, or an old one from a
// previous employer's PPO, won by being most recent. Seen for real on
// 2026-09-10 when a test EOB flipped a member from HDHP to PPO on re-upload.

test("EOBs that agree still resolve", () => {
  const r = resolvePlan(BOOKLET, [
    { text: "This is a High Deductible Health Plan." },
    { text: "processed at the in-network level. This is a High Deductible Health Plan." },
  ]);
  assert.equal(r.index, 2);
});

test("EOBs that disagree resolve to nothing, and say what to do", () => {
  const r = resolvePlan(BOOKLET, [
    { text: "This is a High Deductible Health Plan." },
    { text: "Your PPO plan paid this claim." },
  ]);
  assert.equal(r.index, null);
  assert.match(r.why, /disagree/i);
  assert.match(r.why, /HDHP and PPO|PPO and HDHP/);
});

test("an EOB that names no plan type does not veto one that does", () => {
  const r = resolvePlan(BOOKLET, [
    { text: "Explanation of benefits. Claim processed." },
    { text: "This is a High Deductible Health Plan." },
  ]);
  assert.equal(r.index, 2);
});

test("deductible limits that disagree are not used either", () => {
  const r = resolvePlan(BOOKLET, [
    { text: "EOB", deductibleLimit: 5000 },
    { text: "EOB", deductibleLimit: 1500 },
  ]);
  assert.equal(r.index, null, "two different limits cannot both be this member's");
});

// The single-object form the caller used before must keep working.
test("a lone EOB object is still accepted", () => {
  assert.equal(resolvePlan(BOOKLET, { text: "This is a High Deductible Health Plan." }).index, 2);
});

// --- a choice the member made must outlive the next extraction ---------------

const chose = (i) => ({ resolvedIndex: i, resolvedWhy: CHOSE_IT, candidates: BOOKLET });
const guessed = { index: 1, why: "Your EOB says this is a PPO plan." };

test("re-extraction does not overwrite a plan the member chose", () => {
  assert.deepEqual(keepChoice(chose(2), BOOKLET, guessed), { index: 2, why: CHOSE_IT });
});

test("a guess we made before is replaced by the new one", () => {
  const priorGuess = { resolvedIndex: 2, resolvedWhy: "Your EOB says this is a HDHP plan.", candidates: BOOKLET };
  assert.deepEqual(keepChoice(priorGuess, BOOKLET, guessed), guessed);
});

// New candidates are a new question. Answering it with a stale index would put
// the member on whichever plan happens to sit in that slot now.
test("a choice does not carry over to a different document", () => {
  const other = [
    { planName: "SCHEDULE OF BENEFITS (Bronze)", deductible: { individual: 7000, family: 14000 }, oopMax: {} },
    { planName: "SCHEDULE OF BENEFITS (Gold)", deductible: { individual: 1000, family: 2000 }, oopMax: {} },
    { planName: "SCHEDULE OF BENEFITS (Platinum)", deductible: { individual: 0, family: 0 }, oopMax: {} },
  ];
  assert.deepEqual(keepChoice(chose(2), other, guessed), guessed);
});

test("a choice pointing past the end of the new list is dropped", () => {
  assert.deepEqual(keepChoice(chose(2), BOOKLET.slice(0, 2), guessed), guessed);
});

test("no prior plan means nothing to keep", () => {
  assert.deepEqual(keepChoice(undefined, BOOKLET, guessed), guessed);
  assert.deepEqual(keepChoice({}, BOOKLET, guessed), guessed);
});
