import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Ajv from "ajv";
import { findingsSchema, computeAtStake, verifyEvidence, reconcileStatedAmounts } from "./schema.js";
import { buildDisputeLetter } from "./letter.js";
import Stripe from "stripe";
import {
  LETTER_PRICE_CENTS, LETTER_PRODUCT_NAME, CURRENCY, LETTER_TAX_CODE,
  entitlementsPath, letterAccess, spendCredit, grantCredits,
} from "./payments.js";
import { addUsage, estimateCostUsd } from "./cost.js";
import { runAudit, runPlanExtract } from "./providers/gemini.js";
import { plansSchema, buildDigest, replaceDecision, applyPlanGate } from "./plan.js";
import { resolvePlan } from "./resolveplan.js";
import { validateFeedback } from "./feedback.js";
import { openBudget, AUDIT, PLAN } from "./budget.js";
import { parkPlan, takePendingPlan } from "./pendingplan.js";

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
// Our own accounts, so a day of testing does not drown the one alert that says
// a stranger got value out of this. Comma-separated uids in functions/.env.
const OWNER_UIDS = new Set(
  (process.env.OWNER_UIDS || "").split(",").map((u) => u.trim()).filter(Boolean)
);

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(findingsSchema);

// Smaller than the audit cap because one plan lasts a year. S4 hit it for real
// on 2026-09-09: the extraction ran, the cap fired on the save, and the upload
// was spent on a plan that never landed.
const PLAN_DAILY_LIMIT = 3;
const FEEDBACK_DAILY_LIMIT = 20;
const validatePlan = ajv.compile(plansSchema);

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

    // Feedback used to land in Firestore and stop there — the collection is
    // closed to clients, so the console was the only way to know it existed. The
    // person most worth hearing from is the one who hit a broken edge and is not
    // coming back, so waiting until someone remembers to look is the wrong way
    // round. Logged at ERROR because that is what a Cloud Monitoring alert can
    // reach; there is no SMTP anywhere in this project and this needs none.
    // The marker is what the alert policy matches on — changing it silently
    // turns the emails off.
    // One JSON object, so Cloud Run parses it into jsonPayload fields rather
    // than a flat string. That is what lets the alert put the actual message in
    // the email — an alert saying only "a log matched" leaves you clicking
    // through to Cloud Logging, which is the looking-it-up this exists to end.
    console.error(JSON.stringify({
      marker: "FEEDBACK_RECEIVED",
      category: v.value.category ?? "",
      screen: v.value.screen ?? "",
      auditId: v.value.auditId ?? "",
      from: request.auth.token?.email ?? "",
      message: (v.value.message ?? "").slice(0, 500),
    }));
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

