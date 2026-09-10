import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

// THE LAYER BETWEEN UNIT TESTS AND A HUMAN CLICKING.
//
// Every defect found on 2026-09-10 needed server state flipped — a guard
// switch, a counter, a parked extraction — and then an outcome checked. The
// unit tests cannot flip state, the browser suite never reaches the functions,
// so the only thing that could do it was a person pasting curl at a production
// database. That is why these paths shipped unverified.
//
// This runs the REAL exported handlers against a real Firestore, so the wiring
// inside analyze() and extractPlan() is covered, not just the modules they call.
//
//   firebase emulators:start --only firestore,auth
//   npm run test:integration
//
// Skipped, not failed, when the emulator is not running: the emulator needs a
// Java runtime, and a suite that fails on a laptop without one trains people to
// ignore it.
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const opts = { skip: EMULATOR ? false : "needs FIRESTORE_EMULATOR_HOST (firebase emulators:start --only firestore,auth)" };

let fns, db, UID = "integration-uid";
const usagePath = () => `users/${UID}/meta/usage`;

before(async () => {
  if (!EMULATOR) return;
  process.env.GCLOUD_PROJECT ||= "useclaimright";
  fns = await import("../index.js");
  ({ getFirestore: db } = await import("firebase-admin/firestore"));
  db = db();
});

async function reset(guard) {
  for (const p of [usagePath(), `users/${UID}/plan/active`, `users/${UID}/plan/pending`]) {
    await db.doc(p).delete();
  }
  const day = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 10; i++) await db.doc(`meta/spend/${day}/shard-${i}`).delete();
  await db.doc("meta/guard").set(guard);
}

const usage = async () => (await db.doc(usagePath()).get()).data() || {};
const call = (fn, data) => fn.run({ auth: { uid: UID, token: {} }, data, acceptsStreaming: false });
const ON = { auditsEnabled: true, plansEnabled: true, dailyCalls: 2000 };

beforeEach(async () => { if (EMULATOR) await reset(ON); });

// --- the ledger, through the real handler rather than its parts -------------

test("paused audits charge nothing, end to end", opts, async () => {
  await reset({ ...ON, auditsEnabled: false });
  await assert.rejects(
    () => call(fns.analyze, { bill: { text: "Itemized statement. 90837 $175.00" } }),
    /paused right now/,
  );
  assert.equal((await usage()).count ?? 0, 0, "a member charged for a pause loses their day to retries");
});

test("paused plan uploads charge nothing, and do not touch the audit count", opts, async () => {
  await reset({ ...ON, plansEnabled: false });
  await assert.rejects(
    () => call(fns.extractPlan, { sbc: { text: "Summary of Benefits and Coverage" } }),
    /paused right now/,
  );
  const u = await usage();
  assert.equal(u.planCount ?? 0, 0);
  assert.equal(u.count ?? 0, 0);
});

test("the global ceiling charges nothing", opts, async () => {
  await reset({ ...ON, dailyCalls: 1 });
  const day = new Date().toISOString().slice(0, 10);
  await db.doc(`meta/spend/${day}/shard-0`).set({ count: 5 });
  await assert.rejects(
    () => call(fns.analyze, { bill: { text: "Itemized statement. 90837 $175.00" } }),
    /today's limit across all users/,
  );
  assert.equal((await usage()).count ?? 0, 0);
});

test("a bill with no text and no pages is refused before anything is charged", opts, async () => {
  await assert.rejects(() => call(fns.analyze, { bill: { text: "  " } }), /bill is required/);
  assert.equal((await usage()).count ?? 0, 0, "input validation runs before the budget opens");
});

// --- the confirm_older round trip: deployed 2026-09-10, unverified until now -

test("'Replace anyway' collects the parked extraction instead of paying twice", opts, async () => {
  await db.doc(`users/${UID}/plan/pending`).set({
    structured: { planYearStart: "2018-01-01", planYearEnd: "2018-12-31", deductible: { individual: 500 } },
    text: "Summary of Benefits and Coverage",
    sourceName: "dol-sample-2.pdf", sourceHash: "hash-2", tokens: null,
    savedAt: Date.now(),
  });

  const out = await call(fns.extractPlan, {
    sbc: { text: "Summary of Benefits and Coverage" }, sourceHash: "hash-2", force: true,
  });

  assert.equal(out.status, "stored");
  assert.equal(out.structured.planYearStart, "2018-01-01", "the plan the model already read, not a fresh one");
  assert.equal((await usage()).planCount ?? 0, 0, "the confirm must not spend a second upload");
  assert.equal((await db.doc(`users/${UID}/plan/active`).get()).data().sourceName, "dol-sample-2.pdf");
  assert.equal((await db.doc(`users/${UID}/plan/pending`).get()).exists, false, "and must not be replayable");
});

test("a force with nothing parked still pays, so the cap cannot be skipped", opts, async () => {
  // No pending document. Reaching the model would need a key; the assertion is
  // that it gets that far — past the resume shortcut and into the budget.
  await reset({ ...ON, plansEnabled: false });
  await assert.rejects(
    () => call(fns.extractPlan, { sbc: { text: "Summary of Benefits" }, sourceHash: "nope", force: true }),
    /paused right now/,
    "force fell through to the guard rather than storing something unpaid for",
  );
});

test("a parked extraction for a different document is not collected", opts, async () => {
  // Guard off, so falling through to the paid path is a refusal rather than a
  // model call — which is how we tell "did not collect" from "collected".
  await reset({ ...ON, plansEnabled: false });
  await db.doc(`users/${UID}/plan/pending`).set({
    structured: { planYearStart: "2018-01-01" }, text: "x",
    sourceName: "someone-elses.pdf", sourceHash: "hash-A", tokens: null, savedAt: Date.now(),
  });
  await assert.rejects(
    () => call(fns.extractPlan, { sbc: { text: "Summary of Benefits" }, sourceHash: "hash-B", force: true }),
    /paused right now/,
  );
  assert.equal((await db.doc(`users/${UID}/plan/active`).get()).exists, false, "a mismatched hash must store nothing");
});
