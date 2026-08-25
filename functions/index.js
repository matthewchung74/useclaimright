import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Ajv from "ajv";
import { findingsSchema, computeAtStake, verifyEvidence } from "./schema.js";
import { addUsage, estimateCostUsd } from "./cost.js";
import { runAudit, runPlanExtract } from "./providers/gemini.js";
import { planSchema, buildDigest, replaceDecision, applyPlanGate } from "./plan.js";
import { validateFeedback } from "./feedback.js";
import { reserveModelCall } from "./guard.js";

initializeApp();
const db = getFirestore();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const MODEL_ID = process.env.MODEL_ID || "gemini-3.6-flash";
// Off until the client sets APP_CHECK_SITE_KEY and that build is live. Turning
// this on first rejects every request from every user.
const ENFORCE_APP_CHECK = process.env.APP_CHECK === "on";
// A long itemized hospital bill runs to a few thousand characters, not 200k.
// The old ceiling was three times the worst-case cost per audit for no benefit.
// Over-limit truncates with a note rather than rejecting: bouncing a real
// stranger's real bill is the more expensive failure.
const MAX_DOC_CHARS = 60_000;
// Page images are billed per page and arrive base64-encoded in the callable
// payload, so both count. Generous for a real bill, bounded against abuse.
const MAX_PAGES = 20;
const MAX_IMAGE_BYTES = 12_000_000;
const DAILY_LIMIT = 10;

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(findingsSchema);

async function checkRateLimit(uid) {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`users/${uid}/meta/usage`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const count = data.day === day ? data.count || 0 : 0;
    if (count >= DAILY_LIMIT) {
      throw new HttpsError("resource-exhausted", `Daily limit of ${DAILY_LIMIT} audits reached.`);
    }
    tx.set(ref, { day, count: count + 1 }, { merge: true });
  });
}

const PLAN_DAILY_LIMIT = 3;
const FEEDBACK_DAILY_LIMIT = 20;
const validatePlan = ajv.compile(planSchema);

async function checkFeedbackRateLimit(uid) {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`users/${uid}/meta/usage`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const count = data.fbDay === day ? data.fbCount || 0 : 0;
    if (count >= FEEDBACK_DAILY_LIMIT) {
      throw new HttpsError("resource-exhausted", "Daily feedback limit reached — thank you for all the notes!");
    }
    tx.set(ref, { ...data, fbDay: day, fbCount: count + 1 }, { merge: true });
  });
}

// In-app feedback: auth-gated, validated, written server-side only (rules deny
// all client access to the feedback collection). Read in the Firebase console.
export const submitFeedback = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30, enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to send feedback.");
    const v = validateFeedback(request.data || {});
    if (!v.ok) throw new HttpsError("invalid-argument", v.errors.join("; "));
    await checkFeedbackRateLimit(request.auth.uid);
    await db.collection("feedback").add({
      uid: request.auth.uid,
      email: request.auth.token?.email ?? null,
      ...v.value,
      platform: "web",
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  }
);

async function checkPlanRateLimit(uid) {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`users/${uid}/meta/usage`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const count = data.planDay === day ? data.planCount || 0 : 0;
    if (count >= PLAN_DAILY_LIMIT) {
      throw new HttpsError("resource-exhausted", `Daily limit of ${PLAN_DAILY_LIMIT} plan uploads reached.`);
    }
    tx.set(ref, { ...data, planDay: day, planCount: count + 1 }, { merge: true });
  });
}

