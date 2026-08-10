import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, query, orderBy, getDocs, doc, getDoc, deleteDoc, addDoc,
  updateDoc, serverTimestamp, connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  planYearWindow, visitsUsed, latestAccumulators, suggestedTrackers, warningLevel,
} from "./usage.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js";
import { firebaseConfig } from "./firebase-config.js";
import { extractText } from "./extract.js";
import { loadNer, deidentify, createRegistry, manualRedact } from "./deid.js";
import { pairFiles, classifyFile, uniqueDocs } from "./batch.js";
import { planYearStartMonthFrom, mergeSbcTrackers, deductibleTarget } from "./plan.js";

const $ = (id) => document.getElementById(id);
const show = (id) => {
  for (const s of document.querySelectorAll("main > section")) s.hidden = s.id !== id;
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
let analytics = null;
try { analytics = getAnalytics(app); } catch { /* blocked or unsupported — fine */ }
const track = (name) => { try { analytics && logEvent(analytics, name); } catch {} };

const OCR_CONFIDENCE_THRESHOLD = 75;

// ---------- Auth ----------

$("google-signin").onclick = () =>
  signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => setError("signin-error", e.message));

$("email-signin").onclick = async () => {
  const email = $("email-input").value.trim();
  if (!email) return;
  try {
    await sendSignInLinkToEmail(auth, email, { url: location.href, handleCodeInApp: true });
    localStorage.setItem("emailForSignIn", email);
    $("email-sent").hidden = false;
  } catch (e) {
    setError("signin-error", e.message);
  }
};

if (isSignInWithEmailLink(auth, location.href)) {
  const email = localStorage.getItem("emailForSignIn") || prompt("Confirm your email to finish signing in:");
  signInWithEmailLink(auth, email, location.href)
    .then(() => history.replaceState(null, "", location.pathname))
    .catch((e) => setError("signin-error", e.message));
}

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
  if (!confirm("Erase ALL your data — audits, saved EOBs, trackers, and your plan? This cannot be undone. (Today's usage counters stay.)")) return;
  const uid = auth.currentUser.uid;
  try {
    for (const coll of ["audits", "eobs", "trackers"]) {
      const snap = await getDocs(collection(db, `users/${uid}/${coll}`));
      for (const d of snap.docs) await deleteDoc(d.ref);
    }
    await deleteDoc(doc(db, `users/${uid}/plan/active`));
    location.reload();
  } catch (e) {
    console.error(e);
    setError("upload-error", `Reset failed partway: ${e.message} — reload and try again.`);
  }
};

onAuthStateChanged(auth, async (user) => {
  document.body.classList.toggle("authed", !!user);
  if (user) {
    $("user-email").textContent = user.email || "";
    loadHistory();
    await loadPlan();
    // First-run gate: no plan on file and never skipped → one-time setup screen.
    if (!activePlan && localStorage.getItem("ucr-skip-onboarding") !== user.uid) {
      openOnboarding("signin");
    } else {
      show("upload");
    }
  } else {
    show("signin");
  }
});

function openOnboarding(origin) {
  $("skip-onboarding").textContent = origin === "upload"
    ? "Not now — back to your audits"
    : "Skip for now — audit a bill first";
  setError("onboarding-error", "");
  show("onboarding");
}

$("skip-onboarding").onclick = (e) => {
  e.preventDefault();
  if (auth.currentUser) localStorage.setItem("ucr-skip-onboarding", auth.currentUser.uid);
  show("upload");
};

function setError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.hidden = !msg;
}

// ---------- Pipeline state ----------

// Originals live ONLY in this object and are wiped after the user confirms
// the review screen. They are never transmitted.
let state = null;

function resetState() {
  state = {
    registry: createRegistry(),
    bill: null, // {originalText, redacted, method, confidence}
    eob: null,
    activeDoc: "bill",
  };
  $("bill-file").value = "";
  $("eob-file").value = "";
  $("eob-picked").textContent = "";
  $("saved-eob").value = "";
  setError("upload-error", "");
  defaultEobSelection();
  batchFiles = [];
  batchQueue = null;
  batchIndex = 0;
  batchDocs = null;
  batchDocIndex = 0;
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
    renderFiles();
  }
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

