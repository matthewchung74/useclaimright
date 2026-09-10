// A confirm_older round trip must not re-extract the document.
//
// The server reads the SBC, decides the incoming plan year is older than the
// one on file, and asks the member to confirm. It used to discard the extracted
// plan and, on "Replace anyway", read the whole document again — a second plan
// upload off a cap of three, and a second paid model call, for one document.
// One upload of dol-sample-2.pdf moved planCount by two. Found running P1 on
// 2026-09-10.
//
// So the extraction is parked and the confirm collects it. The window is short
// and the source hash must match, because the alternative — force alone being
// enough — would let a client skip the cap by always sending it.

// Long enough to read a dialog and decide, short enough that a parked copy of
// someone's plan is not sitting around.
export const PENDING_TTL_MS = 15 * 60 * 1000;

const pendingRef = (db, uid) => db.doc(`users/${uid}/plan/pending`);

export async function parkPlan(db, uid, plan) {
  await pendingRef(db, uid).set({ ...plan, savedAt: Date.now() });
}

// Returns the parked extraction and clears it, or null — in which case the
// caller pays for a fresh one, exactly as it would have without any of this.
export async function takePendingPlan(db, uid, sourceHash, now = Date.now()) {
  const ref = pendingRef(db, uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const plan = snap.data();
  await ref.delete(); // Single-use whether or not it turns out to be usable.
  if (plan.sourceHash !== sourceHash) return null;
  if (now - (plan.savedAt || 0) > PENDING_TTL_MS) return null;
  return plan;
}
