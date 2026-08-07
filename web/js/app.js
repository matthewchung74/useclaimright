import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, query, orderBy, getDocs, doc, getDoc, deleteDoc, addDoc,
  serverTimestamp, connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  planYearWindow, visitsUsed, latestAccumulators, suggestedTrackers, warningLevel,
} from "./usage.js";
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

// "No EOB" mode: bill-only audit with reduced scope.
$("no-eob").onchange = () => {
  const skip = $("no-eob").checked;
  $("no-eob-note").hidden = !skip;
  $("dz-eob").classList.toggle("disabled", skip);
  if (skip) { $("eob-file").value = ""; $("eob-picked").textContent = ""; }
};

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
  const skipEob = $("no-eob").checked;
  if (!billFile) {
    return setError("upload-error", "The itemized bill is required.");
  }
  if (!eobFile && !skipEob) {
    return setError("upload-error", "Add your EOB (step 1), or check “I don't have an EOB”.");
  }
  if (billFile.size > 20e6 || (eobFile && eobFile.size > 20e6)) {
    return setError("upload-error", "Files must be under 20MB.");
  }

  resetStatePreservingFiles();
  show("processing");

  try {
    setStatus("Reading your documents…");
    const bill = await extractText(billFile);
    const eob = skipEob ? null : await extractText(eobFile);

    const ocrUsed = bill.method === "ocr" || eob?.method === "ocr";
    $("ocr-banner").hidden = !ocrUsed;

    setStatus("Loading the privacy model (first run downloads ~90MB, cached after)…");
    const ner = await loadNer((p) => {
      if (p.status === "progress" && p.total) {
        setStatus(`Downloading privacy model… ${Math.round((p.loaded / p.total) * 100)}%`);
      }
    });

    setStatus("Hiding your personal information — on your device…");
    state.bill = { originalText: bill.text, previews: bill.previews, method: bill.method, confidence: bill.confidence };
    state.bill.redacted = (await deidentify(bill.text, ner, state.registry)).redacted;
    if (eob) {
      state.eob = { originalText: eob.text, previews: eob.previews, method: eob.method, confidence: eob.confidence };
      state.eob.redacted = (await deidentify(eob.text, ner, state.registry)).redacted;
    } else {
      state.eob = null;
    }

    state.activeDoc = state.eob ? "eob" : "bill";
    $("tab-eob").style.display = state.eob ? "" : "none";
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
  // Original pane: show the ACTUAL document (rendered pages) when we have it —
  // far easier to read than extracted text. Falls back to text for HTML/txt.
  const orig = $("original-pane");
  if (docState.previews?.length) {
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
  if (other) other.redacted = manualRedact(other.redacted, sel, state.registry);
  renderReview();
};

$("confirm-review").onclick = async () => {
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
    renderReport(data, { ocrLow, model: data.model });
    show("report");
    track("audit_completed");
    await loadHistory(); // refreshes allAudits (incl. this audit) + usage cards
    renderReportUsage(data);
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

// ---------- History + usage data ----------

let allAudits = [];   // normalized for usage.js
let allTrackers = []; // {id, label, codes, limit, planYearStartMonth}

const todayISO = () => new Date().toISOString().slice(0, 10);

async function loadHistory() {
  const user = auth.currentUser;
  if (!user) return;
  const snap = await getDocs(
    query(collection(db, `users/${user.uid}/audits`), orderBy("createdAt", "desc"))
  );
  $("history-list").innerHTML = snap.empty
    ? '<p class="muted">No audits yet — run your first above.</p>'
    : "";
  allAudits = [];
  snap.forEach((d) => {
    const a = d.data();
    allAudits.push({
      id: d.id,
      serviceDates: a.serviceDates || [],
      occurrenceTable: a.occurrenceTable || [],
      accumulators: a.accumulators || null,
      payerRemarks: a.payerRemarks || [],
      provider: a.provider || "",
      createdAtDate: a.createdAt?.toDate ? a.createdAt.toDate().toISOString().slice(0, 10) : "",
    });
    const el = document.createElement("div");
    el.className = "history-item";
    const when = (a.serviceDates && a.serviceDates[0]) ||
      (a.createdAt?.toDate ? a.createdAt.toDate().toLocaleDateString() : "");
    const prov = a.provider ? ` · ${escapeHtml(a.provider)}` : "";
    el.innerHTML = `
      <button class="open">${escapeHtml(when)}${prov} · ${a.findings?.length ?? 0} findings · ${fmt(a.totals?.totalAtStake)}</button>
      <button class="del" title="Delete this audit">✕</button>`;
    el.querySelector(".open").onclick = async () => {
      const full = await getDoc(doc(db, `users/${user.uid}/audits/${d.id}`));
      renderReport(full.data(), { ocrLow: (full.data().ocrConfidence ?? 100) < OCR_CONFIDENCE_THRESHOLD });
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
  await loadTrackers();
  renderUsage();
}

async function loadTrackers() {
  const user = auth.currentUser;
  if (!user) return;
  const snap = await getDocs(collection(db, `users/${user.uid}/trackers`));
  allTrackers = [];
  snap.forEach((d) => allTrackers.push({ id: d.id, ...d.data() }));
}

// ---------- Usage tracker UI ----------

const LEVEL_NOTES = {
  near: "One covered visit left this plan year.",
  at: "Limit reached — further visits may be your responsibility.",
  over: "Over the limit — visits beyond it are likely your responsibility.",
};

function renderUsage() {
  const list = $("usage-list");
  list.innerHTML = "";
  for (const t of allTrackers) {
    const w = planYearWindow(t.planYearStartMonth || 1, todayISO());
    const { count, contributions } = visitsUsed(allAudits, t, w);
    const level = warningLevel(count, t.limit);
    const card = document.createElement("div");
    card.className = `usage-card ${level}`;
    const pct = Math.min(100, t.limit > 0 ? (count / t.limit) * 100 : 0);
    card.innerHTML = `
      <div class="usage-head">
        <b>${escapeHtml(t.label)}</b>
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
    list.appendChild(card);
  }
  if (!allTrackers.length) {
    list.innerHTML = '<p class="muted">Nothing tracked yet — add a limit below.</p>';
  }

  // Deductible card
  const dw = planYearWindow(allTrackers[0]?.planYearStartMonth || 1, todayISO());
  const { snapshot, asOf, summedApplied, disagreement } = latestAccumulators(allAudits, dw);
  const dc = $("deductible-card");
  if (snapshot && typeof snapshot.deductibleToDate === "number") {
    const lim = typeof snapshot.deductibleLimit === "number" ? ` of ${fmt(snapshot.deductibleLimit)}` : "";
    dc.innerHTML = `<div class="usage-card">
      <div class="usage-head"><b>Deductible</b><span class="usage-count">${fmt(snapshot.deductibleToDate)}${lim}</span></div>
      ${typeof snapshot.deductibleLimit === "number" ? `<div class="progress"><div class="bar" style="width:${Math.min(100, (snapshot.deductibleToDate / snapshot.deductibleLimit) * 100)}%"></div></div>` : ""}
      <div class="muted">As stated on your most recent EOB (${escapeHtml(asOf)}).${disagreement ? ` Note: your EOBs' per-claim amounts sum to ${fmt(summedApplied)} — the insurer's running total disagrees; worth a look.` : ""}</div>
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
  const codes = new Set(data.occurrenceTable.map((r) => String(r.code).toUpperCase()));
  for (const t of allTrackers) {
    if (!(t.codes || []).some((c) => codes.has(String(c).toUpperCase()))) continue;
    const w = planYearWindow(t.planYearStartMonth || 1, todayISO());
    const { count } = visitsUsed(allAudits, t, w);
    const level = warningLevel(count, t.limit);
    const cls = level === "ok" ? "" : level;
    el.innerHTML += `<div class="usage-card ${cls}" style="margin:12px 0">
      <div class="usage-head"><b>${escapeHtml(t.label)}: visit ${count} of ${t.limit} this plan year</b></div>
      ${LEVEL_NOTES[level] ? `<div class="usage-note">${LEVEL_NOTES[level]}</div>` : ""}</div>`;
    if (level !== "ok") track("tracker_warning_shown");
  }
}

resetState();
