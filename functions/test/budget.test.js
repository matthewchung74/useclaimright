import { test } from "node:test";
import assert from "node:assert/strict";
import { openBudget, AUDIT, PLAN } from "../budget.js";

// THE COST LEDGER. One row per way a request can end. Three cost bugs in one
// day were each a missing unwind at one call site, and every one of them would
// have shown up here as a number that did not match the row.
//
// A row saying "charged" is a claim that the member got something for it.

const DAY = new Date().toISOString().slice(0, 10);
const USAGE = "users/u1/meta/usage";
const inc = (v) => (v && typeof v === "object" && typeof v.operand === "number" ? v.operand : null);

// Firestore stand-in covering both shapes these paths use: the transactional
// usage document, and the sharded spend counter read through getAll.
function fakeDb(guard = {}) {
  const docs = new Map();
  const ref = (path) => ({
    path,
    async get() {
      const d = docs.get(path);
      return { exists: d !== undefined, data: () => d };
    },
    async set(val, opts) {
      const cur = docs.get(path) || {};
      const merged = { ...(opts?.merge ? cur : {}) };
      for (const [k, v] of Object.entries(val)) {
        const n = inc(v);
        merged[k] = n === null ? v : (cur[k] || 0) + n;
      }
      docs.set(path, merged);
    },
  });
  return {
    docs,
    doc(path) {
      if (path === "meta/guard") {
        return { async get() { return { exists: true, data: () => guard }; } };
      }
      return ref(path);
    },
    async getAll(...refs) { return Promise.all(refs.map((r) => r.get())); },
    async runTransaction(fn) {
      return fn({ get: (r) => r.get(), set: (r, v, o) => r.set(v, o) });
    },
  };
}

const ON = { auditsEnabled: true, plansEnabled: true, dailyCalls: 2000 };
const spend = (db) => [...db.docs].filter(([k]) => k.startsWith("meta/spend/")).reduce((n, [, v]) => n + (v.count || 0), 0);
const daily = (db, spec) => db.docs.get(USAGE)?.[spec.countField] || 0;

const open = (db, spec) =>
  openBudget(db, "u1", spec, { limit: 10, message: "Daily limit reached." });

// --- the model ran and the member got an answer: both budgets keep the charge
test("ledger: a successful audit charges the member once and the ceiling once", async () => {
  const db = fakeDb(ON);
  await open(db, AUDIT);
  assert.equal(daily(db, AUDIT), 1);
  assert.equal(spend(db), 1);
});

test("ledger: a successful plan upload charges planCount, not count", async () => {
  const db = fakeDb(ON);
  await open(db, PLAN);
  assert.equal(daily(db, PLAN), 1);
  assert.equal(daily(db, AUDIT), 0);
  assert.equal(spend(db), 1);
});

// --- the guard refused: the model never ran, so nothing is charged
test("ledger: audits paused charges nothing", async () => {
  const db = fakeDb({ ...ON, auditsEnabled: false });
  await assert.rejects(() => open(db, AUDIT), /paused/);
  assert.equal(daily(db, AUDIT), 0);
  assert.equal(spend(db), 0);
});

test("ledger: plan uploads paused charges nothing, and leaves audits alone", async () => {
  const db = fakeDb({ ...ON, plansEnabled: false });
  await assert.rejects(() => open(db, PLAN), /paused/);
  assert.equal(daily(db, PLAN), 0);
  assert.equal(spend(db), 0);
});

test("ledger: the global ceiling charges nothing", async () => {
  const db = fakeDb({ ...ON, dailyCalls: 1 });
  db.docs.set(`meta/spend/${DAY}/shard-0`, { count: 1 });
  await assert.rejects(() => open(db, AUDIT), /today's limit/);
  assert.equal(daily(db, AUDIT), 0);
  assert.equal(spend(db), 1); // unchanged — the pre-existing spend, not ours
});

// --- the model ran and failed: the row that was red until 2026-09-10
test("ledger: a model failure charges the member nothing, not just the ceiling", async () => {
  const db = fakeDb(ON);
  const budget = await open(db, AUDIT);
  assert.equal(daily(db, AUDIT), 1, "charged up front, as it must be");
  await budget.refund();
  assert.equal(daily(db, AUDIT), 0, "the member got no answer, so no charge");
  assert.equal(spend(db), 0, "and neither did we");
});

test("ledger: a plan-extraction failure refunds the upload too", async () => {
  const db = fakeDb(ON);
  const budget = await open(db, PLAN);
  await budget.refund();
  assert.equal(daily(db, PLAN), 0);
  assert.equal(spend(db), 0);
});

// --- retries must not turn one failure into extra allowance
test("ledger: refunding twice hands back one", async () => {
  const db = fakeDb(ON);
  db.docs.set(USAGE, { day: DAY, count: 4 });
  const budget = await open(db, AUDIT);
  assert.equal(daily(db, AUDIT), 5);
  await budget.refund();
  await budget.refund();
  assert.equal(daily(db, AUDIT), 4);
  assert.equal(spend(db), 0);
});
