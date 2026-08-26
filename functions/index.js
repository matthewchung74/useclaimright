import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Ajv from "ajv";
import { findingsSchema, computeAtStake, verifyEvidence } from "./schema.js";
import { buildDisputeLetter } from "./letter.js";
import Stripe from "stripe";
import {
  LETTER_PRICE_CENTS, LETTER_PRODUCT_NAME, CURRENCY, LETTER_TAX_CODE,
  entitlementsPath, letterAccess, spendCredit, grantCredits,
} from "./payments.js";
import { addUsage, estimateCostUsd } from "./cost.js";
import { runAudit, runPlanExtract } from "./providers/gemini.js";
import { planSchema, buildDigest, replaceDecision, applyPlanGate } from "./plan.js";
import { validateFeedback } from "./feedback.js";
import { reserveModelCall } from "./guard.js";

initializeApp();
const db = getFirestore();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

// Payments are OFF until this is explicitly switched on, exactly like App Check:
// the letter stays free, createCheckoutSession refuses, and nothing can charge
// anyone by accident. Turning it on is a deliberate act after the test-mode run.
const PAYMENTS_ON = process.env.PAYMENTS === "on";
// Where Stripe sends the buyer back. Same origin as the app.
const APP_URL = process.env.APP_URL || "https://useclaimright.web.app";

const MODEL_ID = process.env.MODEL_ID || "gemini-3.6-flash";
// "vertex" routes the same model through Vertex AI, authenticating as this
// function's service account instead of an AI Studio key. See makeClient() in
// providers/gemini.js for why that matters. Unset = the developer API, i.e. no
// behaviour change.
// Defaults to vertex IN SOURCE on purpose. functions/.env is gitignored, so a
// config-only switch would not survive a fresh clone: someone would deploy and
// silently fall back to the AI Studio key, quietly falsifying what the privacy
// page tells members. Set GEMINI_BACKEND=developer to roll back.
const GEMINI_BACKEND = process.env.GEMINI_BACKEND || "vertex";
// "global", not a region: gemini-3.6-flash is served from the global endpoint on
// Vertex and 404s in us-central1. Verified against the live API 2026-08-25.
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || "global";
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