// Switching between the plans in a booklet. No model call: the candidates were
// extracted and paid for already, so correcting a resolution must be free —
// otherwise the member is charged for our uncertainty about which plan is theirs.
export const choosePlan = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30, enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to choose your plan.");
    const uid = request.auth.uid;
    const index = request.data?.index;
    const ref = db.doc(`users/${uid}/plan/active`);
    const cur = (await ref.get()).data();
    const candidates = cur?.candidates ?? [];
    if (!candidates.length) throw new HttpsError("failed-precondition", "There is no plan document to choose from.");
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
      throw new HttpsError("invalid-argument", "That is not one of the plans in your document.");
    }
    const structured = candidates[index];
    await ref.set({
      structured, digest: buildDigest(structured),
      resolvedIndex: index, resolvedWhy: "You chose this plan.",
    }, { merge: true });
    return { status: "stored", structured };
  }
);

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

    const budget = await openBudget(db, uid, AUDIT, {
      limit: DAILY_LIMIT, message: `Daily limit of ${DAILY_LIMIT} audits reached.`,
    });

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
      await budget.refund();
      if (err instanceof HttpsError) throw err;
      // MODEL_CALL_FAILED, structured like FEEDBACK_RECEIVED, so an alert can put
      // the reason in the email. Nobody files feedback about a spinner that
      // never ends — the first person whose real audit breaks tells us nothing
      // unless we are told directly.
      console.error(JSON.stringify({
        marker: "MODEL_CALL_FAILED", kind: "audit", uid,
        model: MODEL_ID, reason: err.message ?? "", terminal: String(!!err.terminal),
      }));
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
    // What the member actually uploaded, which is NOT the same as what we hold
    // text for. billText/eobText are optional in the schema, so a PDF the model
    // declines to echo back leaves us with no text for a document that very
    // much exists — and dropping its findings would zero out a real audit.
    const supplied = {
      bill: !!(billDoc.text.trim() || billDoc.images.length),
      eob: !!(eobDoc.text.trim() || eobDoc.images.length),
      sbc: !!planDigest,
    };
    // Before the evidence check, because a finding corrected here still has to
    // survive it: an amount can be repaired, a fabricated quote cannot.
    const reconciled = reconcileStatedAmounts(result);
    result = reconciled.result;
    if (reconciled.corrected.length) {
      // Loud. This is the model contradicting its own stated arithmetic, and the
      // gap lands in the headline figure — the one number a member acts on.
      console.error("finding amount disagreed with its own description", { uid, model: MODEL_ID, corrected: reconciled.corrected });
    }

    const verified = verifyEvidence(result, { bill: billSource, eob: eobSource, sbc: planDigest, supplied });
    result = verified.result;
    if (verified.unverifiable?.length) {
      // Not a fabrication — the opposite. It means the model gave findings for a
      // document whose text it never returned, so nothing could be checked. If
      // this is common, make billText/eobText required rather than optional.
      console.warn("evidence could not be verified: no text for a supplied document",
        { uid, count: verified.unverifiable.length, fields: verified.unverifiable });
    }
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
      // Stored, not just returned. The wrong-person warning is computed from
      // these, and a re-opened report reads the stored document — the same
      // asymmetry that once left the mismatched-pair warning working on the
      // fresh report and silent on the same audit reopened.
      eobPatients: result.eobPatients || [],
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

    // Someone outside this project used the thing and it worked. Every other
    // signal we have is a failure, so on a launch day this is the one worth
    // seeing — and its absence is itself the finding.
    //
    // NOT in this log: provider, codes, patient name, or any document text. The
    // owner can already read all of it in Firestore; an alert email is a
    // different surface — it lands in a mailbox, gets forwarded, sits in search
    // history. Counts and the headline figure say it worked. Nothing else needs
    // to leave the system to say that.
    if (!OWNER_UIDS.has(uid)) {
      console.log(JSON.stringify({
        marker: "AUDIT_COMPLETED",
        findings: String(result.findings?.length ?? 0),
        atStake: String(result.totals?.totalAtStake ?? 0),
        withEob: String(Boolean(eobDoc.text?.trim() || eobDoc.images.length)),
        withPlan: String(planApplied),
        uid,
      }));
    }

    // billStore/eobStore go back too. They are the ONLY text the client has —
    // pages are sent, nothing is read from the file in the browser — and the
    // mismatched-pair warning on the report needs them. Returning them exposes
    // nothing new: this is the same caller that just uploaded the documents.
    return { auditId: auditRef.id, planApplied, planReason, ...result, bill: billStore, eob: eobStore };
  }
);

