import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Ajv from "ajv";
import { findingsSchema } from "./schema.js";
import { runAudit, runPlanExtract } from "./providers/gemini.js";
import { planSchema, buildDigest, replaceDecision, applyPlanGate } from "./plan.js";

initializeApp();
const db = getFirestore();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const MODEL_ID = process.env.MODEL_ID || "gemini-3.6-flash";
const MAX_DOC_CHARS = 200_000;
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
const validatePlan = ajv.compile(planSchema);

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
    enforceAppCheck: false, // flip to true once App Check is configured in Console
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to run an audit.");
    }
    const uid = request.auth.uid;
    const { redactedBill, redactedEob, ocrConfidence } = request.data || {};

    if (typeof redactedBill !== "string" || !redactedBill.trim() ||
        typeof redactedEob !== "string") {
      throw new HttpsError("invalid-argument", "The redacted bill is required.");
    }
    if (redactedBill.length > MAX_DOC_CHARS || redactedEob.length > MAX_DOC_CHARS) {
      throw new HttpsError("invalid-argument", "Document too large.");
    }

    await checkRateLimit(uid);

    let plan = null;
    try {
      plan = (await db.doc(`users/${uid}/plan/active`).get()).data() ?? null;
    } catch (err) {
      console.error("plan fetch failed — auditing without plan", { uid, message: err.message });
    }

    const opts = { modelId: MODEL_ID, apiKey: GEMINI_API_KEY.value() };
    let result;
    try {
      result = await runAudit(redactedBill, redactedEob, opts, plan?.digest || null);
      if (!validate(result)) {
        // One retry with the validation errors appended so the model can self-correct.
        const errText = ajv.errorsText(validate.errors);
        result = await runAudit(
          redactedBill,
          `${redactedEob}\n\n[SYSTEM NOTE: your previous response failed schema validation: ${errText}. Return valid JSON matching the schema exactly.]`,
          opts,
          plan?.digest || null
        );
        if (!validate(result)) {
          throw new HttpsError("internal", "Analysis produced invalid output. Please try again.");
        }
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("runAudit failed", { uid, model: MODEL_ID, message: err.message });
      throw new HttpsError("internal", "Analysis failed. Please try again.");
    }

    const gated = applyPlanGate(result, plan?.structured ?? null);
    result = gated.result;
    const { planApplied, planReason } = gated;

    const auditRef = db.collection(`users/${uid}/audits`).doc();
    await auditRef.set({
      redactedBill,
      redactedEob,
      findings: result.findings,
      totals: result.totals,
      occurrenceTable: result.occurrenceTable,
      serviceDates: result.serviceDates,
      provider: result.provider,
      payerRemarks: result.payerRemarks,
      accumulators: result.accumulators,
      model: MODEL_ID,
      ocrConfidence: typeof ocrConfidence === "number" ? ocrConfidence : null,
      planApplied,
      planReason,
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
    enforceAppCheck: false, // flip with analyze when App Check is configured
  },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to add your plan.");
    const uid = request.auth.uid;
    const { redactedSbc, sourceName, force } = request.data || {};
    if (typeof redactedSbc !== "string" || !redactedSbc.trim()) {
      throw new HttpsError("invalid-argument", "The redacted SBC text is required.");
    }
    if (redactedSbc.length > MAX_DOC_CHARS) throw new HttpsError("invalid-argument", "Document too large.");
    await checkPlanRateLimit(uid);

    const opts = { modelId: MODEL_ID, apiKey: GEMINI_API_KEY.value() };
    let structured;
    try {
      structured = await runPlanExtract(redactedSbc, opts);
      if (!validatePlan(structured)) {
        const errText = ajv.errorsText(validatePlan.errors);
        structured = await runPlanExtract(
          `${redactedSbc}\n\n[SYSTEM NOTE: your previous response failed schema validation: ${errText}. Return valid JSON matching the schema exactly.]`,
          opts
        );
        if (!validatePlan(structured)) {
          throw new HttpsError("internal", "Plan extraction produced invalid output. Please try again.");
        }
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("runPlanExtract failed", { uid, model: MODEL_ID, message: err.message });
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
      structured, digest, redactedText: redactedSbc,
      sourceName: typeof sourceName === "string" ? sourceName.slice(0, 200) : "",
      model: MODEL_ID, createdAt: FieldValue.serverTimestamp(),
    });
    return { status: "stored", structured, digest };
  }
);