// The appeal letter, built from an audit the caller owns.
//
// Server-side because this is the only thing there is any prospect of charging
// for, and a paywall in the browser is decoration. There is deliberately NO
// entitlement check here yet: the move is being shipped free first so it can be
// verified on its own, with nothing about payments in the diff. When a price
// exists, the check goes here — this function, not the button.
//
// No model call: every figure and quote is read back from the stored audit.
export const generateLetter = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30, enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to generate a letter.");
    const auditId = String(request.data?.auditId || "").trim();
    if (!auditId) throw new HttpsError("invalid-argument", "Which audit?");

    // Scoped to the caller's own subtree, so one member can never read another's
    // findings by guessing an id.
    const uid = request.auth.uid;
    const snap = await db.doc(`users/${uid}/audits/${auditId}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "That audit no longer exists.");
    const a = snap.data() || {};

    // A clean audit has nothing to dispute, so there is nothing to sell. Charging
    // for "good news, we found nothing" would be indefensible.
    const findings = a.findings || [];
    if (!findings.length) return { letter: buildDisputeLetter({ findings, totals: a.totals }), free: true };

    // THE GATE. It lives here, in the callable, because this is the only place
    // the letter text exists. While PAYMENTS is off the letter stays free and
    // this is a no-op, which is how it shipped first.
    if (PAYMENTS_ON) {
      const ref = db.doc(entitlementsPath(uid));
      const spent = await db.runTransaction(async (tx) => {
        const es = await tx.get(ref);
        const ent = es.exists ? es.data() : {};
        const access = letterAccess(ent, auditId);
        if (!access.allowed) return access;
        // Spending marks this audit permanently unlocked, so re-opening a letter
        // already bought never charges twice.
        const { changed, next } = spendCredit(ent, auditId);
        if (changed) tx.set(ref, next, { merge: true });
        return access;
      });
      if (!spent.allowed) {
        // The price rides along on the refusal so the client never hardcodes it.
        // One constant, server-side, and the button cannot drift from what
        // Stripe actually charges.
        throw new HttpsError("permission-denied", "This letter needs to be purchased first.", {
          priceCents: LETTER_PRICE_CENTS,
          currency: CURRENCY,
        });
      }
    }

    return { letter: buildDisputeLetter({ findings, totals: a.totals }) };
  }
);

// ---------- Payments ----------
//
// Stripe Checkout, not Payment Element and not Payment Links: the hosted page
// means card data never touches this origin (SAQ A), it handles SCA/3DS and
// wallets for free, and client_reference_id ties the session back to a uid,
// which Payment Links cannot do. For a product already sending health
// information to a third party, "we never see the card" is worth more than a
// prettier checkout.

export const createCheckoutSession = onCall(
  {
    region: "us-central1", memory: "256MiB", timeoutSeconds: 30,
    secrets: [STRIPE_SECRET_KEY], enforceAppCheck: ENFORCE_APP_CHECK,
  },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    if (!PAYMENTS_ON) throw new HttpsError("failed-precondition", "Payments are not switched on.");
    const uid = request.auth.uid;
    const auditId = String(request.data?.auditId || "").trim();
    if (!auditId) throw new HttpsError("invalid-argument", "Which audit?");

    // Never sell someone what they already own.
    const ent = (await db.doc(entitlementsPath(uid)).get()).data() || {};
    if (letterAccess(ent, auditId).allowed) return { alreadyEntitled: true, url: null };

    const stripe = new Stripe(STRIPE_SECRET_KEY.value());
    // price_data inline rather than a pre-created Price: one product, one
    // amount, and no dashboard object to drift out of sync with the code.
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: uid,
      // The uid is what the webhook grants against; the auditId is only for
      // the receipt. Metadata is echoed back on the event.
      metadata: { uid, auditId },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: LETTER_PRICE_CENTS,
          product_data: { name: LETTER_PRODUCT_NAME, tax_code: LETTER_TAX_CODE },
        },
      }],
      success_url: `${APP_URL}/app?paid=1&audit=${encodeURIComponent(auditId)}`,
      cancel_url: `${APP_URL}/app?paid=0`,
    });
    return { alreadyEntitled: false, url: session.url };
  }
);

// The webhook. Two things break here for everyone, so both are handled
// explicitly:
//
//  1. THE RAW BODY. stripe.webhooks.constructEvent() needs the unparsed bytes.
//     Firebase parses JSON for you, and handing Stripe the parsed object fails
//     the signature check 100% of the time with a misleading error. req.rawBody
//     is what Firebase provides for exactly this.
//  2. IDEMPOTENCY. Stripe retries on any non-2xx and re-delivers on a slow
//     response. Granting is keyed on event.id inside a transaction, so one
//     payment can never become two credits.
//
// Return 2xx fast: Stripe times out around 20s and starts retrying, which is
// how the duplicate above happens in the first place.
export const stripeWebhook = onRequest(
  {
    region: "us-central1", memory: "256MiB", timeoutSeconds: 30,
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
  },
  async (req, res) => {
    if (!PAYMENTS_ON) { res.status(503).send("payments off"); return; }
    const stripe = new Stripe(STRIPE_SECRET_KEY.value());
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,                       // NOT req.body — see above
        req.headers["stripe-signature"],
        STRIPE_WEBHOOK_SECRET.value(),
      );
    } catch (err) {
      // An unverified body is not a payment. Never trust it, never grant on it.
      console.error("stripe signature verification failed", err.message);
      res.status(400).send(`signature: ${err.message}`);
      return;
    }

    if (event.type !== "checkout.session.completed") { res.status(200).send("ignored"); return; }
    const session = event.data.object;
    const uid = session.client_reference_id || session.metadata?.uid;
    if (!uid) {
      // Nothing to grant against. 200 so Stripe stops retrying something that
      // will never succeed, but loud in the log because it means a real payment
      // landed with no owner.
      console.error("checkout.session.completed with no uid", { session: session.id });
      res.status(200).send("no uid");
      return;
    }

    try {
      const ref = db.doc(entitlementsPath(uid));
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const { changed, next } = grantCredits(snap.exists ? snap.data() : {}, { eventId: event.id, credits: 1 });
        if (changed) tx.set(ref, next, { merge: true });
      });
      res.status(200).send("ok");
    } catch (err) {
      // 500 so Stripe retries — the transaction is idempotent, so a retry is safe.
      console.error("grant failed", err);
      res.status(500).send("grant failed");
    }
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

    const opts = {
      modelId: MODEL_ID,
      // Vertex needs no key; reading the secret anyway keeps one code path and
      // lets a rollback to the developer API be an env flip with no deploy.
      apiKey: GEMINI_API_KEY.value(),
      backend: GEMINI_BACKEND,
      location: VERTEX_LOCATION,
    };
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
      statementId: result.statementId || "",
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

    const opts = {
      modelId: MODEL_ID,
      // Vertex needs no key; reading the secret anyway keeps one code path and
      // lets a rollback to the developer API be an env flip with no deploy.
      apiKey: GEMINI_API_KEY.value(),
      backend: GEMINI_BACKEND,
      location: VERTEX_LOCATION,
    };
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