// The plan document, written the same way whether the extraction just ran or
// was parked by a confirm_older round trip.
async function writePlan(ref, plan) {
  const { structured, candidates = [], resolvedIndex = null, resolvedWhy = "",
    text, sourceName, sourceHash, tokens } = plan;
  // null digest when unresolved, so the audit prompt carries no plan terms at
  // all rather than one plan's terms guessed from three. That is a path the app
  // already handles and E2 verified: fewer findings, all of them trustworthy.
  const digest = structured ? buildDigest(structured) : null;
  await ref.set({
    structured, digest, candidates, resolvedIndex, resolvedWhy,
    text, sourceName, sourceHash,
    model: MODEL_ID, tokens, createdAt: FieldValue.serverTimestamp(),
  });
  return { status: "stored", structured, digest, candidates, resolvedIndex, resolvedWhy };
}

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
    const { sbc, sourceName, sourceHash, force } = request.data || {};
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
    const name = typeof sourceName === "string" ? sourceName.slice(0, 200) : "";
    // Content fingerprint of the uploaded file, so the client can recognise a
    // re-upload of the SAME document before spending an extraction on it. The
    // text comparison it backs up cannot see a scan, which has no text until
    // the model reads it — and by then the upload is already spent.
    const hash = typeof sourceHash === "string" ? sourceHash.slice(0, 64) : "";
    const planRef = db.doc(`users/${uid}/plan/active`);

    // "Replace anyway" on the older-plan dialog. The model has already read this
    // document and the member has already paid for it, so collect that rather
    // than charging twice. A force with nothing parked falls through and pays.
    if (force === true) {
      const parked = await takePendingPlan(db, uid, hash);
      if (parked) return writePlan(planRef, parked);
    }

    const budget = await openBudget(db, uid, PLAN, {
      limit: PLAN_DAILY_LIMIT, message: `Daily limit of ${PLAN_DAILY_LIMIT} plan uploads reached.`,
    });

    const opts = {
      modelId: MODEL_ID,
      // Vertex needs no key; reading the secret anyway keeps one code path and
      // lets a rollback to the developer API be an env flip with no deploy.
      apiKey: GEMINI_API_KEY.value(),
      backend: GEMINI_BACKEND,
      location: VERTEX_LOCATION,
    };
    let extracted, planUsage = null;
    try {
      const first = await runPlanExtract(sbcDoc, opts);
      planUsage = addUsage(null, first.usage);
      extracted = first.data;
      if (!validatePlan(extracted)) {
        const errText = ajv.errorsText(validatePlan.errors);
        console.warn(JSON.stringify({ marker: "PLAN_SCHEMA_RETRY", uid, errors: errText.slice(0, 400) }));
        const retry = await runPlanExtract(
          { ...sbcDoc, text: `${sbcDoc.text}\n\n[SYSTEM NOTE: your previous response failed schema validation: ${errText}. Return valid JSON matching the schema exactly.]` },
          opts
        );
        planUsage = addUsage(planUsage, retry.usage);
        extracted = retry.data;
        if (!validatePlan(extracted)) {
          // A schema failure used to leave NO trace: the HttpsError is rethrown
          // above the MODEL_CALL_FAILED line, so "produced invalid output"
          // reached the member and nothing reached us. Log before throwing.
          console.error(JSON.stringify({
            marker: "MODEL_CALL_FAILED", kind: "plan", uid, model: MODEL_ID,
            reason: `schema: ${ajv.errorsText(validatePlan.errors).slice(0, 400)}`,
            terminal: "false",
          }));
          throw new HttpsError("internal", "Plan extraction produced invalid output. Please try again.");
        }
      }
      console.log("plan usage", { uid, model: MODEL_ID, ...planUsage, costUsd: estimateCostUsd(planUsage, MODEL_ID) });
    } catch (err) {
      await budget.refund();
      if (err instanceof HttpsError) throw err;
      console.error(JSON.stringify({
        marker: "MODEL_CALL_FAILED", kind: "plan", uid,
        model: MODEL_ID, reason: err.message ?? "", terminal: String(!!err.terminal),
      }));
      if (err.terminal) {
        throw new HttpsError("resource-exhausted", "This document produced more output than we can handle. Try auditing fewer pages at once.");
      }
      throw new HttpsError("internal", "Plan extraction failed. Please try again.");
    }

    // Not a plan document: no coverage period AND no Important-Questions numbers,
    // in ANY of the plans it describes.
    const candidates = Array.isArray(extracted.plans) ? extracted.plans : [];
    const usable = candidates.filter((p) =>
      p.planYearStart ||
      [p.deductible?.individual, p.deductible?.family, p.oopMax?.individual, p.oopMax?.family]
        .some((n) => typeof n === "number"));
    // What came back, per plan. Kept because "plan candidates []" is what
    // identified an empty array dressed up as 6,858 tokens of sourceText — the
    // failure looked like "not an SBC" from every other angle.
    console.log("plan candidates", JSON.stringify(candidates.map((p) => ({
      name: (p?.planName ?? "").slice(0, 60),
      ded: [p?.deductible?.individual ?? null, p?.deductible?.family ?? null],
      rows: (p?.costShares ?? []).length,
    }))));
    if (!usable.length) {
      throw new HttpsError("invalid-argument", "This doesn't look like a Summary of Benefits.");
    }

    // Which one is theirs? The EOB is written by the insurer about the plan they
    // are actually on; the booklet never says. Unresolved is a real answer, and
    // it is better than a coin flip that then measures every bill they upload
    // against terms they are not on.
    const eobs = await db.collection(`users/${uid}/eobs`)
      .orderBy("createdAt", "desc").limit(3).get().catch(() => ({ docs: [] }));
    const signals = eobs.docs.map((d) => d.data()).find((e) => e?.text || e?.accumulators) ?? {};
    const { index, why } = resolvePlan(usable, {
      text: signals.text ?? "",
      deductibleLimit: signals.accumulators?.deductibleLimit,
      oopLimit: signals.accumulators?.oopLimit,
    });
    const structured = index === null ? null : usable[index];

    const plan = {
      structured, candidates: usable, resolvedIndex: index, resolvedWhy: why,
      text: sbcDoc.text || extracted?.sourceText || "",
      sourceName: name, sourceHash: hash, tokens: planUsage,
    };
    const existing = (await planRef.get()).data()?.structured ?? null;
    // Compare against whichever plan we resolved; with none resolved there is
    // nothing to be older THAN, so the replace question does not arise.
    if (structured && replaceDecision(existing, structured, force === true) === "confirm_older") {
      await parkPlan(db, uid, plan);
      return {
        status: "confirm_older",
        existingPeriod: { start: existing.planYearStart, end: existing.planYearEnd },
        incomingPeriod: { start: structured.planYearStart, end: structured.planYearEnd },
      };
    }

    return writePlan(planRef, plan);
  }
);
