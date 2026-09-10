import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry, isTransient } from "../retry.js";

const noSleep = { sleep: async () => {} };
const fails = (err, times) => {
  let n = 0;
  return async () => { if (n++ < times) throw err; return "ok"; };
};
const vertex429 = Object.assign(new Error(
  '{"error":{"code":429,"message":"Resource exhausted. Please try again later.","status":"RESOURCE_EXHAUSTED"}}'), {});

test("the 429 a member actually hit is retried, and succeeds", async () => {
  assert.equal(await withRetry("plan", fails(vertex429, 1), noSleep), "ok");
});

test("a second failure propagates, so the refund and the alert still happen", async () => {
  await assert.rejects(() => withRetry("plan", fails(vertex429, 2), noSleep), /RESOURCE_EXHAUSTED/);
});

test("a working call is not called twice", async () => {
  let calls = 0;
  await withRetry("audit", async () => { calls++; return "ok"; }, noSleep);
  assert.equal(calls, 1);
});

// A 400 means the request is wrong. Sending it again is a second bill for the
// same answer.
test("a bad request is not retried", async () => {
  let calls = 0;
  const bad = Object.assign(new Error('{"error":{"code":400,"message":"Invalid argument"}}'));
  await assert.rejects(() => withRetry("audit", async () => { calls++; throw bad; }, noSleep));
  assert.equal(calls, 1);
});

// The identical oversized request truncates identically, and a ceiling meant to
// cap cost would double it.
test("a truncated response is not retried", async () => {
  let calls = 0;
  const cut = Object.assign(new Error("Model response hit the output ceiling and was truncated."), { terminal: true });
  await assert.rejects(() => withRetry("audit", async () => { calls++; throw cut; }, noSleep));
  assert.equal(calls, 1);
});

test("isTransient recognises what can succeed on a second try", () => {
  for (const m of ["429 RESOURCE_EXHAUSTED", "503 UNAVAILABLE", "socket hang up", "ECONNRESET", "DEADLINE_EXCEEDED"]) {
    assert.equal(isTransient(new Error(m)), true, m);
  }
  for (const m of ["400 Invalid argument", "403 Permission denied", "This doesn't look like a Summary of Benefits."]) {
    assert.equal(isTransient(new Error(m)), false, m);
  }
});

// The status may arrive on the error object rather than in its text.
test("a status carried as a field is recognised too", () => {
  assert.equal(isTransient(Object.assign(new Error("failed"), { status: 429 })), true);
  assert.equal(isTransient(Object.assign(new Error("failed"), { code: "UNAVAILABLE" })), true);
});

test("the backoff is awaited before the second attempt", async () => {
  const order = [];
  await withRetry("plan", fails(vertex429, 1), {
    sleep: async () => { order.push("waited"); },
  });
  assert.deepEqual(order, ["waited"]);
});
