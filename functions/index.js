import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Ajv from "ajv";
import { findingsSchema } from "./schema.js";
import { runAudit } from "./providers/gemini.js";

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
    tx.set(ref, { day, count: count + 1 });
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

    const opts = { modelId: MODEL_ID, apiKey: GEMINI_API_KEY.value() };
    let result;
    try {
      result = await runAudit(redactedBill, redactedEob, opts);
      if (!validate(result)) {
        // One retry with the validation errors appended so the model can self-correct.
        const errText = ajv.errorsText(validate.errors);
        result = await runAudit(
          redactedBill,
          `${redactedEob}\n\n[SYSTEM NOTE: your previous response failed schema validation: ${errText}. Return valid JSON matching the schema exactly.]`,
          opts
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

    const auditRef = db.collection(`users/${uid}/audits`).doc();
    await auditRef.set({
      redactedBill,
      redactedEob,
      findings: result.findings,
      totals: result.totals,
      occurrenceTable: result.occurrenceTable,
      serviceDates: result.serviceDates ?? [],
      provider: result.provider ?? "",
      payerRemarks: result.payerRemarks ?? [],
      accumulators: result.accumulators ?? null,
      model: MODEL_ID,
      ocrConfidence: typeof ocrConfidence === "number" ? ocrConfidence : null,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { auditId: auditRef.id, ...result };
  }
);
