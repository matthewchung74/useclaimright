import { test } from "node:test";
import assert from "node:assert/strict";
import { parkPlan, takePendingPlan, PENDING_TTL_MS } from "../pendingplan.js";

const PATH = "users/u1/plan/pending";
const PLAN = { structured: { planYearStart: "2018-01-01" }, text: "sbc", sourceName: "dol-sample-2.pdf", sourceHash: "abc", tokens: null };

function fakeDb() {
  const docs = new Map();
  return {
    docs,
    doc: (path) => ({
      async get() {
        const data = docs.get(path);
        return { exists: data !== undefined, data: () => data };
      },
      async set(val) { docs.set(path, val); },
      async delete() { docs.delete(path); },
    }),
  };
}

test("the confirm collects the extraction the model already paid for", async () => {
  const db = fakeDb();
  await parkPlan(db, "u1", PLAN);
  const got = await takePendingPlan(db, "u1", "abc");
  assert.equal(got.sourceName, "dol-sample-2.pdf");
  assert.deepEqual(got.structured, PLAN.structured);
});

test("collecting clears it, so one park cannot store two plans", async () => {
  const db = fakeDb();
  await parkPlan(db, "u1", PLAN);
  assert.ok(await takePendingPlan(db, "u1", "abc"));
  assert.equal(await takePendingPlan(db, "u1", "abc"), null);
  assert.equal(db.docs.has(PATH), false);
});

test("a force for a different document collects nothing", async () => {
  const db = fakeDb();
  await parkPlan(db, "u1", PLAN);
  assert.equal(await takePendingPlan(db, "u1", "different"), null);
  // Cleared even so: a mismatch is not an invitation to try other hashes.
  assert.equal(db.docs.has(PATH), false);
});

test("a force with nothing parked collects nothing, so the cap still bites", async () => {
  assert.equal(await takePendingPlan(fakeDb(), "u1", "abc"), null);
});

test("a stale park is not collected", async () => {
  const db = fakeDb();
  await parkPlan(db, "u1", PLAN);
  assert.equal(await takePendingPlan(db, "u1", "abc", Date.now() + PENDING_TTL_MS + 1), null);
});
