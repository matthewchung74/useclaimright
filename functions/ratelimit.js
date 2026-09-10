import { HttpsError } from "firebase-functions/v2/https";

// Claims one of a member's daily allowances, and returns a refund() for the
// case where the work never reaches the model — mirroring reserveModelCall's
// release(), which does the same for the shared spend budget.
//
// The refund exists because the claim happens BEFORE the spend guard is
// consulted. With audits paused, a member was charged one of their ten for a
// call that never ran, and the message they saw invited them to retry, which
// charged another. Ten taps during a pause and their day was gone, with nothing
// to show for it. Found by running G1 on 2026-09-09.
export async function claimDaily(db, uid, { dayField, countField, limit, message }) {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`users/${uid}/meta/usage`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const count = data[dayField] === day ? data[countField] || 0 : 0;
    if (count >= limit) throw new HttpsError("resource-exhausted", message);
    tx.set(ref, { [dayField]: day, [countField]: count + 1 }, { merge: true });
  });

  let refunded = false;
  return async () => {
    // A refund is not a second allowance: calling it twice must not hand back
    // two. Under-counting is the worse failure of the two.
    if (refunded) return;
    refunded = true;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};
      // Refund only the day we charged. Past UTC midnight the increment belongs
      // to a day that is already closed, and crediting today would invent one.
      if (data[dayField] !== day) return;
      tx.set(ref, { [dayField]: day, [countField]: Math.max(0, (data[countField] || 0) - 1) }, { merge: true });
    });
  };
}
