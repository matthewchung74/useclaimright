// Everything a request spends, in one place.
//
// Two budgets are claimed before the model runs: the member's daily allowance
// and the shared spend ceiling. Each call site used to open and unwind them by
// hand, and three separate bugs came out of that in one day — a paused audit
// charged the member, a paused plan upload charged the member, and "Replace
// anyway" charged twice. Each was a missing unwind at one site while the others
// were right.
//
// So the unwinds live here, and `docs/TESTING.md`'s cost ledger is the test.
import { reserveModelCall } from "./guard.js";
import { claimDaily } from "./ratelimit.js";

export const AUDIT = { kind: "audit", dayField: "day", countField: "count" };
export const PLAN = { kind: "plan", dayField: "planDay", countField: "planCount" };

// Claims both budgets. Throws before charging anything if either refuses.
export async function openBudget(db, uid, spec, { limit, message }) {
  const refundDaily = await claimDaily(db, uid, {
    dayField: spec.dayField, countField: spec.countField, limit, message,
  });

  let release;
  try {
    release = await reserveModelCall(db, { kind: spec.kind });
  } catch (err) {
    // The guard refused, so the model never ran. Charging a member for a
    // deliberate pause — and then inviting them to retry — is how ten taps
    // used to cost someone their day.
    await refundDaily();
    throw err;
  }

  return {
    // The call never reached a usable answer. Credit both: the shared ceiling
    // already did this, and leaving the member charged meant we refunded
    // ourselves and billed them for the same failure.
    async refund() {
      await release();
      await refundDaily();
    },
  };
}
