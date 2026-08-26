import test from "node:test";
import assert from "node:assert/strict";
import { letterAccess, spendCredit, grantCredits, LETTER_PRICE_CENTS } from "../payments.js";

// --- access ---

test("no credits and nothing unlocked means payment required", () => {
  assert.deepEqual(letterAccess({}, "a1"), { allowed: false, reason: "payment_required" });
  assert.deepEqual(letterAccess(undefined, "a1"), { allowed: false, reason: "payment_required" });
});

test("a credit opens any letter; an unlock opens only its own audit", () => {
  assert.equal(letterAccess({ letterCredits: 1 }, "a1").reason, "credit_available");
  assert.equal(letterAccess({ unlockedAudits: ["a1"] }, "a1").reason, "already_purchased");
  assert.equal(letterAccess({ unlockedAudits: ["a1"] }, "a2").allowed, false);
});

// --- spending: the double-charge guard ---

test("REGRESSION GUARD: re-opening a letter already bought does not spend again", () => {
  // The failure a member would rightly be angry about: paying twice for one letter.
  const after = spendCredit({ letterCredits: 1, unlockedAudits: ["a1"] }, "a1");
  assert.equal(after.changed, false);
  assert.equal(after.next.letterCredits, 1, "credit must survive");
});

test("spending a credit unlocks that audit permanently", () => {
  // Start with exactly one credit, so "a2 is still locked" actually tests the
  // unlock rather than a leftover credit.
  const { changed, next } = spendCredit({ letterCredits: 1, unlockedAudits: [] }, "a1");
  assert.equal(changed, true);
  assert.equal(next.letterCredits, 0);
  assert.deepEqual(next.unlockedAudits, ["a1"]);
  assert.equal(letterAccess(next, "a1").allowed, true, "stays open with no credits left");
  assert.equal(letterAccess(next, "a2").allowed, false, "the unlock is per-audit, not a pass");
});

test("a spare credit still opens a different letter", () => {
  const { next } = spendCredit({ letterCredits: 2, unlockedAudits: [] }, "a1");
  assert.equal(next.letterCredits, 1);
  assert.equal(letterAccess(next, "a2").reason, "credit_available");
});

test("spending with no credits changes nothing", () => {
  const { changed, next } = spendCredit({ letterCredits: 0 }, "a1");
  assert.equal(changed, false);
  assert.equal((next.unlockedAudits || []).length, 0);
});

// --- granting: the double-grant guard ---

test("REGRESSION GUARD: a replayed Stripe event grants only once", () => {
  // Stripe retries on any non-2xx and re-delivers on a slow response. Without
  // this one payment becomes two credits.
  const first = grantCredits({}, { eventId: "evt_1" });
  assert.equal(first.changed, true);
  assert.equal(first.next.letterCredits, 1);
  const replay = grantCredits(first.next, { eventId: "evt_1" });
  assert.equal(replay.changed, false);
  assert.equal(replay.next.letterCredits, 1, "a retry must not add a second credit");
});

test("distinct events each grant", () => {
  const a = grantCredits({}, { eventId: "evt_1" }).next;
  const b = grantCredits(a, { eventId: "evt_2" }).next;
  assert.equal(b.letterCredits, 2);
});

test("the replay guard stays bounded", () => {
  let e = {};
  for (let i = 0; i < 80; i++) e = grantCredits(e, { eventId: `evt_${i}` }).next;
  assert.equal(e.letterCredits, 80);
  assert.equal(e.stripeEvents.length, 50, "keeps a window, not an audit log");
  // the most recent are the ones that matter for replay
  assert.ok(e.stripeEvents.includes("evt_79"));
});

test("a full purchase cycle: grant, spend, re-open free", () => {
  let e = grantCredits({}, { eventId: "evt_x" }).next;
  assert.equal(letterAccess(e, "a1").allowed, true);
  e = spendCredit(e, "a1").next;
  assert.equal(e.letterCredits, 0);
  assert.equal(letterAccess(e, "a1").reason, "already_purchased"); // re-open, still free
  assert.equal(letterAccess(e, "a2").allowed, false);             // a different audit is not
});

test("price is the documented one, in cents", () => {
  assert.equal(LETTER_PRICE_CENTS, 499);
});
