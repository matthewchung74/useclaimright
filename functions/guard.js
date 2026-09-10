// The spend guard: a global ceiling on model calls, and a switch to stop them.
//
// Every other limit in this codebase is per-uid. Sign-in is a Google popup or
// an email link, so per-uid limits bound one account and nothing else — a
// thousand throwaway accounts are a thousand times the ceiling. This is the
// only thing that bounds the bill.
//
// Two properties matter more than they look:
//
//   RESERVE BEFORE THE CALL. A counter incremented after the model returns caps
//   nothing during the burst it exists to stop: a hundred concurrent requests
//   all read zero, all proceed, and the count arrives afterwards. Reserve
//   first, release if the call never happened.
//
//   SHARD THE COUNTER. A single Firestore document sustains roughly one write
//   per second. Under the traffic this is meant to survive, one document IS the
//   outage. Writes spread across N shards; reads sum them.
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";

const SHARDS = 10;
export const DEFAULT_DAILY_CALLS = 2000; // ~$20/day at present rates, well above real use

const today = () => new Date().toISOString().slice(0, 10); // UTC; the UI shows local
const shardRef = (db, day, i) => db.doc(`meta/spend/${day}/shard-${i}`);

// Config lives in one document so it can be changed from the console without a
// deploy — the difference between stopping a runaway in seconds and in minutes.
export async function readGuard(db) {
  try {
    const snap = await db.doc("meta/guard").get();
    const d = snap.exists ? snap.data() : {};
    return {
      auditsEnabled: d.auditsEnabled !== false,
      plansEnabled: d.plansEnabled !== false,
      dailyCalls: typeof d.dailyCalls === "number" ? d.dailyCalls : DEFAULT_DAILY_CALLS,
    };
  } catch (err) {
    // A guard that fails closed takes the product down on a transient Firestore
    // blip; one that fails open leaves the per-uid limits standing. Open, loudly.
    console.error("guard config unreadable — falling back to defaults", { message: err.message });
    return { auditsEnabled: true, plansEnabled: true, dailyCalls: DEFAULT_DAILY_CALLS };
  }
}

export async function spentToday(db, day = today()) {
  const snaps = await db.getAll(...Array.from({ length: SHARDS }, (_, i) => shardRef(db, day, i)));
  return snaps.reduce((n, s) => n + (s.exists ? s.data().count || 0 : 0), 0);
}

// Claim one model call. Throws when the switch is off or the day is spent.
// Returns a release() to call if the work never reached the model.
export async function reserveModelCall(db, { kind = "audit", guard }) {
  const g = guard ?? (await readGuard(db));
  if (kind === "audit" && !g.auditsEnabled) {
    throw new HttpsError("unavailable", "Audits are paused right now. Please try again later.");
  }
  if (kind === "plan" && !g.plansEnabled) {
    throw new HttpsError("unavailable", "Plan uploads are paused right now. Please try again later.");
  }

  const day = today();
  const i = Math.floor(Math.random() * SHARDS);
  // Read the total before claiming. Racing requests can overshoot by roughly the
  // number in flight, which is a handful of cents and the price of not making
  // every audit wait on one document.
  const spent = await spentToday(db, day);
  if (spent >= g.dailyCalls) {
    console.error("global daily model-call ceiling reached", { day, spent, ceiling: g.dailyCalls });
    // Marked so the client can tell this apart from a member's own daily cap.
    // Both are resource-exhausted, and the cap has a dialog naming a number and
    // a reset time that are simply untrue of a global ceiling. Running G1's
    // ceiling leg on 2026-09-10 showed "That's today's 10 audits" to someone who
    // had used eight.
    throw new HttpsError("resource-exhausted", "We've hit today's limit across all users. Please try again tomorrow.", { scope: "global" });
  }
  await shardRef(db, day, i).set({ count: FieldValue.increment(1) }, { merge: true });

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await shardRef(db, day, i).set({ count: FieldValue.increment(-1) }, { merge: true });
    } catch (err) {
      // Losing a release overcounts by one. Never fail a request over it.
      console.error("could not release reserved model call", { message: err.message });
    }
  };
}
