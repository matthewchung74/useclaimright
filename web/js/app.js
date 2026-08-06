import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, query, orderBy, getDocs, doc, getDoc, deleteDoc,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js";
import { firebaseConfig } from "./firebase-config.js";
import { extractText } from "./extract.js";
import { loadNer, deidentify, createRegistry, manualRedact } from "./deid.js";

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

$("signout").onclick = () => signOut(auth);

onAuthStateChanged(auth, (user) => {
  document.body.classList.toggle("authed", !!user);
  if (user) {
    $("user-email").textContent = user.email || "";
    show("upload");
    loadHistory();
  } else {
    show("signin");
  }
});

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
  $("bill-picked").textContent = "";
  $("eob-picked").textContent = "";
  setError("upload-error", "");
}

// Dropzone feedback: show the picked filename; style on drag.
for (const kind of ["bill", "eob"]) {
  const input = $(`${kind}-file`);
  const zone = $(`dz-${kind}`);
  input.onchange = () => {
    $(`${kind}-picked`).textContent = input.files[0] ? `✓ ${input.files[0].name}` : "";
  };
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); zone.classList.remove("drag");
    if (e.dataTransfer.files[0]) {
      input.files = e.dataTransfer.files;
      input.dispatchEvent(new Event("change"));
    }
  });
}

// ---------- Upload & processing ----------

$("run-audit").onclick = async () => {
  const billFile = $("bill-file").files[0];
  const eobFile = $("eob-file").files[0];
  if (!billFile || !eobFile) {
    return setError("upload-error", "Both the itemized bill and the EOB are required.");
  }
  if (billFile.size > 20e6 || eobFile.size > 20e6) {
    return setError("upload-error", "Files must be under 20MB.");
  }

  resetStatePreservingFiles();
  show("processing");

  try {
    setStatus("Reading your documents…");
    const [bill, eob] = [await extractText(billFile), await extractText(eobFile)];

    const ocrUsed = bill.method === "ocr" || eob.method === "ocr";
    $("ocr-banner").hidden = !ocrUsed;

    setStatus("Loading the de-identification model (first run downloads ~90MB, cached after)…");
    const ner = await loadNer((p) => {
      if (p.status === "progress" && p.total) {
        setStatus(`Downloading de-identification model… ${Math.round((p.loaded / p.total) * 100)}%`);
      }
    });

    setStatus("Removing personal information on your device…");
    state.bill = { originalText: bill.text, method: bill.method, confidence: bill.confidence };
    state.eob = { originalText: eob.text, method: eob.method, confidence: eob.confidence };
    state.bill.redacted = (await deidentify(bill.text, ner, state.registry)).redacted;
    state.eob.redacted = (await deidentify(eob.text, ner, state.registry)).redacted;

    renderReview();
    show("review");
    track("audit_prepared");
  } catch (e) {
    console.error(e);
    setError("upload-error", `Could not process the documents: ${e.message}`);
    show("upload");
  }
};

function resetStatePreservingFiles() {
  state = { registry: createRegistry(), bill: null, eob: null, activeDoc: "bill" };
}

function setStatus(msg) {
  $("processing-status").textContent = msg;
}

// ---------- Review (double-check) ----------

const tidy = (s) => (s ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

function renderReview() {
  const docState = state[state.activeDoc];
  $("original-pane").textContent = tidy(docState.originalText);
  // Redacted pane: placeholders rendered as visible chips for human scanning.
  $("redacted-pane").innerHTML = escapeHtml(tidy(docState.redacted))
    .replace(/\[([A-Z][A-Z0-9_]*_\d+)\]/g, '<span class="chip">$1</span>');
  $("tab-bill").classList.toggle("active", state.activeDoc === "bill");
  $("tab-eob").classList.toggle("active", state.activeDoc === "eob");
}

$("tab-bill").onclick = () => { state.activeDoc = "bill"; renderReview(); };
$("tab-eob").onclick = () => { state.activeDoc = "eob"; renderReview(); };

$("redact-selection").onclick = () => {
  const sel = window.getSelection().toString();
  if (!sel.trim()) return;
  const docState = state[state.activeDoc];
  docState.redacted = manualRedact(docState.redacted, sel, state.registry);
  // Also apply to the other document so shared strings stay consistent.
  const other = state.activeDoc === "bill" ? state.eob : state.bill;
  other.redacted = manualRedact(other.redacted, sel, state.registry);
  renderReview();
};

$("confirm-review").onclick = async () => {
  const payload = {
    redactedBill: state.bill.redacted,
    redactedEob: state.eob.redacted,
    ocrConfidence: Math.min(state.bill.confidence, state.eob.confidence),
  };
  const ocrLow = payload.ocrConfidence < OCR_CONFIDENCE_THRESHOLD;

  // Discard originals — this is the moment they cease to exist.
  state.bill.originalText = null;
  state.eob.originalText = null;
  $("original-pane").textContent = "";
  $("bill-file").value = "";
  $("eob-file").value = "";

  show("processing");
  setStatus("Analyzing your bill against the EOB…");
  try {
    const { data } = await analyzeFn(payload);
    renderReport(data, { ocrLow, model: data.model });
    show("report");
    track("audit_completed");
    loadHistory();
  } catch (e) {
    console.error(e);
    setError("upload-error",
      e.code === "functions/resource-exhausted" ? e.message : "Analysis failed — please try again.");
    show("upload");
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
};

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—");

let lastReport = null;

function renderReport(data, { ocrLow } = {}) {
  const { findings = [], totals = {}, occurrenceTable = [] } = data;
  lastReport = { findings, totals, occurrenceTable };
  $("email-card").hidden = true;

  $("report-caveat").hidden = !ocrLow;

  $("report-totals").innerHTML = `
    <div class="tot"><span>Billed</span><b>${fmt(totals.billed)}</b></div>
    <div class="tot"><span>EOB allowed</span><b>${fmt(totals.eobAllowed)}</b></div>
    <div class="tot"><span>Your responsibility</span><b>${fmt(totals.patientResponsibility)}</b></div>
    <div class="tot hi"><span>Potentially at stake</span><b>${fmt(totals.totalAtStake)}</b></div>`;

  const byType = {};
  for (const f of findings) (byType[f.type] ||= []).push(f);

  $("report-findings").innerHTML = findings.length
    ? Object.entries(byType).map(([type, list]) => `
        <h3>${TYPE_LABELS[type] || type} <span class="count">${list.length}</span></h3>
        ${list.map((f) => `
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

// ---------- History ----------

async function loadHistory() {
  const user = auth.currentUser;
  if (!user) return;
  const snap = await getDocs(
    query(collection(db, `users/${user.uid}/audits`), orderBy("createdAt", "desc"))
  );
  $("history-list").innerHTML = snap.empty
    ? '<p class="muted">No audits yet — run your first above.</p>'
    : "";
  snap.forEach((d) => {
    const a = d.data();
    const el = document.createElement("div");
    el.className = "history-item";
    const when = a.createdAt?.toDate ? a.createdAt.toDate().toLocaleDateString() : "";
    el.innerHTML = `
      <button class="open">${when} · ${a.findings?.length ?? 0} findings · ${fmt(a.totals?.totalAtStake)}</button>
      <button class="del" title="Delete this audit">✕</button>`;
    el.querySelector(".open").onclick = async () => {
      const full = await getDoc(doc(db, `users/${user.uid}/audits/${d.id}`));
      renderReport(full.data(), { ocrLow: (full.data().ocrConfidence ?? 100) < OCR_CONFIDENCE_THRESHOLD });
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
}

resetState();