export const analyze = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
    secrets: [GEMINI_API_KEY],
    enforceAppCheck: ENFORCE_APP_CHECK,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to run an audit.");
    }
    const uid = request.auth.uid;
    // A document arrives one of two ways: as text (it had a text layer), or as
    // page images (it was a scan or a photo, and the model reads it).
    const { bill, eob, ocrConfidence } = request.data || {};
    const doc = (d) => ({ text: typeof d?.text === "string" ? d.text : "", images: Array.isArray(d?.images) ? d.images : [] });
    const billDoc = doc(bill);
    const eobDoc = doc(eob);

    if (!billDoc.text.trim() && !billDoc.images.length) {
      throw new HttpsError("invalid-argument", "The bill is required, as text or page images.");
    }
    const clip = (t, label) => {
      if (t.length <= MAX_DOC_CHARS) return t;
      console.warn("document truncated", { uid, label, from: t.length, to: MAX_DOC_CHARS });
      return `${t.slice(0, MAX_DOC_CHARS)}\n\n[TRUNCATED: this document was longer than we analyze. Findings cover only the text above.]`;
    };
    billDoc.text = clip(billDoc.text, "bill");
    eobDoc.text = clip(eobDoc.text, "eob");
    const pages = billDoc.images.length + eobDoc.images.length;
    if (pages > MAX_PAGES) {
      throw new HttpsError("invalid-argument", `Too many pages (${pages}); the limit is ${MAX_PAGES}.`);
    }
    const imageBytes = [...billDoc.images, ...eobDoc.images].reduce((n, d) => n + d.length, 0);
    if (imageBytes > MAX_IMAGE_BYTES) {
      throw new HttpsError("invalid-argument", "Those pages are too large. Try a lower-resolution scan.");
    }

    await checkRateLimit(uid);
    const release = await reserveModelCall(db, { kind: "audit" });

    let plan = null;
    try {
      plan = (await db.doc(`users/${uid}/plan/active`).get()).data() ?? null;
    } catch (err) {
      console.error("plan fetch failed — auditing without plan", { uid, message: err.message });
    }

    const opts = { modelId: MODEL_ID, apiKey: GEMINI_API_KEY.value() };
    // Build the digest here rather than reading the copy stored at upload time:
    // it is a derived view of `structured`, so a stored one silently freezes the
    // format the day the SBC was uploaded and no fix reaches existing plans.
    const planDigest = plan?.structured ? buildDigest(plan.structured) : plan?.digest || null;
    let result, usage = null;
    try {
      const first = await runAudit(billDoc, eobDoc, opts, planDigest);
      usage = addUsage(null, first.usage);
      result = first.data;
      if (!validate(result)) {
        // One retry with the validation errors appended so the model can self-correct.
        // It bills a second time, which is why usage accumulates rather than replaces.
        // Not reached when the first call was truncated — that throws terminal.
        const errText = ajv.errorsText(validate.errors);
        const retry = await runAudit(
          billDoc,
          { ...eobDoc, text: `${eobDoc.text}\n\n[SYSTEM NOTE: your previous response failed schema validation: ${errText}. Return valid JSON matching the schema exactly.]` },
          opts,
          planDigest
        );
        usage = addUsage(usage, retry.usage);
        result = retry.data;
        if (!validate(result)) {
          throw new HttpsError("internal", "Analysis produced invalid output. Please try again.");
        }
      }
    } catch (err) {
      await release();
      if (err instanceof HttpsError) throw err;
      console.error("runAudit failed", { uid, model: MODEL_ID, message: err.message, terminal: !!err.terminal });
      if (err.terminal) {
        throw new HttpsError("resource-exhausted", "This document produced more output than we can handle. Try auditing fewer pages at once.");
      }
      throw new HttpsError("internal", "Analysis failed. Please try again.");
    }

    const gated = applyPlanGate(result, plan?.structured ?? null);
    result = gated.result;
    const { planApplied, planReason } = gated;

    // Every quote must be in the document it cites. The schema proves the quote
    // is a string; only this proves it is real. Findings that fail are dropped
    // before anything is shown or written, because they end up in a letter the
    // member sends to a provider.
    // Verify against whatever text we actually have. For a scanned document
    // that is the model's own transcription: weaker than independent ground
    // truth, but it still catches a quote the model did not read anywhere.
    const billSource = billDoc.text.trim() || result.billText || "";
    const eobSource = eobDoc.text.trim() || result.eobText || "";
    const verified = verifyEvidence(result, { bill: billSource, eob: eobSource, sbc: planDigest });
    result = verified.result;
    if (verified.dropped.length) {
      // Loud, because the drop is silent to the user: this is the only place a
      // fabrication rate becomes visible.
      console.error("unverified evidence dropped", { uid, model: MODEL_ID, dropped: verified.dropped });
    }

    // The headline number is ours to compute, not the model's to assert: it must
    // equal the findings actually shown, minus advisory ones. Runs after the
    // plan gate and the evidence check so stripped findings are already gone.
    result = { ...result, totals: { ...result.totals, totalAtStake: computeAtStake(result.findings, result.totals?.billed) } };

    // What this audit actually cost, in the log and on the document. Counts are
    // the durable record; the dollar figure is derived at read time from a
    // price list that changes.
    const costUsd = estimateCostUsd(usage, MODEL_ID);
    console.log("audit usage", { uid, model: MODEL_ID, ...usage, costUsd });

    // Firestore caps a document at 1,048,576 bytes. Both documents plus the
    // findings live in one, and this write happens AFTER the model is billed —
    // a breach means the user paid and got an error. Trim the stored text
    // rather than lose the audit; the findings are the valuable part.
    const BUDGET = 700_000; // headroom for findings, occurrence table and metadata
    let billStore = billSource, eobStore = eobSource;
    if (Buffer.byteLength(billStore) + Buffer.byteLength(eobStore) > BUDGET) {
      const half = Math.floor(BUDGET / 2);
      billStore = billStore.slice(0, half);
      eobStore = eobStore.slice(0, half);
      console.warn("stored document text trimmed to fit the Firestore limit", { uid });
    }

    const auditRef = db.collection(`users/${uid}/audits`).doc();
    await auditRef.set({
      // The text the audit was actually reasoned over. For scans this is the
      // model's transcription, which is also what the client's bill fingerprint
      // and saved-EOB matching run on. Page images are never stored.
      bill: billStore,
      eob: eobStore,
      findings: result.findings,
      totals: result.totals,
      occurrenceTable: result.occurrenceTable,
      serviceDates: result.serviceDates,
      provider: result.provider,
      patientName: result.patientName || "",
      payerRemarks: result.payerRemarks,
      accumulators: result.accumulators,
      model: MODEL_ID,
      tokens: usage, // {input, output, total, calls} — calls > 1 means a retry billed twice
      ocrConfidence: typeof ocrConfidence === "number" ? ocrConfidence : null,
      planApplied,
      planReason,
      droppedUnverified: verified.dropped.length,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { auditId: auditRef.id, planApplied, planReason, ...result };
  }
);

