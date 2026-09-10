import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePlan } from "../resolveplan.js";

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