function renderFiles() {
  const { pairs, billOnly, orphanEobs } = pairFiles(batchFiles);
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
      `<b>${audits} audit${audits === 1 ? "" : "s"}</b>: ${pairs.length} bill+EOB pair${pairs.length === 1 ? "" : "s"}${billOnly.length ? `, ${billOnly.length} bill-only (no matching EOB)` : ""}.`,
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
  const skipEob = $("no-eob").checked;
  const savedEob = !skipEob && $("saved-eob").value
    ? savedEobs.find((e) => e.id === $("saved-eob").value)
    : null;
  const audits = pairs.length + billOnly.length;
  if (!audits) {
    return setError("upload-error", "The itemized bill is required.");
  }
  if (audits === 1) {
    const billFile = (pairs[0]?.bill ?? billOnly[0]).file;
    const eobFile = pairs[0]?.eob.file ?? null;
    if (!eobFile && !savedEob && !skipEob) {
      return setError("upload-error", "Add your EOB (step 1), pick a saved one, or check “I don't have an EOB”.");
    }
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

// eobFile: freshly uploaded File; savedEob: library entry (already redacted).
// At most one is non-null; both null means bill-only.
async function prepareAudit(billFile, eobFile, savedEob = null) {
  setBatchLabels(null);
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

    setStatus("Loading the privacy model (first run downloads ~90MB, cached after)…");
    const ner = await loadNer((p) => {
      if (p.status === "progress" && p.total) {
        setStatus(`Downloading privacy model… ${Math.round((p.loaded / p.total) * 100)}%`);
      }
    });

    setStatus("Hiding your personal information — on your device…");
    state.bill = { originalText: bill.text, previews: bill.previews, method: bill.method, confidence: bill.confidence };
    state.bill.redacted = (await deidentify(bill.text, ner, state.registry)).redacted;
    if (savedEob) {
      // Library EOB: already redacted in a previous session; original never stored.
      state.eob = { originalText: null, previews: null, saved: true, confidence: 100, redacted: savedEob.redactedText };
    } else if (eob) {
      state.eob = { originalText: eob.text, previews: eob.previews, method: eob.method, confidence: eob.confidence };
      state.eob.redacted = (await deidentify(eob.text, ner, state.registry)).redacted;
    } else {
      state.eob = null;
    }

    $("ocr-banner").hidden = !(bill.method === "ocr" || state.eob?.method === "ocr");
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

function resetStatePreservingFiles() {
  state = { registry: createRegistry(), bill: null, eob: null, activeDoc: "bill" };
}

// Review-all batch flow: every unique document is extracted and redacted up
// front (one shared registry, so placeholders match across documents), the
// user reviews them all once, then the audits run without pausing.
async function prepareBatch() {
  resetStatePreservingFiles();
  batchDocs = null;
  $("tab-bill").textContent = "Bill";
  show("processing");
  try {
    const docs = uniqueDocs(batchQueue);
    for (const d of docs) {
      if (d.file && d.file.size > 20e6) throw new Error(`${d.file.name} is over 20MB`);
    }
    setStatus("Loading the privacy model (first run downloads ~90MB, cached after)…");
    const ner = await loadNer((p) => {
      if (p.status === "progress" && p.total) {
        setStatus(`Downloading privacy model… ${Math.round((p.loaded / p.total) * 100)}%`);
      }
    });
    const prepared = [];
    for (const [i, d] of docs.entries()) {
      if (d.savedEob) {
        prepared.push({ name: `saved: ${d.savedEob.label}`, kind: "eob", saved: true,
          savedEob: d.savedEob, confidence: 100, redacted: d.savedEob.redactedText });
        continue;
      }
      setStatus(`Hiding personal info in ${d.file.name} (${i + 1} of ${docs.length}) — on your device…`);
      const ex = await extractText(d.file);
      const redacted = (await deidentify(ex.text, ner, state.registry)).redacted;
      prepared.push({ file: d.file, name: d.file.name, kind: d.kind, originalText: ex.text,
        previews: ex.previews, method: ex.method, confidence: ex.confidence, redacted });
    }
    batchDocs = prepared;
    batchDocIndex = 0;
    $("ocr-banner").hidden = !batchDocs.some((d) => d.method === "ocr");
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

// The uninterrupted run after the combined review: originals are destroyed
// first, then each audit is sent in turn. On failure the unprocessed
// remainder (including the failed item) goes back to the pairing panel.
async function runBatch() {
  for (const d of batchDocs) { d.originalText = null; d.previews = null; }
  $("original-pane").textContent = "";
  const byFile = new Map(batchDocs.filter((d) => d.file).map((d) => [d.file, d]));
  const bySaved = new Map(batchDocs.filter((d) => d.savedEob).map((d) => [d.savedEob.id, d]));
  const total = batchQueue.length;
  show("processing");
  let last = null;
  try {
    for (; batchIndex < batchQueue.length; batchIndex++) {
      const it = batchQueue[batchIndex];
      const billDoc = byFile.get(it.bill);
      const eobDoc = it.eob ? byFile.get(it.eob) : it.savedEob ? bySaved.get(it.savedEob.id) : null;
      setStatus(`Analyzing audit ${batchIndex + 1} of ${total} — ${it.bill.name}…`);
      const payload = {
        redactedBill: billDoc.redacted,
        redactedEob: eobDoc ? eobDoc.redacted : "",
        ocrConfidence: Math.min(billDoc.confidence, eobDoc ? eobDoc.confidence : 100),
      };
      const { data } = await analyzeFn(payload);
      last = { data, ocrLow: payload.ocrConfidence < OCR_CONFIDENCE_THRESHOLD };
      if (eobDoc && !eobDoc.saved && $("save-eob").checked) {
        await maybeSaveEob(eobDoc.redacted, data);
        eobDoc.saved = true; // shared EOB: save once, not once per audit
      }
      track("audit_completed");
    }
    batchQueue = null;
    batchDocs = null;
    setBatchLabels(`Batch complete — all ${total} audits are saved under “Your past audits”.`);
    renderReport(last.data, { ocrLow: last.ocrLow, model: last.data.model, planApplied: last.data.planApplied, planReason: last.data.planReason });
    show("report");
    track("batch_completed");
    await loadHistory(); // refreshes allAudits (incl. these audits) + usage cards
    renderReportUsage(last.data);
  } catch (e) {
    console.error(e);
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
  // Original pane: show the ACTUAL document (rendered pages) when we have it —
  // far easier to read than extracted text. Falls back to text for HTML/txt.
  const orig = $("original-pane");
  if (docState.saved) {
    orig.textContent = "This is a saved EOB — it was redacted when you first uploaded it, and the original was never stored. Review the redacted version on the right.";
  } else if (docState.previews?.length) {
    orig.textContent = "";
    for (const src of docState.previews) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "Your document (local preview)";
      orig.appendChild(img);
    }
  } else {
    orig.textContent = tidy(docState.originalText);
  }
  // Redacted pane: placeholders rendered as visible chips for human scanning.
  $("redacted-pane").innerHTML = escapeHtml(tidy(docState.redacted))
    .replace(/\[([A-Z][A-Z0-9_]*_\d+)\]/g, '<span class="chip">$1</span>');
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

$("redact-selection").onclick = () => {
  const sel = window.getSelection().toString();
  if (!sel.trim()) return;
  if (batchDocs) {
    // Apply everywhere so shared strings stay consistent across the batch.
    for (const d of batchDocs) d.redacted = manualRedact(d.redacted, sel, state.registry);
    renderReview();
    return;
  }
  const docState = state[state.activeDoc];
  docState.redacted = manualRedact(docState.redacted, sel, state.registry);
  // Also apply to the other document so shared strings stay consistent.
  const other = state.activeDoc === "bill" ? state.eob : state.bill;
  if (other) other.redacted = manualRedact(other.redacted, sel, state.registry);
  renderReview();
};

$("confirm-review").onclick = async () => {
  if (state.sbcFlow) return runSbcExtraction();
  if (batchDocs) return runBatch();
  const payload = {
    redactedBill: state.bill.redacted,
    redactedEob: state.eob ? state.eob.redacted : "",
    ocrConfidence: Math.min(state.bill.confidence, state.eob ? state.eob.confidence : 100),
  };
  const ocrLow = payload.ocrConfidence < OCR_CONFIDENCE_THRESHOLD;

  // Discard originals — this is the moment they cease to exist.
  state.bill.originalText = null;
  state.bill.previews = null;
  if (state.eob) { state.eob.originalText = null; state.eob.previews = null; }
  $("original-pane").textContent = "";
  $("bill-file").value = "";
  $("eob-file").value = "";

  show("processing");
  setStatus("Analyzing your bill against the EOB…");
  try {
    const { data } = await analyzeFn(payload);
    renderReport(data, { ocrLow, model: data.model, planApplied: data.planApplied, planReason: data.planReason });
    show("report");
    track("audit_completed");
    if (state.eob && !state.eob.saved && $("save-eob").checked) {
      await maybeSaveEob(state.eob.redacted, data);
    }
    await loadHistory(); // refreshes allAudits (incl. this audit) + usage cards
    renderReportUsage(data);
  } catch (e) {
    console.error(e);
    setError("upload-error",
      e.code === "functions/resource-exhausted" ? e.message : "Analysis failed — please try again.");
    show("upload");
    batchBackToPanel();
  }
};

$("back-to-upload").onclick = () => { resetState(); show("upload"); };

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

const PLAN_TYPES = new Set(["copay_mismatch", "coinsurance_mismatch", "deductible_misapplied", "not_covered_per_plan"]);

function renderReport(data, { ocrLow, model, planApplied, planReason } = {}) {
  const { findings = [], totals = {}, occurrenceTable = [] } = data;
  lastReport = { findings, totals, occurrenceTable };
  $("email-card").hidden = true;

  $("report-caveat").hidden = !ocrLow;

  $("report-totals").innerHTML = `
    <div class="tot"><span>Billed</span><b>${fmt(totals.billed)}</b></div>
    <div class="tot"><span>EOB allowed</span><b>${fmt(totals.eobAllowed)}</b></div>
    <div class="tot"><span>Your responsibility</span><b>${fmt(totals.patientResponsibility)}</b></div>
    <div class="tot hi"><span>Worth disputing — money you may not owe; hold off paying this part</span><b>${fmt(totals.totalAtStake)}</b></div>`;

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
      ? `Not checked against your plan — add your Summary of Benefits at the top of the audit page to enable plan checks.`
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

const INSURER_ONLY_TYPES = new Set(["cost_share_error"]);

function buildDisputeEmail({ findings, totals }) {
  const insurerOnly = findings.length > 0 && findings.every((f) => INSURER_ONLY_TYPES.has(f.type));
  const to = insurerOnly
    ? "[YOUR INSURANCE COMPANY] Member Services"
    : "[PROVIDER NAME] Billing Department";
  const lines = [];
  lines.push(`To: ${to}`);
  lines.push(`From: [YOUR NAME]`);
  lines.push(`Re: Billing review request — Account [YOUR ACCOUNT NUMBER], date of service [DATE OF SERVICE]`);
  lines.push("");
  lines.push("To whom it may concern,");
  lines.push("");
  lines.push(
    "I have reviewed my itemized bill against the Explanation of Benefits (EOB) issued by my insurance " +
    "plan for this claim, and I identified the following discrepancies. I am requesting a written, " +
    "line-by-line review and a corrected statement before making further payment."
  );
  findings.forEach((f, i) => {
    lines.push("");
    lines.push(`${i + 1}. ${TYPE_LABELS[f.type] || f.type} — amount in question: ${fmt(f.amountAtStake)}`);
    lines.push(`   ${f.description}`);
    if (f.evidence?.billQuote) lines.push(`   Bill states: "${f.evidence.billQuote}"`);
    if (f.evidence?.eobQuote) lines.push(`   EOB states: "${f.evidence.eobQuote}"`);
    if (f.evidence?.sbcQuote) lines.push(`   My plan (SBC) states: "${f.evidence.sbcQuote}"`);
  });
  lines.push("");
  if (findings.some((f) => f.type === "billed_vs_allowed_mismatch")) {
    lines.push(
      `Per the EOB, my total member responsibility for this claim is ${fmt(totals.patientResponsibility)}. ` +
      "Amounts above the plan's allowed amount are contractual write-offs under your network agreement and " +
      "may not be billed to me. Please adjust the balance accordingly."
    );
    lines.push("");
  }
  lines.push("Please:");
  lines.push("  1. Provide a written response and an itemized, corrected statement within 30 days;");
  lines.push("  2. Place any disputed balance on hold and refrain from collections activity while this review is pending.");
  lines.push("");
  lines.push("Thank you,");
  lines.push("[YOUR NAME]");
  lines.push("[YOUR PHONE] · [YOUR EMAIL]");
  lines.push("");
  lines.push("— Prepared with the help of UseClaimRight (self-help tool; not legal advice).");
  return lines.join("\n");
}

$("gen-email").onclick = () => {
  if (!lastReport) return;
  if (!lastReport.findings.length) {
    $("email-text").value =
      "Good news — this audit found no discrepancies between the bill and the EOB, so there's nothing to dispute.";
  } else {
    $("email-text").value = buildDisputeEmail(lastReport);
  }
  $("email-card").hidden = false;
  $("email-card").scrollIntoView({ behavior: "smooth" });
  track("dispute_email_generated");
};

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

async function loadHistory() {
  const user = auth.currentUser;
  if (!user) return;
  // Audits, trackers, and the EOB library are independent — fetch in parallel.
  const [snap] = await Promise.all([
    getDocs(query(collection(db, `users/${user.uid}/audits`), orderBy("createdAt", "desc"))),
    loadTrackers(),
    loadEobs(),
  ]);
  $("history-list").innerHTML = snap.empty
    ? '<p class="muted">No audits yet — run your first above.</p>'
    : "";
  allAudits = [];
  snap.forEach((d) => {
    const a = d.data();
    const created = a.createdAt?.toDate?.();
    allAudits.push({
      id: d.id,
      serviceDates: a.serviceDates || [],
      occurrenceTable: a.occurrenceTable || [],
      accumulators: a.accumulators || null,
      payerRemarks: a.payerRemarks || [],
      provider: a.provider || "",
      createdAtDate: created ? isoDate(created) : "",
    });
    const el = document.createElement("div");
    el.className = "history-item";
    const when = (a.serviceDates && a.serviceDates[0]) ||
      (created ? created.toLocaleDateString() : "");
    const prov = a.provider ? ` · ${escapeHtml(a.provider)}` : "";
    el.innerHTML = `
      <button class="open">${escapeHtml(when)}${prov} · ${a.findings?.length ?? 0} findings · ${fmt(a.totals?.totalAtStake)}</button>
      <button class="del" title="Delete this audit">✕</button>`;
    el.querySelector(".open").onclick = async () => {
      const full = await getDoc(doc(db, `users/${user.uid}/audits/${d.id}`));
      renderReport(full.data(), { ocrLow: (full.data().ocrConfidence ?? 100) < OCR_CONFIDENCE_THRESHOLD, planApplied: full.data().planApplied, planReason: full.data().planReason });
      renderReportUsage(full.data());
      show("report");
    };
    el.querySelector(".del").onclick = async () => {
      if (confirm("Delete this audit permanently?")) {
        await deleteDoc(doc(db, `users/${user.uid}/audits/${d.id}`));
        loadHistory();
      }
    };
    $("history-list").appendChild(el);
  });
  renderUsage();
}

async function loadTrackers() {
  const user = auth.currentUser;
  if (!user) return;
  const snap = await getDocs(collection(db, `users/${user.uid}/trackers`));
  allTrackers = [];
  snap.forEach((d) => allTrackers.push({ id: d.id, ...d.data() }));
}

// ---------- Saved EOBs (redacted-only library for reuse across bills) ----------

let savedEobs = []; // {id, label, redactedText}

async function loadEobs() {
  const user = auth.currentUser;
  if (!user) return;
  const snap = await getDocs(
    query(collection(db, `users/${user.uid}/eobs`), orderBy("createdAt", "desc"))
  );
  savedEobs = [];
  snap.forEach((d) => savedEobs.push({ id: d.id, ...d.data() }));

  $("saved-eob-wrap").hidden = !savedEobs.length;
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
      if (confirm(`Delete saved EOB “${e.label}”?`)) {
        await deleteDoc(doc(db, `users/${auth.currentUser.uid}/eobs/${e.id}`));
        loadEobs();
      }
    };
    list.appendChild(row);
  }
}

// With a library on file, the EOB step answers itself: pre-select the most
// recent saved EOB so a new bill can be audited with zero extra clicks.
function defaultEobSelection() {
  if (!savedEobs.length || $("saved-eob").value || batchFiles.some((b) => b.role === "eob") || $("no-eob").checked) return;
  $("saved-eob").value = savedEobs[0].id;
  $("eob-picked").textContent = `✓ using saved: ${savedEobs[0].label} — change below if this isn't the right one`;
}

$("saved-eob").onchange = () => {
  if ($("saved-eob").value) {
    $("eob-picked").textContent = `✓ saved: ${$("saved-eob").selectedOptions[0].textContent}`;
    $("no-eob").checked = false;
    $("no-eob").dispatchEvent(new Event("change"));
  } else {
    $("eob-picked").textContent = "";
  }
};

async function maybeSaveEob(redactedText, data) {
  if (savedEobs.some((e) => e.redactedText === redactedText)) return; // already saved
  const label = `${data.provider || "EOB"} · ${(data.serviceDates || [])[0] || todayISO()}`;
  await addDoc(collection(db, `users/${auth.currentUser.uid}/eobs`), {
    label, redactedText, createdAt: serverTimestamp(),
  });
  // No refresh here: the loadHistory() that follows every audit reloads the library.
  track("eob_saved");
}

// ---------- Your plan (SBC) ----------

let activePlan = null; // {structured, digest, redactedText, sourceName, createdAt}

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
    $("plan-add-now").onclick = (e) => { e.preventDefault(); openOnboarding("upload"); };
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
      full.querySelector("pre").textContent = activePlan.redactedText || "No stored text.";
      full.hidden = !full.hidden;
    };
    $("plan-remove").onclick = async (e) => {
      e.preventDefault();
      if (!confirm(`Remove your plan (${s.planName || "SBC"})? Audits will no longer be checked against it. Trackers you've created stay.`)) return;
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

const sbcErrTarget = () => (state?.sbcOrigin === "onboarding" ? "onboarding-error" : "upload-error");

async function prepareSbc(file) {
  const origin = !$("onboarding").hidden ? "onboarding" : "upload";
  if (file.size > 20e6) {
    return setError(origin === "onboarding" ? "onboarding-error" : "upload-error", "Files must be under 20MB.");
  }
  resetStatePreservingFiles();
  state.sbcFlow = true;
  state.sbcOrigin = origin;
  $("tab-bill").textContent = "Plan (SBC)";
  show("processing");
  try {
    setStatus("Reading your Summary of Benefits…");
    const ex = await extractText(file);
    // Free duplicate check happens after redaction (compare redacted text).
    setStatus("Loading the privacy model (first run downloads ~90MB, cached after)…");
    const ner = await loadNer((p) => {
      if (p.status === "progress" && p.total) setStatus(`Downloading privacy model… ${Math.round((p.loaded / p.total) * 100)}%`);
    });
    setStatus("Hiding your personal information — on your device…");
    state.bill = { originalText: ex.text, previews: ex.previews, method: ex.method, confidence: ex.confidence };
    state.bill.redacted = (await deidentify(ex.text, ner, state.registry)).redacted;
    state.sbcName = file.name;
    if (activePlan && activePlan.redactedText === state.bill.redacted) {
      show(state.sbcOrigin);
      return setError(sbcErrTarget(), "This plan is already on file.");
    }
    $("ocr-banner").hidden = ex.method !== "ocr";
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
  const redactedSbc = state.bill.redacted;
  const sourceName = state.sbcName || "";
  state.bill.originalText = null; state.bill.previews = null;
  $("original-pane").textContent = "";
  show("processing");
  setStatus("Reading your plan's terms…");
  try {
    const { data } = await extractPlanFn({ redactedSbc, sourceName, force });
    if (data.status === "confirm_older") {
      const msg = `The plan on file covers ${data.existingPeriod.start} → ${data.existingPeriod.end}; ` +
        `this document covers ${data.incomingPeriod.start} → ${data.incomingPeriod.end}. Replace anyway?`;
      if (confirm(msg)) return runSbcExtraction(true);
      show("upload"); setBatchLabels(null); return;
    }
    await loadPlan();
    await applySbcConfiguration();
    setBatchLabels(null);
    show("upload");
    track("plan_added");
    $("plan-card").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    console.error(e);
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
      if (confirm(`Stop tracking "${t.label}"?`)) {
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
      <div class="muted">${sourcing}${disagreement ? ` Note: your EOBs' per-claim amounts sum to ${fmt(summedApplied)} — the insurer's running total disagrees; worth a look.` : ""}${target.conflict ? ` Note: your EOB states a different annual deductible (${fmt(snapshot.deductibleLimit)}) than your SBC (${fmt(target.limit)}) — worth a look.` : ""}</div>
    </div>`;
  } else {
    dc.innerHTML = "";
  }

  // Suggestion banner
  const suggestions = suggestedTrackers(allAudits, allTrackers);
  const sb = $("suggestion-banner");
  if (suggestions.length) {
    const s = suggestions[0];
    sb.hidden = false;
    sb.innerHTML = `💡 Your insurer mentioned a benefit limit for <b>${escapeHtml(s.code)}${s.description ? " — " + escapeHtml(s.description) : ""}</b>
      (“${escapeHtml(s.remark.slice(0, 120))}${s.remark.length > 120 ? "…" : ""}”). <button id="suggest-track" class="btn sm" style="margin-left:8px">Track it</button>`;
    $("suggest-track").onclick = () => {
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