export const extractPlan = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
    secrets: [GEMINI_API_KEY],
    enforceAppCheck: ENFORCE_APP_CHECK,
  },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to add your plan.");
    const uid = request.auth.uid;
    const { sbc, sourceName, force } = request.data || {};
    const sbcDoc = {
      text: typeof sbc?.text === "string" ? sbc.text : "",
      images: Array.isArray(sbc?.images) ? sbc.images : [],
    };
    if (!sbcDoc.text.trim() && !sbcDoc.images.length) {
      throw new HttpsError("invalid-argument", "The SBC is required, as text or page images.");
    }
    if (sbcDoc.text.length > MAX_DOC_CHARS) sbcDoc.text = sbcDoc.text.slice(0, MAX_DOC_CHARS);
    if (sbcDoc.images.length > MAX_PAGES) throw new HttpsError("invalid-argument", `Too many pages; the limit is ${MAX_PAGES}.`);
    if (sbcDoc.images.reduce((n, d) => n + d.length, 0) > MAX_IMAGE_BYTES) {
      throw new HttpsError("invalid-argument", "Those pages are too large. Try a lower-resolution scan.");
    }
    await checkPlanRateLimit(uid);
    const release = await reserveModelCall(db, { kind: "plan" });

    const opts = { modelId: MODEL_ID, apiKey: GEMINI_API_KEY.value() };
    let structured, planUsage = null;
    try {
      const first = await runPlanExtract(sbcDoc, opts);
      planUsage = addUsage(null, first.usage);
      structured = first.data;
      if (!validatePlan(structured)) {
        const errText = ajv.errorsText(validatePlan.errors);
        const retry = await runPlanExtract(
          { ...sbcDoc, text: `${sbcDoc.text}\n\n[SYSTEM NOTE: your previous response failed schema validation: ${errText}. Return valid JSON matching the schema exactly.]` },
          opts
        );
        planUsage = addUsage(planUsage, retry.usage);
        structured = retry.data;
        if (!validatePlan(structured)) {
          throw new HttpsError("internal", "Plan extraction produced invalid output. Please try again.");
        }
      }
      console.log("plan usage", { uid, model: MODEL_ID, ...planUsage, costUsd: estimateCostUsd(planUsage, MODEL_ID) });
    } catch (err) {
      await release();
      if (err instanceof HttpsError) throw err;
      console.error("runPlanExtract failed", { uid, model: MODEL_ID, message: err.message, terminal: !!err.terminal });
      if (err.terminal) {
        throw new HttpsError("resource-exhausted", "This document produced more output than we can handle. Try auditing fewer pages at once.");
      }
      throw new HttpsError("internal", "Plan extraction failed. Please try again.");
    }

    // Not an SBC: no coverage period AND no Important-Questions numbers.
    const hasNumbers = [structured.deductible?.individual, structured.deductible?.family,
      structured.oopMax?.individual, structured.oopMax?.family].some((n) => typeof n === "number");
    if (!structured.planYearStart && !hasNumbers) {
      throw new HttpsError("invalid-argument", "This doesn't look like a Summary of Benefits.");
    }

    const ref = db.doc(`users/${uid}/plan/active`);
    const existing = (await ref.get()).data()?.structured ?? null;
    if (replaceDecision(existing, structured, force === true) === "confirm_older") {
      return {
        status: "confirm_older",
        existingPeriod: { start: existing.planYearStart, end: existing.planYearEnd },
        incomingPeriod: { start: structured.planYearStart, end: structured.planYearEnd },
      };
    }

    const digest = buildDigest(structured);
    await ref.set({
      structured, digest, text: sbcDoc.text || structured?.sourceText || "",
      sourceName: typeof sourceName === "string" ? sourceName.slice(0, 200) : "",
      model: MODEL_ID, tokens: planUsage, createdAt: FieldValue.serverTimestamp(),
    });
    return { status: "stored", structured, digest };
  }
);
