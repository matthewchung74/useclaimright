import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signOut,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, query, orderBy, getDocs, getDocsFromServer, doc, getDoc,
  getDocFromServer, deleteDoc, addDoc, updateDoc, serverTimestamp, connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  planYearWindow, visitsUsed, latestAccumulators, suggestedTrackers, warningLevel,
} from "./usage.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js";
import { firebaseConfig, APP_CHECK_SITE_KEY } from "./firebase-config.js";
import { extractText } from "./extract.js";
import { pairFiles, classifyFile, uniqueDocs } from "./batch.js";
import { planYearStartMonthFrom, mergeSbcTrackers, deductibleTarget, oopTarget } from "./plan.js";
import { crossBillDuplicates, runningTotals, groupAuditsByProvider, splitJustAudited, billKeyOf } from "./crossbill.js";
import { matchSavedEob, documentsRelated, datesIn, codesIn } from "./eobmatch.js";

const $ = (id) => document.getElementById(id);
let currentSection = "signin";
const show = (id) => {
  // Every screen transition goes through here, so this is the whole funnel in
  // one line. Defined above track(); both are module-level and only ever called
  // after evaluation, so the ordering is fine.
  if (currentSection !== id) track("stage_viewed", { stage: id });
  currentSection = id;
  for (const s of document.querySelectorAll("main > section")) s.hidden = s.id !== id;
  // Feedback bubble lives on the calm screens only — never over a review or spinner.
  const fbVisible = id === "bills" || id === "upload" || id === "report";
  $("fb-bubble").hidden = !fbVisible;
  if (!fbVisible) $("fb-card").hidden = true;
  window.scrollTo(0, 0);
};

