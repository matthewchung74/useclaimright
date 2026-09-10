// Trying again for the member, once, when the failure was not theirs.
//
// Vertex answers 429 RESOURCE_EXHAUSTED when its own capacity is short — not
// because the member did anything and not because anything here is wrong. One
// such failure in fifteen calls on 2026-09-10, and what the member saw was
// "Plan extraction failed — please try again": a dead end for a problem that
// clears by itself in a second. They were not charged, but they were stopped.

// Only the classes that can succeed on a second attempt. A 400 means the
// request itself is wrong and sending it again is just a second bill.
const TRANSIENT = /\b(429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED)\b|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i;

// `terminal` is excluded for the same reason it is excluded from the schema
// retry: a response truncated at the output ceiling truncates identically when
// the identical oversized request is sent again, and a ceiling meant to cap
// cost would double it instead.
export const isTransient = (err) =>
  !err?.terminal &&
  TRANSIENT.test(`${err?.status ?? ""} ${err?.code ?? ""} ${err?.message ?? ""}`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Two attempts, not five. The member is already watching a spinner, so a second
// of backoff costs them nothing they are not already spending — but past one
// retry it is not a blip, and making them wait longer for the same failure is
// unkind. The second failure propagates untouched, so budget.refund() and the
// MODEL_CALL_FAILED alert behave exactly as they did.
export async function withRetry(label, fn, { delayMs = 1500, sleep = wait } = {}) {
  try {
    return await fn();
  } catch (err) {
    if (!isTransient(err)) throw err;
    console.warn(JSON.stringify({
      marker: "MODEL_RETRY", label, reason: String(err?.message ?? "").slice(0, 200),
    }));
    await sleep(delayMs);
    return fn();
  }
}
