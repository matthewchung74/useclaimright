import { test } from "node:test";
import assert from "node:assert/strict";
import { reserveModelCall, readGuard, spentToday, DEFAULT_DAILY_CALLS } from "../guard.js";

// Minimal Firestore stand-in: shard documents in a Map, plus the guard config.
// FieldValue.increment(n) arrives as a NumericIncrementTransform carrying an
// `operand` — the real object, since guard.js is exercised through exactly the
// surface it uses in production rather than an injected seam.
const incrementOf = (v) => (v && typeof v === "object" && typeof v.operand === "number" ? v.operand : null);
function fakeDb({ config = {}, counts = {}, configThrows = false } = {}) {
  const docs = new Map(Object.entries(counts).map(([k, v]) => [k, { count: v }]));
  return {
    docs,
    doc(path) {
      return {
        async get() {
          if (path === "meta/guard") {
            if (configThrows) throw new Error("firestore unavailable");
            return { exists: true, data: () => config };
          }
          return { exists: docs.has(path), data: () => docs.get(path) };
        },
        async set(val) {
          const cur = docs.get(path)?.count || 0;
          const inc = incrementOf(val.count);
          docs.set(path, { count: inc === null ? val.count : cur + inc });
        },
      };
    },
    async getAll(...refs) {
      return refs.map((r) => r.__snap());
    },
  };
}

// guard.js builds refs via db.doc(); give those refs a snapshot accessor so the
// batched read can resolve them without a second round trip.
function db(opts) {
  const d = fakeDb(opts);
  const origDoc = d.doc.bind(d);
  d.doc = (path) => {
    const ref = origDoc(path);
    ref.__snap = () => ({ exists: d.docs.has(path), data: () => d.docs.get(path) });
    return ref;
  };
  return d;
}

test("defaults are permissive when no config document exists", async () => {
  const g = await readGuard(db({ config: {} }));
  assert.equal(g.auditsEnabled, true);
  assert.equal(g.plansEnabled, true);
  assert.equal(g.dailyCalls, DEFAULT_DAILY_CALLS);
});

test("an unreadable config fails OPEN, not closed", async () => {
  // A transient Firestore error must not take the product down; the per-uid
  // limits still stand behind this.
  const g = await readGuard(db({ configThrows: true }));
  assert.equal(g.auditsEnabled, true);
  assert.equal(g.dailyCalls, DEFAULT_DAILY_CALLS);
});

test("the kill switch stops audits and plans independently", async () => {
  await assert.rejects(
    () => reserveModelCall(db({}), { kind: "audit", guard: { auditsEnabled: false, plansEnabled: true, dailyCalls: 100 } }),
    /paused/,
  );
  await assert.rejects(
    () => reserveModelCall(db({}), { kind: "plan", guard: { auditsEnabled: true, plansEnabled: false, dailyCalls: 100 } }),
    /paused/,
  );
  // Audits keep running while plan uploads are switched off.
  const d = db({});
  await reserveModelCall(d, { kind: "audit", guard: { auditsEnabled: true, plansEnabled: false, dailyCalls: 100 } });
  assert.equal(await spentToday(d), 1);
});

test("a call is reserved BEFORE the model runs, not counted after", async () => {
  const d = db({});
  await reserveModelCall(d, { kind: "audit", guard: { auditsEnabled: true, plansEnabled: true, dailyCalls: 100 } });
  // Counted already, with no model call having happened.
  assert.equal(await spentToday(d), 1);
});

test("release gives the reservation back when the call never happened", async () => {
  const d = db({});
  const guard = { auditsEnabled: true, plansEnabled: true, dailyCalls: 100 };
  const release = await reserveModelCall(d, { kind: "audit", guard });
  assert.equal(await spentToday(d), 1);
  await release();
  assert.equal(await spentToday(d), 0);
  await release(); // idempotent — a double release must not credit twice
  assert.equal(await spentToday(d), 0);
});

test("the ceiling is enforced across shards, not per shard", async () => {
  // Spread over several shards so a per-shard check would wave this through.
  const day = new Date().toISOString().slice(0, 10);
  const spread = {};
  spread[`meta/spend/${day}/shard-0`] = 3;
  spread[`meta/spend/${day}/shard-4`] = 4;
  spread[`meta/spend/${day}/shard-9`] = 3;
  const d2 = db({ counts: spread });
  assert.equal(await spentToday(d2), 10);
  await assert.rejects(
    () => reserveModelCall(d2, { kind: "audit", guard: { auditsEnabled: true, plansEnabled: true, dailyCalls: 10 } }),
    /today's limit/,
  );
});

test("spend is scoped to the day, so yesterday does not bar today", async () => {
  const counts = {};
  counts["meta/spend/2020-01-01/shard-0"] = 9999;
  const d = db({ counts });
  assert.equal(await spentToday(d), 0);
});