if (!firebaseConfig.apiKey) {
  document.body.innerHTML =
    '<p style="max-width:32rem;margin:4rem auto;font-family:sans-serif">App not configured yet — fill in <code>web/js/firebase-config.js</code> (run <code>firebase apps:sdkconfig web</code>).</p>';
  throw new Error("firebase-config.js is empty");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");
// Local emulator wiring (firebase emulators:start) — dev/testing only.
if (["localhost", "127.0.0.1"].includes(location.hostname)) {
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "localhost", 8080);
  connectFunctionsEmulator(functions, "localhost", 5001);
}
const analyzeFn = httpsCallable(functions, "analyze", { timeout: 300_000 });
const extractPlanFn = httpsCallable(functions, "extractPlan", { timeout: 300_000 });
const submitFeedbackFn = httpsCallable(functions, "submitFeedback", { timeout: 30_000 });
const generateLetterFn = httpsCallable(functions, "generateLetter", { timeout: 30_000 });
const createCheckoutSessionFn = httpsCallable(functions, "createCheckoutSession", { timeout: 30_000 });
// App Check attests that a request came from this app, not a script holding a
// minted account. Skipped when no site key is set — the Functions must stay on
// enforceAppCheck: false until both halves are in place, or every call 403s.
if (APP_CHECK_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

let analytics = null;
try { analytics = getAnalytics(app); } catch { /* blocked or unsupported — fine */ }
// ---------- Analytics ----------
//
// ONE RULE, and it is not negotiable: no property may be derived from the
// contents of a document. No amounts, provider names, procedure codes, service
// dates, patient names, and no filenames — a filename is very often the patient's
// name. Everything below is structural: counts, booleans, and fixed enums whose
// values are enumerated in this file. If a property cannot be predicted by
// reading this source, it does not belong in an event.
//
// The funnel this answers: land → sign in → stage files → spend an audit → see a
// report → generate the letter. Plus where people fall out, which is the half
// that events named after successes can never tell you.
const track = (name, params) => {
  try { analytics && logEvent(analytics, name, params); } catch {}
};

// Errors are classified into a fixed vocabulary rather than forwarded. The
// message is app copy, but copy interpolates filenames in places, and this
// keeps that from ever becoming an analytics payload by accident.
const ERROR_REASONS = [
  [/daily limit|allowance|today's \d+ /i, "limit_reached"],
  [/itemized bill is required/i, "no_bill_staged"],
  [/don't have an EOB|no matching EOB/i, "eob_unacknowledged"],
  [/doesn't look like a Summary of Benefits/i, "not_an_sbc"],
  [/too large|20MB/i, "file_too_large"],
  [/email and password don't match/i, "bad_credentials"],
  [/already (registered|in use)/i, "email_in_use"],
  [/password/i, "password_problem"],
  [/enter your email/i, "email_missing"],
  [/couldn't read|unreadable|no text/i, "extraction_failed"],
  [/analysis error|try again/i, "analysis_failed"],
];
// The shape of a finished audit, structurally. "found" is a boolean rather than
// the dollar figure on purpose: whether the product worked is answerable without
// ever putting a number derived from someone's bill into analytics.
const auditShape = (data) => ({
  findings: (data?.findings || []).length,
  found: ((data?.totals?.totalAtStake) || 0) > 0,
  plan_applied: !!data?.planApplied,
});

const errorReason = (msg) => {
  for (const [re, slug] of ERROR_REASONS) if (re.test(msg)) return slug;
  return "other";
};

const OCR_CONFIDENCE_THRESHOLD = 75;

// Page images travel as bare base64; the data: prefix is a browser convenience.
const b64 = (dataUrl) => String(dataUrl).slice(String(dataUrl).indexOf(",") + 1);
const asDoc = (d) => (d ? { text: d.text || "", images: (d.images || []).map(b64) } : { text: "", images: [] });

// Confidence is a property of TEXT EXTRACTION, and a scanned page has none —
// the model reads it, and reports no score. Null means "no signal", which is
// not the same as zero; Math.min would have turned every scan into a low-
// quality warning.
const ocrConfidenceOf = (docs) => {
  const scores = docs.filter(Boolean).map((d) => d.confidence).filter((c) => typeof c === "number");
  return scores.length ? Math.min(...scores) : 100;
};

// A confirmation the app controls. Native confirm() is unstyled, cannot explain
// itself beyond one line, cannot mark which button is the dangerous one — and it
// freezes the renderer, so every destructive path was untestable by automation.
// Returns a promise so call sites read the same as they did.
function confirmAction({ title, body, confirmLabel = "Confirm", danger = false }) {
  const dlg = $("confirm-dialog");
  $("cd-title").textContent = title;
  $("cd-body").textContent = body;
  $("cd-ok").textContent = confirmLabel;
  $("cd-ok").classList.toggle("danger", danger);
  return new Promise((resolve) => {
    const done = (answer) => {
      $("cd-ok").onclick = null;
      $("cd-cancel").onclick = null;
      dlg.onclose = null;
      dlg.onclick = null;
      if (dlg.open) dlg.close();
      resolve(answer);
    };
    $("cd-ok").onclick = () => done(true);
    $("cd-cancel").onclick = () => done(false);
    // Esc and backdrop dismissal must read as "no", never as consent.
    dlg.onclose = () => done(false);
    // A click on the backdrop lands on the <dialog> element itself; a click on
    // its contents does not. Without this the backdrop swallowed the click and
    // left the dialog open, which reads as a frozen page.
    dlg.onclick = (e) => { if (e.target === dlg) done(false); };
    dlg.showModal();
  });
}

// ---------- Auth ----------

$("google-signin").onclick = () =>
  signInWithPopup(auth, new GoogleAuthProvider())
    .then(() => track("signed_in", { method: "google" }))
    .catch((e) => setError("signin-error", authError(e)));

// Firebase's own messages are diagnostics, not copy: "Firebase: Error
// (auth/invalid-credential)." tells a member nothing and looks broken. Map the
// ones a real person actually hits; anything unmapped falls through to the raw
// message rather than a vague catch-all, because a message we have not seen
// before is more useful than "Something went wrong".
const AUTH_MESSAGES = {
  "auth/invalid-credential": "That email and password don't match. Check both, or reset your password.",
  "auth/invalid-login-credentials": "That email and password don't match. Check both, or reset your password.",
  "auth/wrong-password": "That email and password don't match. Check both, or reset your password.",
  // Normally unreachable, and deliberately kept. Firebase's email enumeration
  // protection (on by default) returns auth/invalid-credential for an unknown
  // address AND a wrong password, so the app cannot distinguish them and must
  // not appear to — verified on production 2026-08-25. This fires only if that
  // protection is switched off in the Console, which would be a decision to
  // leak account existence, not an accident.
  "auth/user-not-found": "No account with that email. Create one below, or sign in with Google.",
  "auth/email-already-in-use": "That email already has an account — sign in instead.",
  "auth/weak-password": "Passwords need to be at least 6 characters.",
  "auth/invalid-email": "That doesn't look like an email address.",
  "auth/missing-password": "Enter your password.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/network-request-failed": "Couldn't reach the server. Check your connection and try again.",
  // Password sign-in is enabled per project. Without it every attempt fails
  // with this, and the message should say so rather than blame the member.
  "auth/operation-not-allowed": "Password sign-in isn't switched on for this app yet. Use Continue with Google.",
};
const authError = (e) => AUTH_MESSAGES[e?.code] || e?.message || "Sign-in failed. Try again.";

// One form, two modes. A separate sign-up screen doubles the markup to change
// one verb and one call, and makes "wrong mode" a navigation problem instead of
// a click.
let signupMode = false;
function setSignupMode(on) {
  signupMode = on;
  $("password-signin").textContent = on ? "Create account" : "Sign in";
  $("toggle-signup").textContent = on ? "I already have an account" : "Create an account";
  $("password-input").setAttribute("autocomplete", on ? "new-password" : "current-password");
  $("forgot-password").hidden = on;
  setError("signin-error", "");
  $("reset-sent").hidden = true;
}

$("toggle-signup").onclick = (e) => { e.preventDefault(); setSignupMode(!signupMode); };

$("password-signin").onclick = async () => {
  const email = $("email-input").value.trim();
  const password = $("password-input").value;
  if (!email) return setError("signin-error", "Enter your email.");
  if (!password) return setError("signin-error", "Enter your password.");
  setError("signin-error", "");
  const btn = $("password-signin");
  btn.disabled = true;
  try {
    await (signupMode
      ? createUserWithEmailAndPassword(auth, email, password)
      : signInWithEmailAndPassword(auth, email, password));
    track("signed_in", { method: signupMode ? "password_signup" : "password" });
  } catch (e) {
    setError("signin-error", authError(e));
  } finally {
    btn.disabled = false;
  }
};

// Enter submits from either field — a two-field form where the keyboard does
// nothing is a form people fight with.
for (const id of ["email-input", "password-input"]) {
  $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") $("password-signin").click(); });
}

$("forgot-password").onclick = async (e) => {
  e.preventDefault();
  const email = $("email-input").value.trim();
  if (!email) return setError("signin-error", "Enter your email first, then choose “Forgot password?”.");
  setError("signin-error", "");
  try {
    await sendPasswordResetEmail(auth, email);
    $("reset-sent").hidden = false;
  } catch (e2) {
    // Never confirm or deny that an address has an account: that turns the
    // reset form into an account-existence oracle.
    if (e2?.code === "auth/user-not-found") $("reset-sent").hidden = false;
    else setError("signin-error", authError(e2));
  }
};

$("menu-btn").onclick = (e) => {
  e.stopPropagation();
  $("menu").hidden = !$("menu").hidden;
};
document.addEventListener("click", (e) => {
  if (!$("menu").hidden && !$("menu").contains(e.target) && e.target !== $("menu-btn")) $("menu").hidden = true;
});

$("signout").onclick = () => signOut(auth);

// Dev helper doubling as "delete my data": wipes every owner-deletable
// document so the account behaves like a fresh sign-up. Server-managed
// rate-limit counters are Function-owned and intentionally survive.
$("reset-account").onclick = async () => {
  $("menu").hidden = true;
  if (!await confirmAction({
    title: "Erase everything?",
    body: "This deletes every audit, saved EOB, tracker and your plan. It cannot be undone. Today's usage counters stay as they are.",
    confirmLabel: "Erase everything", danger: true,
  })) return;
  const uid = auth.currentUser.uid;
  const colls = ["audits", "eobs", "trackers"];
  try {
    for (const coll of colls) {
      // Read from the server, not the cache: a stale or partial cache would
      // hand us fewer documents than exist and the wipe would quietly miss them.
      const snap = await getDocsFromServer(collection(db, `users/${uid}/${coll}`));
      for (const d of snap.docs) await deleteDoc(d.ref);
    }
    await deleteDoc(doc(db, `users/${uid}/plan/active`));

    // Verify before claiming success. "Erase all my data" must never reload
    // into a screen that still lists the data it promised to delete.
    const left = [];
    for (const coll of colls) {
      const n = (await getDocsFromServer(collection(db, `users/${uid}/${coll}`))).size;
      if (n) left.push(`${n} ${coll}`);
    }
    if ((await getDocFromServer(doc(db, `users/${uid}/plan/active`))).exists()) left.push("your plan");
    if (left.length) throw new Error(`${left.join(", ")} could not be deleted`);

    // "Treat it like a fresh account" includes the onboarding gate: without
    // this the skip flag survives the wipe and drops you on the audit page.
    localStorage.removeItem("ucr-skip-onboarding");
    location.reload();
  } catch (e) {
    console.error(e);
    // Reset is reached from the account menu, so the error has to land on the
    // home screen — the audit form's error slot would be on a hidden section.
    // Deliberately no reload: reloading here is what makes a failed wipe look
    // like a successful one.
    show("bills");
    setError("bills-error", `Erase did not finish: ${e.message}. Your data is unchanged or partly deleted — try again, and tell us if it keeps failing.`);
  }
};

onAuthStateChanged(auth, async (user) => {
  document.body.classList.toggle("authed", !!user);
  if (user) {
    $("user-email").textContent = user.email || "";
    // Plan first: the coverage cards and the dashboard's plan-year window read
    // activePlan, so loading history in parallel raced it — the out-of-pocket
    // card silently vanished and the deductible credited the EOB for the SBC's
    // limit, depending on which query returned first.
    await loadPlan();
    // Both awaited before routing: the bills list IS the home screen, so
    // showing it mid-query would flash "no bills audited yet" at a user who
    // has plenty.
    await loadHistory();
    // First-run gate: no plan on file and never skipped → one-time setup screen.
    if (!activePlan && localStorage.getItem("ucr-skip-onboarding") !== user.uid) {
      openOnboarding("signin");
    } else {
      show("bills");
    }
    // Returning from Stripe. Last, and only after history is loaded, because it
    // opens a specific audit and would otherwise be overridden by the routing
    // above.
    await resumeAfterCheckout();
  } else {
    show("signin");
  }
});

function openOnboarding(origin) {
  $("skip-onboarding").textContent = origin === "signin"
    ? "Skip for now — audit a bill first"
    : "Not now — back to your audits";
  setError("onboarding-error", "");
  show("onboarding");
}

$("skip-onboarding").onclick = (e) => {
  e.preventDefault();
  if (auth.currentUser) localStorage.setItem("ucr-skip-onboarding", auth.currentUser.uid);
  show("bills");
};

// The daily caps exist because the app is free and every audit is a real model
// call we pay for. A one-line red error made that read as a malfunction, so the
// limit gets its own dialog that says what the cap is and why it exists.
// Server counters roll over on the UTC date (functions/index.js checkRateLimit),
// so the reset is shown in the user's own timezone rather than as "UTC".
function showLimitDialog(kind) {
  const audits = kind !== "plans";
  // How many people hit the ceiling is the number that decides whether the cap
  // is protecting the budget or capping the business.
  track("limit_reached", { kind: audits ? "audits" : "plans" });
  const reset = new Date();
  reset.setUTCHours(24, 0, 0, 0);
  const sameDayLocal = reset.toDateString() === new Date().toDateString();
  $("ld-title").textContent = audits ? "That's today's 10 audits" : "That's today's 3 plan uploads";
  $("ld-lead").innerHTML = audits
    ? `UseClaimRight is free, and every audit is a real AI reading of your documents line by line —
       which costs us money each time. Capping it at <b>10 a day</b> is what keeps it free for
       everyone, and stops an automated script from running the bill up.`
    : `Reading a Summary of Benefits is the same kind of paid AI call as an audit, so plan uploads
       get their own smaller cap of <b>3 a day</b>. You only need one per plan year, so this is
       usually only hit while testing.`;
  $("ld-reset-local").textContent =
    reset.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) +
    (sameDayLocal ? " today" : ` on ${reset.toLocaleDateString([], { weekday: "long" })}`);
  const dlg = $("limit-dialog");
  if (typeof dlg.showModal === "function") dlg.showModal();
}

function setError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.hidden = !msg;
  // Clearing an error is not an error. Every visible failure in the app passes
  // through here, which makes this the only honest view of where people stall.
  if (msg) track("error_shown", { where: id, reason: errorReason(msg) });
}

// ---------- Pipeline state ----------

// Originals live ONLY in this object and are wiped after the user confirms
// the review screen. They are never transmitted.
let state = null;

function resetState() {
  state = {
    bill: null, // {text, previews, method, confidence}
    eob: null,
    activeDoc: "bill",
  };
  $("bill-file").value = "";
  $("eob-file").value = "";
  $("eob-picked").textContent = "";
  $("step-eob").classList.remove("open");   // a fresh form starts collapsed again
  $("step2-hint").hidden = false;
  $("saved-eob").value = "";
  setError("upload-error", "");
  batchFiles = [];
  batchQueue = null;
  batchIndex = 0;
  batchDocs = null;
  batchDocIndex = 0;
  // "I don't have an EOB" is a choice about ONE audit, not a standing
  // preference. Left ticked it disabled the EOB dropzone for every later
  // audit, suppressed saved-EOB pre-selection, and quietly forced bill-only
  // runs — the user just hit this mid-suite. Unticked before the selection
  // below, which bails out while it is checked.
  if ($("no-eob").checked) {
    $("no-eob").checked = false;
    $("no-eob").dispatchEvent(new Event("change"));
  }
  // After the file list is cleared — a stale EOB row from the previous audit
  // would otherwise suppress the saved-EOB pre-selection (bug found live).
  defaultEobSelection();
  renderFiles();
  setBatchLabels(null);
}

// "No EOB" mode: bill-only audit with reduced scope.
$("no-eob").onchange = () => {
  const skip = $("no-eob").checked;
  $("no-eob-note").hidden = !skip;
  $("dz-eob").classList.toggle("disabled", skip);
  if (skip) {
    batchFiles = batchFiles.filter((b) => b.role !== "eob");
    $("eob-picked").textContent = "";
  }
  renderFiles(); // the summary names the EOB in play, so it changes with this
};

// Every file lands in one list, shown under the zone that matches its role.
// The filename decides bill vs EOB when it clearly says so (so "drop them all
// at once" works on either zone); otherwise the zone it landed in decides.
for (const kind of ["bill", "eob"]) {
  const input = $(`${kind}-file`);
  const zone = $(`dz-${kind}`);
  input.onchange = () => {
    addFiles([...input.files], kind);
    input.value = "";
  };
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); zone.classList.remove("drag");
    if (e.dataTransfer.files[0]) addFiles([...e.dataTransfer.files], kind);
  });
}

// ---------- Files & pairing ----------

let batchFiles = []; // [{file, name, role}] everything uploaded, either zone
// Audit ids from the run that just finished, pinned at the top of the bills
// list. Session-scoped on purpose — it answers "what just happened", not
// "what is true", so it never persists and is cleared when a new run starts.
let justAuditedIds = [];
let batchQueue = null; // [{bill: File, eob: File|null, savedEob}] while a batch runs
let batchIndex = 0;
let batchDocs = null; // unique docs for the review-all screen (one tab each)
let batchDocIndex = 0;

const sameFile = (a, b) => a.name === b.name && a.file.size === b.file.size;

function addFiles(files, zoneKind) {
  let addedEob = false;
  for (const file of files) {
    const named = classifyFile(file.name);
    const entry = { file, name: file.name, role: named === "unknown" ? zoneKind : named };
    if (batchFiles.some((b) => sameFile(b, entry))) continue;
    batchFiles.push(entry);
    if (entry.role === "eob") addedEob = true;
  }
  if (addedEob) { // fresh file wins over a saved-library selection
    $("saved-eob").value = "";
    $("eob-picked").textContent = "";
  }
  setError("upload-error", "");
  renderFiles();
}

// The saved EOB that a run would actually use — the same condition run-audit
// applies, so the pairing summary and the run agree.
const appliedSavedEob = () =>
  !$("no-eob").checked && $("saved-eob").value
    ? savedEobs.find((e) => e.id === $("saved-eob").value)
    : null;

function renderFiles() {
  const { pairs, billOnly, orphanEobs } = pairFiles(batchFiles);
  // Step 2 appears once there is a bill to pair it with, and stays once shown —
  // collapsing it again mid-flow would yank content out from under someone who
  // is removing one file of several. Driven from here rather than the change
  // handler so it is correct on every path that mutates the list, including
  // batchBackToPanel() after a mid-batch error.
  if (batchFiles.some((b) => b.role === "bill")) {
    $("step-eob").classList.add("open");
    $("step2-hint").hidden = true;   // the prompt to add a bill has been answered
  }
  for (const kind of ["bill", "eob"]) {
    const list = $(`${kind}-list`);
    list.innerHTML = "";
    for (const entry of batchFiles.filter((b) => b.role === kind)) {
      const row = document.createElement("div");
      row.className = "batch-row";
      row.innerHTML = `<span class="fname">✓ ${escapeHtml(entry.name)}</span><button class="rm" title="Remove">✕</button>`;
      row.querySelector(".rm").onclick = () => {
        batchFiles = batchFiles.filter((b) => b !== entry);
        renderFiles();
      };
      list.appendChild(row);
    }
  }
  const audits = pairs.length + billOnly.length;
  const summary = $("audit-summary");
  summary.hidden = batchFiles.length < 2;
  if (!summary.hidden) {
    summary.innerHTML = [
      // Bills without an uploaded EOB are not necessarily bill-only: a selected
      // saved EOB is attached to each of them at run time, so say so here
      // rather than reporting "no matching EOB" for a bill that has one.
      `<b>${audits} audit${audits === 1 ? "" : "s"}</b>: ${pairs.length} bill+EOB pair${pairs.length === 1 ? "" : "s"}${billOnly.length ? `, ${billOnly.length} with ${appliedSavedEob() ? "your saved EOB" : "no EOB"}` : ""}.`,
      orphanEobs.length ? `⚠️ ${orphanEobs.length} EOB${orphanEobs.length === 1 ? " has" : "s have"} no matching bill and won't be audited.` : "",
      audits > 10 ? "⚠️ The server allows 10 audits per day — anything beyond that will fail until tomorrow." : "",
    ].filter(Boolean).join("<br>");
  }
  $("run-audit").textContent = audits > 1 ? `Start ${audits} audits →` : "Prepare audit →";
}

function setBatchLabels(text) {
  for (const id of ["batch-progress-review", "batch-progress-report"]) {
    $(id).textContent = text || "";
    $(id).hidden = !text;
  }
}

// After an error mid-batch, put the unprocessed remainder back in the lists.
// (A saved-EOB assignment is re-derived from the select on the next start.)
function batchBackToPanel() {
  if (!batchQueue) return;
  const rebuilt = [];
  const add = (entry) => {
    if (!rebuilt.some((o) => sameFile(o, entry))) rebuilt.push(entry);
  };
  for (const it of batchQueue.slice(batchIndex)) {
    add({ file: it.bill, name: it.bill.name, role: "bill" });
    if (it.eob) add({ file: it.eob, name: it.eob.name, role: "eob" });
  }
  batchFiles = rebuilt;
  batchQueue = null;
  setBatchLabels(null);
  renderFiles();
}

// ---------- Upload & processing ----------

$("run-audit").onclick = async () => {
  const { pairs, billOnly } = pairFiles(batchFiles);
  // Fired before extraction and before any model call, so the gap between this
  // and audit_started is the cost of the review step itself.
  track("audit_requested", {
    pairs: pairs.length,
    bill_only: billOnly.length,
    saved_eob: !!appliedSavedEob(),
    no_eob: $("no-eob").checked,
  });
  const skipEob = $("no-eob").checked;
  const savedEob = appliedSavedEob();
  const audits = pairs.length + billOnly.length;
  if (!audits) {
    return setError("upload-error", "The itemized bill is required.");
  }
  // Every bill that would run without an EOB needs an explicit acknowledgement.
  // This used to sit inside the single-audit branch, so a batch of two bills
  // with no EOB skipped the check entirely and audited them bill-only in
  // silence — spending the day's allowance on the weakest kind of audit.
  if (billOnly.length && !savedEob && !skipEob) {
    return setError("upload-error", billOnly.length === audits
      ? "Add your EOB (step 2), pick a saved one, or check “I don't have an EOB”."
      : `${billOnly.length} of these bills ${billOnly.length === 1 ? "has" : "have"} no matching EOB. ` +
        "Add the missing EOB, pick a saved one, or check “I don't have an EOB”.");
  }
  if (audits === 1) {
    const billFile = (pairs[0]?.bill ?? billOnly[0]).file;
    const eobFile = pairs[0]?.eob.file ?? null;
    return prepareAudit(billFile, eobFile, eobFile ? null : savedEob);
  }
  batchQueue = [
    ...pairs.map((p) => ({ bill: p.bill.file, eob: p.eob.file, savedEob: null })),
    ...billOnly.map((b) => ({ bill: b.file, eob: null, savedEob })),
  ];
  batchIndex = 0;
  track("batch_started");
  prepareBatch();
};

// eobFile: freshly uploaded File; savedEob: library entry (text already stored).
// At most one is non-null; both null means bill-only.
async function prepareAudit(billFile, eobFile, savedEob = null) {
  setBatchLabels(null);
  justAuditedIds = [];
  $("tab-bill").textContent = "Bill";
  if (billFile.size > 20e6 || (eobFile && eobFile.size > 20e6)) {
    return setError("upload-error", "Files must be under 20MB.");
  }

  resetStatePreservingFiles();
  show("processing");

  try {
    setStatus("Reading your documents…");
    const bill = await extractText(billFile);
    const eob = eobFile ? await extractText(eobFile) : null;

    // An auto-picked library EOB can be improved now that the bill is readable:
    // swap only on a provider-strength match, and say why on the review screen.
    if (savedEob && savedEobAutoSelected) {
      const m = matchSavedEob(savedEobs, bill.text);
      if (m && m.score >= 2 && m.eob.id !== savedEob.id) savedEob = m.eob;
      const chosen = m && m.eob.id === (savedEob?.id) ? m : null;
      setBatchLabels(chosen
        ? `Using saved EOB: ${savedEob.label} — ${chosen.reason}`
        : `Using saved EOB: ${savedEob.label} — most recent in your library`);
    }

    state.bill = { text: bill.text, images: bill.images, previews: bill.previews, method: bill.method, confidence: bill.confidence };
    if (savedEob) {
      // Library EOB: text stored from a previous session; the file itself was never kept.
      state.eob = { text: savedEobText(savedEob), previews: null, saved: true, confidence: 100 };
    } else if (eob) {
      state.eob = { text: eob.text, images: eob.images, previews: eob.previews, method: eob.method, confidence: eob.confidence };
    } else {
      state.eob = null;
    }

    $("ocr-banner").hidden = !(bill.method === "image" || state.eob?.method === "image");
    // Wrong-EOB guard: warn BEFORE analysis, since a mismatched pair reports
    // every line as "missing from the EOB" and inflates "worth disputing".
    showPairWarning(
      state.eob && !state.eob.saved && eob ? [{ name: billFile.name, rel: documentsRelated(bill.text, eob.text) }] : []
    );
    state.activeDoc = state.eob ? "eob" : "bill";
    $("tab-eob").style.display = state.eob ? "" : "none";
    $("save-eob").checked = true;
    $("save-eob-wrap").hidden = !state.eob || state.eob.saved;
    renderReview();
    show("review");
    track("audit_prepared");
  } catch (e) {
    console.error(e);
    setError("upload-error", `Could not process the documents: ${e.message}`);
    show("upload");
    batchBackToPanel();
  }
}

// pairs: [{name, rel}] from documentsRelated. Only confident mismatches warn —
// an unreadable scan must never raise a false alarm.
function showPairWarning(pairs) {
  const bad = pairs.filter((p) => p.rel && p.rel.confident && !p.rel.related);
  const el = $("pair-banner");
  el.hidden = !bad.length;
  if (!bad.length) return;
  const names = bad.map((p) => escapeHtml(p.name)).join(", ");
  el.innerHTML = `⚠️ <b>This EOB may not cover ${bad.length === 1 ? "this bill" : "these bills"}</b> (${names}) —
    they share no service dates and no procedure codes. Check you picked the right EOB: analyzing a
    mismatched pair reports every line as “missing from the EOB” and overstates what's worth disputing.`;
}

function resetStatePreservingFiles() {
  state = { bill: null, eob: null, activeDoc: "bill" };
}

// Review-all batch flow: every unique document is extracted up front, the
// user reviews them all once, then the audits run without pausing.
async function prepareBatch() {
  resetStatePreservingFiles();
  justAuditedIds = [];
  batchDocs = null;
  $("tab-bill").textContent = "Bill";
  show("processing");
  try {
    const docs = uniqueDocs(batchQueue);
    for (const d of docs) {
      if (d.file && d.file.size > 20e6) throw new Error(`${d.file.name} is over 20MB`);
    }
    const prepared = [];
    for (const [i, d] of docs.entries()) {
      if (d.savedEob) {
        prepared.push({ name: `saved: ${d.savedEob.label}`, kind: "eob", saved: true,
          savedEob: d.savedEob, confidence: 100, text: savedEobText(d.savedEob) });
        continue;
      }
      setStatus(`Reading ${d.file.name} (${i + 1} of ${docs.length})…`);
      const ex = await extractText(d.file);
      prepared.push({ file: d.file, name: d.file.name, kind: d.kind,
        previews: ex.previews, method: ex.method, confidence: ex.confidence, text: ex.text, images: ex.images });
    }
    batchDocs = prepared;
    batchDocIndex = 0;
    $("ocr-banner").hidden = !batchDocs.some((d) => d.method === "image");
    // Same guard per pair — name the bills whose EOB looks unrelated.
    const byFileDoc = new Map(prepared.filter((d) => d.file).map((d) => [d.file, d]));
    showPairWarning(batchQueue
      .filter((it) => it.eob)
      .map((it) => ({
        name: it.bill.name,
        rel: documentsRelated(byFileDoc.get(it.bill)?.text || "", byFileDoc.get(it.eob)?.text || ""),
      })));
    $("save-eob").checked = true;
    $("save-eob-wrap").hidden = !batchDocs.some((d) => d.kind === "eob" && !d.saved);
    setBatchLabels(`Batch: ${batchQueue.length} audits — review every document below, then they run without stopping.`);
    renderReview();
    show("review");
    track("audit_prepared");
  } catch (e) {
    console.error(e);
    setError("upload-error", `Could not process the documents: ${e.message}`);
    batchDocs = null;
    show("upload");
    batchBackToPanel();
  }
}

// The uninterrupted run after the combined review: page images are released
// first, then each audit is sent in turn. On failure the unprocessed
// remainder (including the failed item) goes back to the pairing panel.
async function runBatch() {
  for (const d of batchDocs) { d.previews = null; }
  $("original-pane").textContent = "";
  const byFile = new Map(batchDocs.filter((d) => d.file).map((d) => [d.file, d]));
  const bySaved = new Map(batchDocs.filter((d) => d.savedEob).map((d) => [d.savedEob.id, d]));
  const total = batchQueue.length;
  show("processing");
  try {
    for (; batchIndex < batchQueue.length; batchIndex++) {
      const it = batchQueue[batchIndex];
      const billDoc = byFile.get(it.bill);
      const eobDoc = it.eob ? byFile.get(it.eob) : it.savedEob ? bySaved.get(it.savedEob.id) : null;
      setStatus(`Analyzing audit ${batchIndex + 1} of ${total} — ${it.bill.name}…`);
      const payload = {
        bill: asDoc(billDoc),
        eob: asDoc(eobDoc),
        ocrConfidence: ocrConfidenceOf([billDoc, eobDoc]),
      };
      const { data } = await analyzeFn(payload);
      lastAuditId = data.auditId || null;
      if (data.auditId) justAuditedIds.push(data.auditId);
      if (eobDoc && !eobDoc.saved && $("save-eob").checked) {
        await maybeSaveEob(eobDoc.text, data);
        eobDoc.saved = true; // shared EOB: save once, not once per audit
      }
      track("audit_completed", { ...auditShape(data), mode: "batch" });
    }
    batchQueue = null;
    batchDocs = null;
    setBatchLabels(null);
    // A batch ends on the bills list, not on one arbitrary report: the question
    // after N bills is "what did you find across all of these", and the
    // just-audited block answers it with every audit one click away.
    track("batch_completed", { audits: justAuditedIds.length });
    await loadHistory(); // refreshes allAudits (incl. these audits) + renders the list
    show("bills");
  } catch (e) {
    console.error(e);
    if (e.code === "functions/resource-exhausted") showLimitDialog("audits");
    setError("upload-error",
      `Audit ${batchIndex + 1} of ${total} failed: ${e.code === "functions/resource-exhausted" ? e.message : "analysis error — please try again."} The remaining documents are back below.`);
    show("upload");
    batchBackToPanel();
    batchDocs = null;
  }
}

function setStatus(msg) {
  $("processing-status").textContent = msg;
}

// ---------- Review (double-check) ----------

const tidy = (s) => (s ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

function renderReview() {
  const docState = batchDocs ? batchDocs[batchDocIndex] : state[state.activeDoc];
  // Left pane: the ACTUAL document (rendered pages) when we have it, so the
  // text on the right can be checked against it. This is the only place a bad
  // OCR pass is catchable before an audit is spent on it.
  const orig = $("original-pane");
  if (docState.saved) {
    orig.textContent = "This is a saved EOB — its text was stored when you first uploaded it; the file itself was not.";
  } else if (docState.previews?.length) {
    orig.textContent = "";
    for (const src of docState.previews) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "Your document (local preview)";
      orig.appendChild(img);
    }
  } else {
    orig.textContent = "Text was read straight from the file — no page images to show.";
  }
  // The right pane used to be a raw dump of extracted text, which nobody reads —
  // and an unread disclosure is a worse disclosure. It now leads with what was
  // actually picked up (pages, dates, codes), which is the thing you can check at
  // a glance against the page on the left. The exact text stays one click away,
  // because "see exactly what is sent" has to remain literally true.
  const pane = $("sent-pane");
  pane.textContent = "";
  if (docState.method === "image") {
    pane.textContent =
      "This is a scan, so there is no text to read out of the file. The pages on the left are " +
      "sent as images and read directly — which is more accurate than reading a photo as text. " +
      "Check they are the right pages, and the right way up.";
    return renderReviewTabs();
  }
  const text = docState.text || "";
  const dates = [...datesIn(text)].sort();
  const codes = [...codesIn(text)];
  const summary = document.createElement("div");
  summary.innerHTML = `
    <p style="margin-bottom:10px"><b>${docState.previews?.length || 1} page(s) read</b> —
    ${text.replace(/\s+/g, " ").trim().split(" ").length.toLocaleString()} words.</p>
    <p class="muted" style="margin-bottom:6px"><b>Dates found:</b>
      ${dates.length ? dates.map(escapeHtml).join(" · ") : "<i>none — check the page on the left</i>"}</p>
    <p class="muted" style="margin-bottom:12px"><b>Codes found:</b>
      ${codes.length ? codes.slice(0, 12).map(escapeHtml).join(" · ") + (codes.length > 12 ? ` +${codes.length - 12}` : "") : "<i>none — check the page on the left</i>"}</p>`;
  pane.appendChild(summary);
  const det = document.createElement("details");
  det.innerHTML = `<summary style="cursor:pointer;font-weight:600">Show the exact text being sent</summary>`;
  const pre = document.createElement("div");
  pre.style.cssText = "white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;margin-top:10px";
  pre.textContent = tidy(text);
  det.appendChild(pre);
  pane.appendChild(det);
  const rd = $("review-doc");
  rd.hidden = !batchDocs;
  if (batchDocs) {
    rd.innerHTML = `Reviewing <b>${escapeHtml(docState.name)}</b> — document ${batchDocIndex + 1} of ${batchDocs.length}`;
  }
  renderReviewTabs();
}

// Single mode uses the two fixed Bill/EOB tabs; a batch gets one tab per
// unique document instead.
function renderReviewTabs() {
  const tabs = document.querySelector(".tabs");
  for (const b of tabs.querySelectorAll("button.doc-tab")) b.remove();
  const isBatch = !!batchDocs;
  $("tab-bill").style.display = isBatch ? "none" : "";
  $("tab-eob").style.display = isBatch || !state.eob ? "none" : "";
  if (!isBatch) {
    $("tab-bill").classList.toggle("active", state.activeDoc === "bill");
    $("tab-eob").classList.toggle("active", state.activeDoc === "eob");
    return;
  }
  batchDocs.forEach((d, i) => {
    const b = document.createElement("button");
    b.className = "doc-tab" + (i === batchDocIndex ? " active" : "");
    b.textContent = d.name;
    b.onclick = () => { batchDocIndex = i; renderReview(); };
    tabs.appendChild(b);
  });
}

$("tab-bill").onclick = () => { state.activeDoc = "bill"; renderReview(); };
$("tab-eob").onclick = () => { state.activeDoc = "eob"; renderReview(); };


$("confirm-review").onclick = async () => {
  // The click that actually spends money. Everything before it is free, so the
  // drop-off between audit_requested and here is the review screen's cost.
  track("audit_started", { kind: state.sbcFlow ? "plan" : batchDocs ? "batch" : "single" });
  if (state.sbcFlow) return runSbcExtraction();
  if (batchDocs) return runBatch();
  const payload = {
    bill: asDoc(state.bill),
    eob: asDoc(state.eob),
    ocrConfidence: ocrConfidenceOf([state.bill, state.eob]),
  };
  const ocrLow = payload.ocrConfidence < OCR_CONFIDENCE_THRESHOLD;

  // Release the rendered page images; the text itself is what we are sending.
  state.bill.previews = null;
  if (state.eob) state.eob.previews = null;
  $("original-pane").textContent = "";
  $("bill-file").value = "";
  $("eob-file").value = "";

  show("processing");
  setStatus("Analyzing your bill against the EOB…");
  try {
    const { data } = await analyzeFn(payload);
    lastAuditId = data.auditId || null;
    renderReport(data, { ocrLow, model: data.model, planApplied: data.planApplied, planReason: data.planReason,
      // .text, not the doc itself: payload.bill is {text, images}, and stringifying
      // that yields "[object Object]" — no dates, no codes, so documentsRelated
      // reported "can't judge" and the warning was silently suppressed on the one
      // report that matters most, the one you see right after paying for the audit.
      pairUnrelated: unrelatedPair(payload.bill.text, payload.eob.text) });
    show("report");
    track("audit_completed", { ...auditShape(data), mode: "single" });
    if (state.eob && !state.eob.saved && $("save-eob").checked) {
      await maybeSaveEob(state.eob.text, data);
    }
    await loadHistory(); // refreshes allAudits (incl. this audit) + usage cards
    renderReportUsage(data);
  } catch (e) {
    console.error(e);
    if (e.code === "functions/resource-exhausted") showLimitDialog("audits");
    setError("upload-error",
      e.code === "functions/resource-exhausted" ? e.message : "Analysis failed — please try again.");
    show("upload");
    batchBackToPanel();
  }
};

$("back-to-upload").onclick = () => { resetState(); show("upload"); };

$("go-audit").onclick = () => { resetState(); show("upload"); };
$("ld-close").onclick = () => $("limit-dialog").close();
$("ld-bills").onclick = () => { $("limit-dialog").close(); show("bills"); };
for (const el of document.querySelectorAll(".back-link")) {
  el.onclick = (e) => { e.preventDefault(); show("bills"); };
}

// The logo is the thing people click first to get home, and while signed in it
// was an href="/" that left the app for the marketing page. The header is the
// only control visible from every screen, so this is the one exit that is
// always in reach. Signed out it still goes to the marketing page, which is
// where a logo should go when there is no home to return to.
// Open the disclosure the first time someone reaches the audit form, then let it
// stay closed. The summary line is always visible either way, so what changes is
// how much prose a returning member re-reads — not whether they were told.
const WDG_SEEN = "ucr-seen-doc-disclosure";
{
  const d = $("where-docs-go");
  if (d) {
    d.open = localStorage.getItem(WDG_SEEN) !== "1";
    d.addEventListener("toggle", () => { if (d.open) localStorage.setItem(WDG_SEEN, "1"); });
    if (d.open) localStorage.setItem(WDG_SEEN, "1");
  }
}

$("logo-link").onclick = (e) => {
  if (!auth.currentUser) return;           // signed out: let the href do its job
  e.preventDefault();
  show("bills");
};

// ---------- Report ----------

const TYPE_LABELS = {
  duplicate_charge: "Duplicate charge",
  unbundling: "Unbundled charges",
  wrong_code: "Code / description mismatch",
  billed_vs_allowed_mismatch: "Billed above EOB allowed amount",
  not_in_eob: "On the bill, missing from the EOB",
  cost_share_error: "Cost-sharing math error",
  charity_care_eligible: "Financial assistance may apply",
  copay_mismatch: "Copay doesn't match your plan",
  coinsurance_mismatch: "Coinsurance math doesn't match",
  deductible_misapplied: "Deductible applied where plan says none",
  not_covered_per_plan: "Coverage question worth asking",
};

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—");

let lastReport = null;
let lastAuditId = null;

// ---------- Feedback widget ----------

let fbCategory = "bug";
$("fb-bubble").onclick = () => {
  $("fb-card").hidden = !$("fb-card").hidden;
  if (!$("fb-card").hidden) $("fb-text").focus();
};
$("fb-close").onclick = () => { $("fb-card").hidden = true; };
for (const b of document.querySelectorAll(".fb-chips button")) {
  b.onclick = () => {
    fbCategory = b.dataset.cat;
    for (const o of document.querySelectorAll(".fb-chips button")) o.classList.toggle("active", o === b);
  };
}
$("fb-send").onclick = async () => {
  const message = $("fb-text").value.trim();
  if (!message) return;
  $("fb-send").disabled = true;
  $("fb-status").textContent = "Sending…";
  try {
    await submitFeedbackFn({
      message, category: fbCategory, screen: currentSection,
      auditId: currentSection === "report" ? lastAuditId : null,
    });
    $("fb-status").textContent = "Thanks — we read every note.";
    $("fb-text").value = "";
    setTimeout(() => { $("fb-card").hidden = true; $("fb-status").textContent = ""; $("fb-send").disabled = false; }, 1200);
  } catch (e) {
    console.error(e);
    $("fb-status").textContent = e.code === "functions/resource-exhausted" ? e.message : "Couldn't send — try again.";
    $("fb-send").disabled = false;
  }
};

const PLAN_TYPES = new Set(["copay_mismatch", "coinsurance_mismatch", "deductible_misapplied", "not_covered_per_plan"]);

function renderReport(data, { ocrLow, model, planApplied, planReason, pairUnrelated } = {}) {
  const { findings = [], totals = {}, occurrenceTable = [] } = data;
  lastReport = { findings, totals, occurrenceTable };
  $("email-card").hidden = true;

  $("report-caveat").hidden = !ocrLow;

  // Backstop for a mismatched pair that got past the pre-send warning.
  //
  // "Every finding is not_in_eob" alone proved too narrow: a real mismatched
  // pair also yields bill-only findings (a duplicate line, a charity-care
  // flag), so the E6 fixture reported $2,260.50 with no warning at all. The
  // decisive evidence is the same one the pre-send banner uses — whether the
  // two documents share any dates or codes — so it is carried through here.
  const anyMissing = findings.some((f) => f.type === "not_in_eob");
  const allMissing = findings.length >= 2 && findings.every((f) => f.type === "not_in_eob");
  const showPairWarn = anyMissing && (pairUnrelated || allMissing);
  $("report-pair-warning").hidden = !showPairWarn;
  if (showPairWarn) {
    // Say which evidence fired: "every line missing" is untrue when the trigger
    // was two documents that simply don't correspond.
    const why = pairUnrelated
      ? `<b>This EOB may not cover this bill.</b> They share no service dates and no procedure codes,
         so charges here may be marked "missing from the EOB" only because your insurer never processed this bill.`
      : `<b>Every line on this bill came back missing from the EOB.</b>
         That usually means these two documents don't go together.`;
    $("report-pair-warning").innerHTML =
      `⚠️ ${why} Check you paired the right EOB before acting on the total below.`;
  }

  $("report-totals").innerHTML = `
    <div class="tot"><span>Billed</span><b>${fmt(totals.billed)}</b></div>
    <div class="tot"><span>EOB allowed</span><b>${fmt(totals.eobAllowed)}</b></div>
    <div class="tot"><span>Your responsibility</span><b>${fmt(totals.patientResponsibility)}</b></div>
    <div class="tot hi"><span>Worth disputing</span><b>${fmt(totals.totalAtStake)}</b></div>`;

  const byType = {};
  for (const f of findings) (byType[f.type] ||= []).push(f);

  $("report-findings").innerHTML = findings.length
    ? Object.entries(byType).map(([type, list]) => `
        <h3>${TYPE_LABELS[type] || type} <span class="count">${list.length}</span></h3>
        ${list.map((f) => PLAN_TYPES.has(f.type) ? `
          <div class="finding ${f.confidence}">
            <div class="f-head"><b>${fmt(f.amountAtStake)}</b><span class="conf">${f.confidence} confidence</span></div>
            <div class="xq"><span class="src">SBC</span>“${escapeHtml(f.evidence.sbcQuote)}”</div>
            <div class="xq"><span class="src">${f.evidence.billQuote ? "Bill" : "EOB"}</span>“${escapeHtml(f.evidence.billQuote || f.evidence.eobQuote)}”</div>
            <p>${escapeHtml(f.description)} — <mark>${fmt(f.amountAtStake)} you may not owe</mark>.</p>
            <p class="lineref">${escapeHtml(f.lineRef)}</p>
          </div>` : `
          <div class="finding ${f.confidence}">
            <div class="f-head"><b>${fmt(f.amountAtStake)}</b><span class="conf">${f.confidence} confidence</span></div>
            <p>${escapeHtml(f.description)}</p>
            <details><summary>Evidence</summary>
              <p><b>Bill:</b> “${escapeHtml(f.evidence.billQuote)}”</p>
              ${f.evidence.eobQuote ? `<p><b>EOB:</b> “${escapeHtml(f.evidence.eobQuote)}”</p>` : ""}
              <p class="lineref">${escapeHtml(f.lineRef)}</p>
            </details>
          </div>`).join("")}`).join("")
    : "<p>No discrepancies found. The bill and EOB appear consistent.</p>";

  $("report-occurrences").innerHTML = occurrenceTable.length
    ? `<tr><th>Code</th><th>Description</th><th>Count</th><th>Unit charges</th></tr>` +
      occurrenceTable.map((r) =>
        `<tr><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.description)}</td><td>${r.count}</td><td>${r.unitCharges.map(fmt).join(", ")}</td></tr>`
      ).join("")
    : "";

  const note = $("plan-note");
  if (planApplied === false && planReason) {
    note.hidden = false;
    note.innerHTML = planReason === "no_plan"
      ? `Not checked against your plan — add your Summary of Benefits under “Your coverage” on the bills page to enable plan checks.`
      : planReason === "out_of_period"
        ? `Not checked against your plan — this bill's service dates fall outside your plan year${activePlan?.structured?.planYearEnd ? ` (ended ${escapeHtml(activePlan.structured.planYearEnd)})` : ""}.`
        : `Not checked against your plan — no service dates could be read from this bill.`;
  } else { note.hidden = true; note.innerHTML = ""; }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("print-report").onclick = () => window.print();
$("new-audit").onclick = () => { resetState(); show("upload"); };

// ---------- Dispute email generator ----------

// The letter is built by the server from the stored audit, not here. It is the
// one thing there is any prospect of charging for, and a gate in the browser is
// decoration — so the text never exists client-side until the server hands it
// over. Free today; when there is a price, the check goes in the callable.
$("gen-email").onclick = async () => {
  if (!lastAuditId) return;
  const btn = $("gen-email");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing…";
  try {
    const { data } = await generateLetterFn({ auditId: lastAuditId });
    $("paywall").hidden = true;
    $("email-text").value = data.letter;
    $("email-card").hidden = false;
    $("email-card").scrollIntoView({ behavior: "smooth" });
    // The paywall moment, if there is ever a paywall: this is the step whose
    // conversion rate decides whether the appeal letter is the thing to sell.
    track("dispute_email_generated", { findings: (lastReport?.findings || []).length });
  } catch (e) {
    // A refusal for payment is not an error to apologise for — it is the offer.
    if (e?.code === "functions/permission-denied") showPaywall(e?.details);
    else setError("report-error", e?.message || "Couldn't prepare the letter. Try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
};

// The price is whatever the server just said it is. Never hardcoded here, so
// the button cannot promise a number Stripe does not charge.
function showPaywall(details) {
  const cents = Number(details?.priceCents);
  $("buy-price").textContent = Number.isFinite(cents)
    ? `Unlock this letter — ${fmt(cents / 100)}`
    : "Unlock this letter";
  setError("paywall-error", "");
  $("paywall").hidden = false;
  $("paywall").scrollIntoView({ behavior: "smooth" });
}

$("buy-letter").onclick = async () => {
  if (!lastAuditId) return;
  const btn = $("buy-letter");
  btn.disabled = true;
  const label = $("buy-price").textContent;
  $("buy-price").textContent = "Opening checkout…";
  try {
    const { data } = await createCheckoutSessionFn({ auditId: lastAuditId });
    // Already paid on another device or tab — no reason to charge again.
    if (data.alreadyEntitled) { $("paywall").hidden = true; $("gen-email").click(); return; }
    if (!data.url) throw new Error("Checkout is unavailable right now.");
    window.location.assign(data.url);
  } catch (e) {
    setError("paywall-error", e?.message || "Couldn't open checkout. Try again.");
    btn.disabled = false;
    $("buy-price").textContent = label;
  }
};

// Coming back from Stripe. The audit id rides on the success URL because this
// is a fresh page load — nothing from before the redirect survives.
async function resumeAfterCheckout() {
  const q = new URLSearchParams(location.search);
  if (!q.has("paid")) return;
  const auditId = q.get("audit");
  // Clean the URL first, so a refresh does not look like a second purchase.
  history.replaceState(null, "", location.pathname);
  if (q.get("paid") !== "1" || !auditId) return;
  await openAudit(auditId);
  $("paywall").hidden = true;
  // The webhook may still be in flight; the letter call is what confirms it.
  $("gen-email").click();
}

$("copy-email").onclick = async () => {
  await navigator.clipboard.writeText($("email-text").value);
  $("copy-email").textContent = "Copied ✓";
  setTimeout(() => ($("copy-email").textContent = "Copy"), 1500);
};

$("download-email").onclick = () => {
  const blob = new Blob([$("email-text").value], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "dispute-email.txt";
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---------- History + usage data ----------

let allAudits = [];   // normalized for usage.js
let allTrackers = []; // {id, label, codes, limit, planYearStartMonth}

const isoDate = (d) => d.toISOString().slice(0, 10);
const todayISO = () => isoDate(new Date());

// Mirrors DAILY_LIMIT in functions/index.js. The server is the authority — this
// is only for showing what is left, so a drift here costs a wrong label, never
// a wrong decision: the callable still rejects the 11th audit either way.
const DAILY_AUDIT_LIMIT = 10;

// Show what's left before the wall, not only at it. The counter is
// Function-owned and read-only to clients; it rolls over on the UTC date, so a
// stored day that isn't today means the allowance is untouched.
async function renderQuota() {
  const el = $("cta-quota");
  if (!el || !auth.currentUser) return;
  let used = 0;
  try {
    const snap = await getDoc(doc(db, `users/${auth.currentUser.uid}/meta/usage`));
    const d = snap.exists() ? snap.data() : null;
    if (d && d.day === todayUtc()) used = d.count || 0;
  } catch {
    el.textContent = ""; // never let a counter read block the page
    return;
  }
  const left = Math.max(0, DAILY_AUDIT_LIMIT - used);
  el.textContent = left === 0
    ? `0 of ${DAILY_AUDIT_LIMIT} audits left today`
    : `${left} of ${DAILY_AUDIT_LIMIT} audits left today`;
  el.className = left === 0 ? "out" : left <= 3 ? "low" : "";
}

// The server counts by UTC date (checkRateLimit), so the client must too —
// todayISO() is local and would roll over at the wrong moment.
const todayUtc = () => new Date().toISOString().slice(0, 10);

async function loadHistory() {
  const user = auth.currentUser;
  if (!user) return;
  // Audits, trackers, and the EOB library are independent — fetch in parallel.
  const [snap] = await Promise.all([
    getDocs(query(collection(db, `users/${user.uid}/audits`), orderBy("createdAt", "desc"))),
    loadTrackers(),
    loadEobs(),
  ]);
  allAudits = [];
  snap.forEach((d) => {
    const a = d.data();
    const created = a.createdAt?.toDate?.();
    const findings = a.findings || [];
    allAudits.push({
      id: d.id,
      serviceDates: a.serviceDates || [],
      occurrenceTable: a.occurrenceTable || [],
      accumulators: a.accumulators || null,
      payerRemarks: a.payerRemarks || [],
      provider: a.provider || "",
      createdAtDate: created ? isoDate(created) : "",
      // Dashboard fields: identity of the paper (so the same bill audited twice
      // is never mistaken for a double-bill), money, and a human summary.
      billKey: billKeyOf(auditText(a, 'bill'), a.statementId, a.provider),
      patientName: a.patientName || "",
      atStake: a.totals?.totalAtStake || 0,
      findingTypes: findings.map((f) => f.type),
      summary: summarizeFindings(findings),
    });
  });
  renderDashboard();
  renderQuota();
  renderUsage();
}

// "Duplicate charge · Copay doesn't match your plan" — what was found, in the
// user's words, capped so a row stays one line.
function summarizeFindings(findings) {
  const labels = [...new Set(findings.map((f) => TYPE_LABELS[f.type] || f.type))];
  if (!labels.length) return "";
  return labels.slice(0, 2).join(" · ") + (labels.length > 2 ? ` +${labels.length - 2}` : "");
}

// True when a bill and EOB share no service dates and no procedure codes, i.e.
// they very likely don't belong together. Unreadable documents return related,
// so a doc we couldn't parse never raises a false alarm.
function unrelatedPair(billText, eobText) {
  if (!billText || !eobText) return false;
  const rel = documentsRelated(billText, eobText);
  return !rel.related && rel.confident;
}

async function openAudit(id) {
  const full = await getDoc(doc(db, `users/${auth.currentUser.uid}/audits/${id}`));
  const data = full.data();
  // The letter is fetched by id, so re-opening a stored report has to set this
  // too — not just a fresh run. Without it "Generate dispute email" silently
  // does nothing on every audit in the history.
  lastAuditId = id;
  $("paywall").hidden = true;
  setError("report-error", "");
  renderReport(data, {
    ocrLow: (data.ocrConfidence ?? 100) < OCR_CONFIDENCE_THRESHOLD,
    planApplied: data.planApplied, planReason: data.planReason,
    pairUnrelated: unrelatedPair(auditText(data, 'bill'), auditText(data, 'eob')),
  });
  renderReportUsage(data);
  show("report");
}

async function deleteAudit(id) {
  if (!await confirmAction({
    title: "Delete this audit?",
    body: "The audit and its findings are removed permanently. Your other audits are untouched.",
    confirmLabel: "Delete audit", danger: true,
  })) return;
  await deleteDoc(doc(db, `users/${auth.currentUser.uid}/audits/${id}`));
  loadHistory();
}

const shortDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return Number.isFinite(y) ? new Date(Date.UTC(y, (m || 1) - 1, d || 1)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : iso;
};

function renderDashboard() {
  const win = planYearWindow(allTrackers[0]?.planYearStartMonth || planYearStartMonthFrom(activePlan?.structured?.planYearStart), todayISO());
  const totals = runningTotals(allAudits, win);
  $("dash-subtitle").innerHTML = allAudits.length
    ? `${totals.audited} bill${totals.audited === 1 ? "" : "s"} audited this plan year · ${totals.findings} finding${totals.findings === 1 ? "" : "s"} — what's still worth disputing, and what's left of your coverage.`
    : "Audit a bill above and it'll show up here with what's worth disputing.";

  // Hero: the finding no single audit can produce.
  const dups = crossBillDuplicates(allAudits);
  const dc = $("dup-card");
  if (!dups.length) {
    dc.innerHTML = "";
  } else {
    const d = dups[0];
    dc.innerHTML = `<div class="dup-hero">
      <div class="dup-ribbon">Found by comparing your bills to each other</div>
      <div class="dup-body">
        <div class="dup-amount"><b>${fmt(d.amount)}</b><span>at stake</span></div>
        <div class="dup-main">
          <h3>The same visit is on two statements</h3>
          <p>${escapeHtml(d.provider || "This provider")} billed ${escapeHtml(d.code)}${d.description ? ` — ${escapeHtml(d.description)}` : ""} —
             for ${escapeHtml(shortDate(d.date))} on two different statements. You likely owe one, not both.</p>
          <div class="dup-statements">
            ${d.bills.map((b, i) => `<button class="dup-st" data-audit="${escapeHtml(b.auditId)}">
              <span><span class="pg-label">Statement ${String.fromCharCode(65 + i)}</span>
              <span class="when">audited ${escapeHtml(shortDate(b.statementDate))}</span></span>
              <b class="money-pill">${fmt(b.amount)}</b></button>`).join("")}
          </div>
          <details class="explain" style="margin-top:2px"><summary>Why this was flagged</summary>
            <p>Both statements list the same service code on the same date of service from the same provider,
            but they are different documents — so the visit appears to have been billed twice. Open each one to
            compare, then ask the provider to void the duplicate. If you uploaded the same bill twice, it is not
            counted here.</p>
          </details>
        </div>
      </div>
    </div>`;
    for (const b of dc.querySelectorAll(".dup-st")) b.onclick = () => openAudit(b.dataset.audit);
  }

  // What the run that just finished found. The same bills also appear in their
  // provider groups below — this is a lens on the list, not a second list.
  const just = splitJustAudited(allAudits, justAuditedIds);
  const ja = $("just-audited");
  if (!just.length) {
    ja.innerHTML = "";
  } else {
    const jt = runningTotals(just);
    ja.innerHTML = `<div class="just-block">
      <div class="just-head">Just audited
        <span class="count">${just.length} bill${just.length === 1 ? "" : "s"}</span>
        <span class="money-pill">${fmt(jt.atStake)}</span>
        <span class="muted">worth disputing</span></div>
      ${just.map((b) => `<div class="bill-row${b.atStake ? "" : " quiet"}">
        <span class="when">${escapeHtml(shortDate(b.serviceDates[0] || b.createdAtDate))}</span>
        <button class="what" data-audit="${escapeHtml(b.id)}">${escapeHtml(b.summary || "Nothing to dispute")}</button>
        ${b.atStake ? `<span class="money-pill">${fmt(b.atStake)}</span>` : ""}
      </div>`).join("")}
    </div>`;
    for (const el of ja.querySelectorAll(".what")) el.onclick = () => openAudit(el.dataset.audit);
  }

  // Bills, money first.
  const { groups, clean } = groupAuditsByProvider(allAudits);
  $("bills-total").innerHTML = totals.atStake
    ? `<span class="money-pill">${fmt(totals.atStake)}</span> <span class="muted">worth disputing across ${groups.length} provider${groups.length === 1 ? "" : "s"}</span>`
    : "";
  $("bills-sort").textContent = groups.length > 1 ? "Sorted by amount at stake" : "";

  const bg = $("bill-groups");
  bg.innerHTML = groups.length
    ? groups.map((g) => `<details class="prov-group" open>
        <summary><span class="caret">▾</span> ${escapeHtml(g.provider)}
          <span class="count">${g.bills.length} bill${g.bills.length === 1 ? "" : "s"}</span>
          <span class="money-pill">${fmt(g.atStake)}</span></summary>
        ${g.bills.map((b) => `<div class="bill-row">
          <span class="when">${escapeHtml(shortDate(b.serviceDates[0] || b.createdAtDate))}</span>
          <button class="what" data-audit="${escapeHtml(b.id)}">${escapeHtml(b.summary)}</button>
          <span class="money-pill">${fmt(b.atStake)}</span>
          <button class="rm" data-del="${escapeHtml(b.id)}" title="Delete this audit">✕</button>
        </div>`).join("")}
      </details>`).join("")
    : (allAudits.length ? "" : '<p class="muted">No bills audited yet — start one above and it\'ll show up here with what\'s worth disputing.</p>');

  $("clean-bills").innerHTML = clean.length
    ? `<details class="prov-group"><summary><span class="caret">▸</span> Clean bills
        <span class="count">${clean.length} with nothing to dispute</span></summary>
        ${clean.map((b) => `<div class="bill-row quiet">
          <span class="when">${escapeHtml(shortDate(b.serviceDates[0] || b.createdAtDate))}</span>
          <button class="what" data-audit="${escapeHtml(b.id)}">${escapeHtml(b.provider || "Provider not read")} — nothing to dispute</button>
          <button class="rm" data-del="${escapeHtml(b.id)}" title="Delete this audit">✕</button>
        </div>`).join("")}
      </details>`
    : "";

  for (const el of document.querySelectorAll("#bill-groups .what, #clean-bills .what")) {
    el.onclick = () => openAudit(el.dataset.audit);
  }
  for (const el of document.querySelectorAll("#bill-groups .rm, #clean-bills .rm")) {
    el.onclick = () => deleteAudit(el.dataset.del);
  }
}

async function loadTrackers() {
  const user = auth.currentUser;
  if (!user) return;
  const snap = await getDocs(collection(db, `users/${user.uid}/trackers`));
  allTrackers = [];
  snap.forEach((d) => allTrackers.push({ id: d.id, ...d.data() }));
}

// Field names changed when on-device redaction was removed: `redactedText` and
// `redactedBill`/`redactedEob` described a step that no longer happens. Stored
// documents written before that change still carry the old names, so read both.
// Delete these once nothing pre-rename remains.
const savedEobText = (e) => e?.text ?? e?.redactedText ?? "";
const planText = (p) => p?.text ?? p?.redactedText ?? "";
const auditText = (a, which) =>
  (which === "bill" ? a?.bill ?? a?.redactedBill : a?.eob ?? a?.redactedEob) ?? "";

// ---------- Saved EOBs (text library for reuse across bills) ----------

let savedEobs = []; // {id, label, text}

async function loadEobs() {
  const user = auth.currentUser;
  if (!user) return;
  const snap = await getDocs(
    query(collection(db, `users/${user.uid}/eobs`), orderBy("createdAt", "desc"))
  );
  savedEobs = [];
  snap.forEach((d) => savedEobs.push({ id: d.id, ...d.data() }));

  $("saved-eob-wrap").hidden = !savedEobs.length;
  $("cta-eob").textContent = savedEobs.length ? `EOB on file: ${savedEobs[0].label}` : "";
  const sel = $("saved-eob");
  const prev = sel.value;
  sel.innerHTML = '<option value="">— choose a saved EOB —</option>' +
    savedEobs.map((e) => `<option value="${e.id}">${escapeHtml(e.label)}</option>`).join("");
  if (savedEobs.some((e) => e.id === prev)) sel.value = prev;
  defaultEobSelection();

  const list = $("saved-eob-list");
  list.innerHTML = "";
  for (const e of savedEobs) {
    const row = document.createElement("div");
    row.className = "batch-row";
    row.innerHTML = `<span class="fname">${escapeHtml(e.label)}</span><button class="rm" title="Delete">✕</button>`;
    row.querySelector(".rm").onclick = async () => {
      if (await confirmAction({
        title: "Delete this saved EOB?",
        body: `“${e.label}” will no longer be available to audit future bills against.`,
        confirmLabel: "Delete", danger: true,
      })) {
        await deleteDoc(doc(db, `users/${auth.currentUser.uid}/eobs/${e.id}`));
        loadEobs();
      }
    };
    list.appendChild(row);
  }
}

// With a library on file, the EOB step answers itself: pre-select the most
// recent saved EOB so a new bill can be audited with zero extra clicks.
// Auto picks may be improved by the content matcher once the bill is read;
// a user's explicit dropdown choice is never overridden.
let savedEobAutoSelected = false;

function defaultEobSelection() {
  if (!savedEobs.length || $("saved-eob").value || batchFiles.some((b) => b.role === "eob") || $("no-eob").checked) return;
  $("saved-eob").value = savedEobs[0].id;
  savedEobAutoSelected = true;
  $("eob-picked").textContent = `✓ using saved: ${savedEobs[0].label} — change below if this isn't the right one`;
}

$("saved-eob").onchange = () => {
  savedEobAutoSelected = false; // explicit choice
  if ($("saved-eob").value) {
    $("eob-picked").textContent = `✓ saved: ${$("saved-eob").selectedOptions[0].textContent}`;
    $("no-eob").checked = false;
    $("no-eob").dispatchEvent(new Event("change"));
  } else {
    $("eob-picked").textContent = "";
  }
  renderFiles();
};

async function maybeSaveEob(text, data) {
  if (savedEobs.some((e) => savedEobText(e) === text)) return; // already saved
  const label = `${data.provider || "EOB"} · ${(data.serviceDates || [])[0] || todayISO()}`;
  await addDoc(collection(db, `users/${auth.currentUser.uid}/eobs`), {
    label, text, createdAt: serverTimestamp(),
    // Matching metadata: lets future lone bills find this EOB by content.
    provider: data.provider || "",
    serviceDates: data.serviceDates || [],
    codes: (data.occurrenceTable || []).map((r) => r.code),
  });
  // No refresh here: the loadHistory() that follows every audit reloads the library.
  track("eob_saved");
}

// ---------- Your plan (SBC) ----------

let activePlan = null; // {structured, digest, text, sourceName, createdAt}

async function loadPlan() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const snap = await getDoc(doc(db, `users/${user.uid}/plan/active`));
    activePlan = snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error("loadPlan failed — showing empty plan card", e);
    activePlan = null;
  }
  renderPlanCard();
}

function renderPlanCard() {
  const el = $("plan-card");
  const s = activePlan?.structured;
  if (!s) {
    // Empty slot, not a warning: dashed border echoes the dropzone grammar.
    el.innerHTML = `<div class="usage-card plan-line" style="border:1px dashed var(--line)">
      <span class="muted">No plan on file — add your Summary of Benefits</span>
      <span class="pl-actions"><a href="#" id="plan-add-now">Add now</a></span>
    </div>`;
    $("plan-add-now").onclick = (e) => { e.preventDefault(); openOnboarding("bills"); };
  } else {
    // Plan on file: one quiet line — the numbers live on the deductible and
    // tracker cards; this line only identifies the plan and offers actions.
    const expired = s.planYearEnd && todayISO() > s.planYearEnd;
    el.innerHTML = `<div class="usage-card plan-top plan-line">
      <b><span style="color:var(--good)">✓</span> Plan on file: ${escapeHtml(s.planName || "")}</b>
      <span class="plan-period">${escapeHtml(s.planYearStart || "?")} → ${escapeHtml(s.planYearEnd || "?")}</span>
      <span class="pl-actions">
        <a href="#" id="plan-view">View</a>
        <label>Replace<input id="sbc-file-replace" type="file" hidden accept="application/pdf,image/*,text/html,.html,.htm,text/plain,.txt"></label>
        <a href="#" id="plan-remove" style="color:var(--bad)">Remove</a>
      </span>
    </div>
    ${expired ? `<div class="banner">Your plan year ended ${escapeHtml(s.planYearEnd)} — upload your new SBC.</div>` : ""}`;
    $("plan-view").onclick = (e) => {
      e.preventDefault();
      const full = $("plan-full");
      full.querySelector("pre").textContent = planText(activePlan) || "No stored text.";
      full.hidden = !full.hidden;
    };
    $("plan-remove").onclick = async (e) => {
      e.preventDefault();
      if (!await confirmAction({
        title: "Remove your plan?",
        body: `${s.planName || "Your SBC"} will be removed, and audits will no longer be checked against it. Trackers you've created stay.`,
        confirmLabel: "Remove plan", danger: true,
      })) return;
      await deleteDoc(doc(db, `users/${auth.currentUser.uid}/plan/active`));
      activePlan = null;
      $("plan-full").hidden = true;
      renderPlanCard();
      renderUsage();
    };
  }
  const rep = $("sbc-file-replace");
  if (rep) rep.onchange = () => { if (rep.files[0]) prepareSbc(rep.files[0]); rep.value = ""; };
}

// The SBC dropzone is static markup in the onboarding section — wire it once.
{
  const input = $("sbc-file");
  input.onchange = () => { if (input.files[0]) prepareSbc(input.files[0]); input.value = ""; };
  const dz = $("dz-sbc");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault(); dz.classList.remove("drag");
    if (e.dataTransfer.files[0]) prepareSbc(e.dataTransfer.files[0]);
  });
}

const sbcErrTarget = () => (state?.sbcOrigin === "onboarding" ? "onboarding-error" : "bills-error");

async function prepareSbc(file) {
  const origin = !$("onboarding").hidden ? "onboarding" : "bills";
  if (file.size > 20e6) {
    return setError(origin === "onboarding" ? "onboarding-error" : "bills-error", "Files must be under 20MB.");
  }
  resetStatePreservingFiles();
  state.sbcFlow = true;
  state.sbcOrigin = origin;
  $("tab-bill").textContent = "Plan (SBC)";
  show("processing");
  try {
    setStatus("Reading your Summary of Benefits…");
    const ex = await extractText(file);
    state.bill = { text: ex.text, previews: ex.previews, method: ex.method, confidence: ex.confidence };
    state.sbcName = file.name;
    // Free duplicate check: same text means the same document.
    // Duplicate check needs text on both sides; a scanned SBC has none until
    // the model reads it, so it simply is not checked here.
    if (activePlan && state.bill.text && planText(activePlan) === state.bill.text) {
      show(state.sbcOrigin);
      return setError(sbcErrTarget(), "This plan is already on file.");
    }
    $("ocr-banner").hidden = ex.method !== "image";
    state.activeDoc = "bill";
    $("tab-eob").style.display = "none";
    $("save-eob-wrap").hidden = true;
    setBatchLabels("Reviewing your Summary of Benefits — plan documents contain little personal info, but check anyway.");
    renderReview();
    show("review");
  } catch (e) {
    console.error(e);
    setError(sbcErrTarget(), `Could not process the document: ${e.message}`);
    show(state.sbcOrigin);
  }
}

async function runSbcExtraction(force = false) {
  const sbc = asDoc(state.bill);
  const sourceName = state.sbcName || "";
  state.bill.previews = null;
  $("original-pane").textContent = "";
  show("processing");
  setStatus("Reading your plan's terms…");
  try {
    const { data } = await extractPlanFn({ sbc, sourceName, force });
    if (data.status === "confirm_older") {
      // The question is not "is this a duplicate" but "this one is OLDER — sure?",
      // so the title says that and the button carries the verb.
      const msg = `The plan on file covers ${data.existingPeriod.start} to ${data.existingPeriod.end}. ` +
        `This document covers ${data.incomingPeriod.start} to ${data.incomingPeriod.end}, which is earlier. ` +
        `Replacing it means audits are checked against the older terms.`;
      if (await confirmAction({ title: "Replace the plan on file with an older one?", body: msg, confirmLabel: "Replace anyway" })) {
        return runSbcExtraction(true);
      }
      show("bills"); setBatchLabels(null); return;
    }
    await loadPlan();
    await applySbcConfiguration();
    setBatchLabels(null);
    show("bills");
    track("plan_added");
    $("plan-card").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    console.error(e);
    if (e.code === "functions/resource-exhausted") showLimitDialog("plans");
    setError(sbcErrTarget(), e.code === "functions/resource-exhausted" || e.code === "functions/invalid-argument"
      ? e.message : "Plan extraction failed — please try again.");
    show(state.sbcOrigin); setBatchLabels(null);
  }
}

// After a successful SBC extraction: create/update sbc-sourced trackers.
async function applySbcConfiguration() {
  const s = activePlan?.structured;
  if (!s) return;
  const month = planYearStartMonthFrom(s.planYearStart);
  const { create, update } = mergeSbcTrackers(allTrackers, s.limits || [], month);
  const uid = auth.currentUser.uid;
  for (const t of create) {
    await addDoc(collection(db, `users/${uid}/trackers`), { ...t, createdAt: serverTimestamp() });
  }
  for (const u of update) {
    await updateDoc(doc(db, `users/${uid}/trackers/${u.id}`), u.changes);
  }
  if (create.length || update.length) { await loadTrackers(); }
  renderUsage();
}

// ---------- Usage tracker UI ----------

const LEVEL_NOTES = {
  near: "One covered visit left this plan year.",
  at: "Limit reached — further visits may be your responsibility.",
  over: "Over the limit — visits beyond it are likely your responsibility.",
};

// One place computes a tracker's plan-year window, visit count, and warning
// level — the usage cards and the report line must never disagree.
function trackerStatus(t) {
  const w = planYearWindow(t.planYearStartMonth || 1, todayISO());
  const { count, contributions } = visitsUsed(allAudits, t, w);
  return { w, count, contributions, level: warningLevel(count, t.limit) };
}

function renderUsage() {
  const list = $("usage-list");
  list.innerHTML = "";
  for (const t of allTrackers) {
    const { w, count, contributions, level } = trackerStatus(t);
    const card = document.createElement("div");
    card.className = `usage-card ${level}`;
    const pct = Math.min(100, t.limit > 0 ? (count / t.limit) * 100 : 0);
    card.innerHTML = `
      <div class="usage-head">
        <b>${escapeHtml(t.label)}</b>${t.source === "sbc" && !t.confirmed ? ' <span class="count" title="Codes were suggested from your SBC — open the tracker and confirm them">from your SBC — check the codes</span>' : ""}
        <span style="display:flex;gap:10px;align-items:center">
          <span class="usage-count">${count} / ${t.limit}</span>
          <button class="usage-del" title="Stop tracking">✕</button>
        </span>
      </div>
      <div class="progress"><div class="bar" style="width:${pct}%"></div></div>
      ${LEVEL_NOTES[level] ? `<div class="usage-note">${LEVEL_NOTES[level]}</div>` : ""}
      <details><summary class="muted">${contributions.length} contributing audit(s) · plan year ${w.start} → ${w.end}</summary>
        ${contributions.map((c) => `<div class="contrib">${c.dates.map(escapeHtml).join(", ")} · ${escapeHtml(c.code)}${c.provider ? " · " + escapeHtml(c.provider) : ""}${c.count > 1 ? ` · ×${c.count}` : ""}${c.approximate ? " · ~approximate" : ""}</div>`).join("") || '<div class="contrib">None yet in this plan year.</div>'}
      </details>`;
    card.querySelector(".usage-del").onclick = async () => {
      if (await confirmAction({
        title: "Stop tracking this limit?",
        body: `"${t.label}" is removed from Your coverage. Audits already run are unaffected.`,
        confirmLabel: "Stop tracking", danger: true,
      })) {
        await deleteDoc(doc(db, `users/${auth.currentUser.uid}/trackers/${t.id}`));
        loadTrackers().then(renderUsage);
      }
    };
    if (t.source === "sbc" && !t.confirmed) {
      card.querySelector("details").addEventListener("toggle", () => {
        t.confirmed = true;
        updateDoc(doc(db, `users/${auth.currentUser.uid}/trackers/${t.id}`), { confirmed: true });
      }, { once: true });
    }
    list.appendChild(card);
  }
  if (!allTrackers.length) {
    list.innerHTML = '<p class="muted">Nothing tracked yet — add a limit below.</p>';
  }

  // Deductible card — the SBC owns the limit, the EOB owns progress (see plan.js deductibleTarget).
  const dw = planYearWindow(allTrackers[0]?.planYearStartMonth || 1, todayISO());
  const { snapshot, asOf, summedApplied, disagreement } = latestAccumulators(allAudits, dw);
  const target = deductibleTarget(activePlan?.structured ?? null, snapshot);
  const dc = $("deductible-card");
  if (typeof snapshot?.deductibleToDate === "number" || target.limit !== null) {
    const applied = typeof snapshot?.deductibleToDate === "number" ? snapshot.deductibleToDate : (summedApplied ?? 0);
    const lim = target.limit !== null ? ` of ${fmt(target.limit)}` : "";
    let sourcing;
    if (target.source === "sbc" && snapshot) {
      sourcing = `Target from your plan (SBC). As stated on your most recent EOB (${escapeHtml(asOf)}).`;
    } else if (target.source === "sbc") {
      sourcing = "Target from your plan (SBC).";
    } else {
      sourcing = `As stated on your most recent EOB (${escapeHtml(asOf)}).`;
    }
    dc.innerHTML = `<div class="usage-card">
      <div class="usage-head"><b>Deductible</b><span class="usage-count">${fmt(applied)}${lim}</span></div>
      ${target.limit !== null ? `<div class="progress"><div class="bar" style="width:${Math.min(100, (applied / target.limit) * 100)}%"></div></div>` : ""}
      <div class="muted">${sourcing}${disagreement ? ` Note: your EOBs' per-claim amounts sum to ${fmt(summedApplied)} — the insurer's running total disagrees; worth a look.` : ""}${target.conflict ? ` Note: your EOB states a different annual deductible (${fmt(snapshot.deductibleLimit)}) than your SBC (${fmt(target.limit)}) — worth a look.` : ""}
        ${target.limit !== null && applied < target.limit ? `<span style="float:right">${fmt(target.limit - applied)} to go</span>` : ""}</div>
    </div>`;
  } else {
    dc.innerHTML = "";
  }

  // Out-of-pocket max — extracted since the SBC feature landed, never shown
  // until now. Same precedence as the deductible; a slim row, not a full card.
  const oop = oopTarget(activePlan?.structured ?? null, snapshot);
  const oc = $("oop-card");
  const oopPaid = typeof snapshot?.oopToDate === "number" ? snapshot.oopToDate : null;
  if (oop.limit !== null || oopPaid !== null) {
    const pct = oop.limit ? Math.min(100, Math.round(((oopPaid ?? 0) / oop.limit) * 100)) : null;
    oc.innerHTML = `<div class="usage-card">
      <div class="usage-head"><b>Out-of-pocket maximum</b>
        <span class="usage-count">${fmt(oopPaid ?? 0)}${oop.limit !== null ? ` of ${fmt(oop.limit)}` : ""}${pct !== null ? ` · ${pct}%` : ""}</span></div>
      ${oop.limit !== null ? `<div class="progress"><div class="bar" style="width:${pct}%"></div></div>` : ""}
      ${oop.conflict ? `<div class="muted">Note: your EOB states a different out-of-pocket limit (${fmt(snapshot.oopLimit)}) than your SBC (${fmt(oop.limit)}) — worth a look.</div>` : ""}
    </div>`;
  } else {
    oc.innerHTML = "";
  }

  // Suggestion banner
  const suggestions = suggestedTrackers(allAudits, allTrackers);
  const sb = $("suggestion-banner");
  if (suggestions.length) {
    const s = suggestions[0];
    sb.hidden = false;
    sb.innerHTML = `💡 Your insurer mentioned a benefit limit for <b>${escapeHtml(s.code)}${s.description ? " — " + escapeHtml(s.description) : ""}</b>
      (“${escapeHtml(s.remark.slice(0, 120))}${s.remark.length > 120 ? "…" : ""}”). <button id="suggest-track" class="btn sm" style="margin-left:8px">Track it</button>`;
    $("suggest-track").onclick = async () => {
      // Zero-entry tracking: when the remark printed the limit, one click
      // creates the tracker — no form. Fallback: the prefilled form.
      if (Number.isFinite(s.limit) && s.limit > 0) {
        await addDoc(collection(db, `users/${auth.currentUser.uid}/trackers`), {
          label: s.description || `Code ${s.code}`,
          codes: [s.code],
          limit: s.limit,
          planYearStartMonth: planYearStartMonthFrom(activePlan?.structured?.planYearStart),
          source: "remark",
          createdAt: serverTimestamp(),
        });
        await loadTrackers();
        renderUsage();
        track("tracker_created");
        return;
      }
      $("tracker-form-wrap").open = true;
      $("tf-preset").value = "custom";
      $("tf-codes").value = s.code;
      $("tf-limit").focus();
      $("tracker-form-wrap").scrollIntoView({ behavior: "smooth" });
    };
  } else {
    sb.hidden = true;
    sb.innerHTML = "";
  }
}

const PRESETS = {
  psych: { label: "Psychotherapy", codes: "90832, 90834, 90837" },
  pt: { label: "Physical therapy", codes: "97110, 97112, 97530" },
  chiro: { label: "Chiropractic", codes: "98940, 98941, 98942" },
  acu: { label: "Acupuncture", codes: "97810, 97811, 97813, 97814" },
  custom: { label: "", codes: "" },
};

$("tf-preset").onchange = () => {
  const p = PRESETS[$("tf-preset").value];
  if (p.codes) $("tf-codes").value = p.codes;
};
$("tf-codes").value = PRESETS.psych.codes;

$("tracker-form").onsubmit = async (e) => {
  e.preventDefault();
  const preset = PRESETS[$("tf-preset").value];
  const codes = $("tf-codes").value.split(/[,\s]+/).map((c) => c.trim()).filter(Boolean);
  const limit = parseInt($("tf-limit").value, 10);
  if (!codes.length || !Number.isFinite(limit) || limit < 1) return;
  const label = preset.label || `Codes ${codes.join(", ")}`;
  await addDoc(collection(db, `users/${auth.currentUser.uid}/trackers`), {
    label, codes, limit,
    planYearStartMonth: parseInt($("tf-month").value, 10) || 1,
    createdAt: serverTimestamp(),
  });
  $("tf-limit").value = "";
  $("tracker-form-wrap").open = false;
  await loadTrackers();
  renderUsage();
  track("tracker_created");
};

// Report integration: "visit N of L" line for the audit being viewed.
function renderReportUsage(data) {
  const el = $("report-usage");
  el.innerHTML = "";
  if (!allTrackers.length || !data?.occurrenceTable) return;
  const norm = (c) => String(c).trim().toUpperCase(); // match visitsUsed's normalization
  const codes = new Set(data.occurrenceTable.map((r) => norm(r.code)));
  const html = [];
  for (const t of allTrackers) {
    if (!(t.codes || []).some((c) => codes.has(norm(c)))) continue;
    const { count, level } = trackerStatus(t);
    html.push(`<div class="usage-card ${level}" style="margin:12px 0">
      <div class="usage-head"><b>${escapeHtml(t.label)}: visit ${count} of ${t.limit} this plan year</b></div>
      ${LEVEL_NOTES[level] ? `<div class="usage-note">${LEVEL_NOTES[level]}</div>` : ""}</div>`);
    if (level !== "ok") track("tracker_warning_shown");
  }
  el.innerHTML = html.join("");
}

resetState();
