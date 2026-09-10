import { test } from "node:test";
import assert from "node:assert/strict";
import { claimDaily } from "../ratelimit.js";

const AUDIT = { dayField: "day", countField: "count", limit: 10, message: "Daily limit of 10 audits reached." };
const PATH = "users/u1/meta/usage";

// Firestore stand-in: the one usage document in a Map, and a runTransaction
// that runs the read-modify-write to completion the way the real one does.
function fakeDb(seed) {
  const docs = new Map(seed ? [[PATH, seed]] : []);
  return {
    docs,
    doc: (path) => ({ path }),
    async runTransaction(fn) {
      return fn({
        async get(ref) {
          const data = docs.get(ref.path);
          return { exists: data !== undefined, data: () => data };
        },
        set(ref, val, opts) {
          docs.set(ref.path, opts?.merge ? { ...docs.get(ref.path), ...val } : val);
        },
      });
    },
  };
}

const today = () => new Date().toISOString().slice(0, 10);
const usage = (db) => db.docs.get(PATH);

test("an audit that runs costs exactly one of the day's ten", async () => {
  const db = fakeDb();
  await claimDaily(db, "u1", AUDIT);
  assert.deepEqual(usage(db), { day: today(), count: 1 });
});

test("an audit refused by the guard costs nothing", async () => {
  const db = fakeDb();
  const refund = await claimDaily(db, "u1", AUDIT);
  await refund();
  assert.equal(usage(db).count, 0);
});

test("refunding twice hands back only one", async () => {
  const db = fakeDb({ day: today(), count: 5 });
  const refund = await claimDaily(db, "u1", AUDIT);
  assert.equal(usage(db).count, 6);
  await Promise.all([refund(), refund()]);
  assert.equal(usage(db).count, 5);
});

test("a refund that lands after UTC midnight does not credit the new day", async () => {
  const db = fakeDb();
  const refund = await claimDaily(db, "u1", AUDIT);
  // The day turned over between the claim and the failure it is refunding.
  db.docs.set(PATH, { day: "2099-01-01", count: 3 });
  await refund();
  assert.deepEqual(usage(db), { day: "2099-01-01", count: 3 });
});

test("the cap still refuses at the limit", async () => {
  const db = fakeDb({ day: today(), count: 10 });
  await assert.rejects(() => claimDaily(db, "u1", AUDIT), /Daily limit of 10 audits reached/);
  assert.equal(usage(db).count, 10);
});

test("yesterday's count does not eat into today's allowance", async () => {
  const db = fakeDb({ day: "2020-01-01", count: 10 });
  await claimDaily(db, "u1", AUDIT);
  assert.deepEqual(usage(db), { day: today(), count: 1 });
});
