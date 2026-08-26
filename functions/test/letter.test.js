import test from "node:test";
import assert from "node:assert/strict";
import { buildDisputeLetter, NOTHING_TO_DISPUTE } from "../letter.js";

const finding = (over = {}) => ({
  type: "billed_vs_allowed_mismatch",
  description: "The bill demands more than the EOB says you owe.",
  amountAtStake: 658.65,
  evidence: { billQuote: "PATIENT BALANCE DUE $845.00", eobQuote: "MEMBER RESPONSIBILITY $186.35", sbcQuote: "" },
  ...over,
});

test("a clean audit gets the friendly line, not an empty letter", () => {
  assert.equal(buildDisputeLetter({ findings: [], totals: {} }), NOTHING_TO_DISPUTE);
  assert.equal(buildDisputeLetter({}), NOTHING_TO_DISPUTE);
});

test("the letter quotes the evidence and names the amount", () => {
  const out = buildDisputeLetter({ findings: [finding()], totals: { patientResponsibility: 186.35 } });
  assert.match(out, /Billed above EOB allowed amount — amount in question: \$658\.65/);
  assert.match(out, /Bill states: "PATIENT BALANCE DUE \$845\.00"/);
  assert.match(out, /EOB states: "MEMBER RESPONSIBILITY \$186\.35"/);
  // no sbcQuote on this finding, so no empty plan line
  assert.doesNotMatch(out, /My plan \(SBC\) states/);
});

test("a billed-above-allowed finding adds the network write-off paragraph", () => {
  const out = buildDisputeLetter({ findings: [finding()], totals: { patientResponsibility: 186.35 } });
  assert.match(out, /my total member responsibility for this claim is \$186\.35/);
  assert.match(out, /contractual write-offs and may not be billed to me/);
});

test("a letter about the insurer's own arithmetic is addressed to the insurer", () => {
  // cost_share_error is the plan's math, which the provider cannot fix.
  const out = buildDisputeLetter({ findings: [finding({ type: "cost_share_error", amountAtStake: 18 })], totals: {} });
  assert.match(out, /To: \[YOUR INSURANCE COMPANY\] Member Services/);
});

test("any provider-side finding sends it to the provider instead", () => {
  const out = buildDisputeLetter({
    findings: [finding({ type: "cost_share_error" }), finding({ type: "duplicate_charge" })], totals: {},
  });
  assert.match(out, /To: \[PROVIDER NAME\] Billing Department/);
});

test("placeholders stay bracketed — we never had the member's details", () => {
  const out = buildDisputeLetter({ findings: [finding()], totals: {} });
  for (const p of ["[YOUR NAME]", "[YOUR PHONE]", "[DATE OF SERVICE]", "[YOUR ACCOUNT NUMBER]"]) {
    assert.ok(out.includes(p), `missing placeholder ${p}`);
  }
  assert.match(out, /not legal advice/);
});

test("a missing responsibility total degrades to a dash, not NaN or undefined", () => {
  const out = buildDisputeLetter({ findings: [finding()], totals: {} });
  assert.doesNotMatch(out, /NaN|undefined/);
});
