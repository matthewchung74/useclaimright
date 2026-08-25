// Generates the family fixtures. Run: node gen-family.mjs
//
// Public sources give you real SBCs (see real-sbc/) and one real sample EOB
// layout (see real-eob/), but nobody publishes a consolidated family EOB —
// it is a payer-specific document full of PHI. So this synthesizes one, using
// the exact column vocabulary from the CMS sample EOB:
//
//   Line No. · Date of Service · Service Description · Claim Status ·
//   Provider Charges · Allowed Charges · Co Pay · Deductible · Coinsurance ·
//   Paid by Insurer · What You Owe · Remark Code
//
// The plan numbers deliberately match the real CMS sample SBCs ($500
// individual / $1,000 family deductible, $2,500 / $5,000 OOP), so these
// fixtures compose with real-sbc/*.pdf in a single test.
//
// Two defects are planted, both currently live:
//
//   FAMILY DUPLICATE   Matthew and Sarah each get a flu shot at the same
//                      clinic on the same day. Two people, two legitimate
//                      charges. crossBillDuplicates keys on provider|code|date
//                      with no patient identity, so it reports "a provider
//                      billing you twice for one visit" and tells them to
//                      dispute a charge they owe.
//
//   FAMILY DEDUCTIBLE  The EOB reports $640 applied against the $1,000 FAMILY
//                      deductible. web/js/plan.js:52 measures progress against
//                      structured.deductible.individual ($500), so the card
//                      renders 128% of a deductible they are only 64% through.
//
// A genuine duplicate is planted too (Emma, 99213 twice on one bill), so a fix
// that simply stops reporting duplicates does not pass.
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = new URL("./family/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const PLAN = { name: "Acme Silver PPO", group: "ACME-2026", dedInd: 500, dedFam: 1000, oopInd: 2500, oopFam: 5000 };
const FAMILY = {
  matthew: { name: "Matthew T. Testpatient", dob: "03/14/1985", id: "AHX-55512345", rel: "Subscriber" },
  sarah:   { name: "Sarah L. Testpatient",   dob: "07/22/1987", id: "AHX-55512346", rel: "Spouse" },
  emma:    { name: "Emma R. Testpatient",    dob: "11/02/2015", id: "AHX-55512347", rel: "Dependent" },
};
const CLINIC = "Testville Family Medicine Associates";
const DAY = "03/10/2026";

const css = `<style>body{font-family:Arial;margin:36px;font-size:12.5px;color:#111}
h1{font-size:17px;margin:0}.muted{color:#555;font-size:11.5px}
.head{display:flex;justify-content:space-between;border-bottom:3px solid #123;padding-bottom:10px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;margin-top:10px}
th,td{border-bottom:1px solid #ccc;padding:5px 6px;text-align:left;font-size:11.5px}
th{background:#eef2f5}td.r,th.r{text-align:right}.tot{font-weight:bold;background:#fdf6e3}
.box{border:1px solid #bbb;padding:9px;margin-top:8px}
.note{background:#f5f7fa;border:1px solid #ccd;padding:9px;margin-top:12px;font-size:11.5px}
.due{margin-top:12px;padding:9px;border:2px solid #a33;font-weight:bold}
.pt{background:#e8eef4;font-weight:bold}</style>`;

const usd = (n) => `$${n.toFixed(2)}`;

function bill({ file, person, acct, lines }) {
  const total = lines.reduce((s, l) => s + l.charge * (l.qty || 1), 0);
  const rows = lines.map((l) => `<tr><td>${l.date}</td><td>${l.code}</td><td>${l.desc}</td>
<td class="r">${l.qty || 1}</td><td class="r">${usd(l.charge * (l.qty || 1))}</td></tr>`).join("");
  writeFileSync(`${OUT}${file}`, `<!DOCTYPE html><html><head><meta charset="utf-8">${css}</head><body>
<div class="head"><div><h1>${CLINIC.toUpperCase()}</h1>
<div class="muted">88 Fixture Court, Testville, CA 90000 · (800) 555-0177 · Tax ID 99-9999999</div></div>
<div style="text-align:right"><b>ITEMIZED STATEMENT</b><br>Statement date: 03/28/2026<br>Account #: ${acct}</div></div>
<div class="box"><b>Patient:</b> ${person.name}<br><b>DOB:</b> ${person.dob}<br>
<b>Member ID:</b> ${person.id}<br><b>Guarantor:</b> ${FAMILY.matthew.name}</div>
<table><tr><th>Date of service</th><th>Code</th><th>Description</th><th class="r">Qty</th><th class="r">Charge</th></tr>
${rows}<tr class="tot"><td colspan="4">TOTAL CHARGES</td><td class="r">${usd(total)}</td></tr></table>
<div class="due">PATIENT BALANCE DUE: ${usd(total)}</div>
</body></html>`);
}

// Consolidated EOB, CMS sample-EOB column vocabulary.
function consolidatedEob(file, claims) {
  const rows = claims.map((c, i) => {
    const person = FAMILY[c.who];
    const head = `<tr class="pt"><td colspan="12">Patient: ${person.name} · ID ${person.id} · Claim ${c.claim} · Provider: ${CLINIC}</td></tr>`;
    const body = c.lines.map((l, j) => `<tr><td class="r">${j + 1}</td><td>${l.date}</td><td>${l.desc}</td>
<td>Paid</td><td class="r">${usd(l.charge)}</td><td class="r">${usd(l.allowed)}</td><td class="r">${usd(l.copay)}</td>
<td class="r">${usd(l.ded)}</td><td class="r">${usd(l.coins)}</td><td class="r">${usd(l.paid)}</td>
<td class="r">${usd(l.owe)}</td><td>${l.remark || ""}</td></tr>`).join("");
    return head + body;
  }).join("");

  writeFileSync(`${OUT}${file}`, `<!DOCTYPE html><html><head><meta charset="utf-8">${css}</head><body>
<div class="head"><div><h1 style="color:#123c78">ACME HEALTH INSURANCE</h1>
<div class="muted">EXPLANATION OF BENEFITS — <b>THIS IS NOT A BILL</b></div></div>
<div style="text-align:right">Customer Service: 1-800-123-4567<br>Statement Date: 03/25/2026<br>Document Number: DOC-2026-0331</div></div>
<div class="box"><b>Subscriber:</b> ${FAMILY.matthew.name} · Subscriber Number: ${FAMILY.matthew.id}<br>
<b>Group:</b> ${PLAN.group} · <b>Plan:</b> ${PLAN.name}<br>
<b>Address:</b> 12 Sample Street, Testville, CA 90000<br>
<span class="muted">This statement covers claims for all family members enrolled under this subscriber.</span></div>
<table>
<tr><th class="r">Line No.</th><th>Date of Service</th><th>Service Description</th><th>Claim Status</th>
<th class="r">Provider Charges</th><th class="r">Allowed Charges</th><th class="r">Co Pay</th><th class="r">Deductible</th>
<th class="r">Coinsurance</th><th class="r">Paid by Insurer</th><th class="r">What You Owe</th><th>Remark Code</th></tr>
${rows}</table>
<div class="note"><b>Family deductible:</b> $640.00 of ${usd(PLAN.dedFam)} met year to date.
<b>Individual deductible:</b> ${usd(PLAN.dedInd)} per member.<br>
<b>Family out-of-pocket maximum:</b> $640.00 of ${usd(PLAN.oopFam)} met year to date.</div>
<div class="note"><b>Remark Code:</b> PDC — Billed amount is higher than the maximum payment insurance allows.
The payment is for the allowed amount. You are not responsible for the difference from a network provider.</div>
</body></html>`);
}

// --- Matthew and Sarah: same clinic, same code, same day. NOT a duplicate. ---
bill({ file: "matthew-bill.html", person: FAMILY.matthew, acct: "ACCT-FAM-101",
  lines: [{ date: DAY, code: "90686", desc: "Influenza vaccine, quadrivalent, intramuscular", charge: 85.00 }] });
bill({ file: "sarah-bill.html", person: FAMILY.sarah, acct: "ACCT-FAM-102",
  lines: [{ date: DAY, code: "90686", desc: "Influenza vaccine, quadrivalent, intramuscular", charge: 85.00 }] });
// --- Emma: a GENUINE duplicate, same code twice on one statement. ---
bill({ file: "emma-bill.html", person: FAMILY.emma, acct: "ACCT-FAM-103",
  lines: [
    { date: DAY, code: "99213", desc: "Office visit, established patient, 20 min", charge: 210.00 },
    { date: DAY, code: "99213", desc: "Office visit, established patient, 20 min", charge: 210.00 },
  ] });

consolidatedEob("family-eob.html", [
  { who: "matthew", claim: "CLM-2026-4401", lines: [
    { date: DAY, desc: "Influenza vaccine", charge: 85.00, allowed: 32.00, copay: 0, ded: 0, coins: 0, paid: 32.00, owe: 0, remark: "PDC" }] },
  { who: "sarah", claim: "CLM-2026-4402", lines: [
    { date: DAY, desc: "Influenza vaccine", charge: 85.00, allowed: 32.00, copay: 0, ded: 0, coins: 0, paid: 32.00, owe: 0, remark: "PDC" }] },
  { who: "emma", claim: "CLM-2026-4403", lines: [
    { date: DAY, desc: "Office visit, established patient", charge: 210.00, allowed: 118.00, copay: 30.00, ded: 0, coins: 0, paid: 88.00, owe: 30.00, remark: "PDC" }] },
]);

console.log("wrote family/: matthew-bill, sarah-bill, emma-bill, family-eob (.html)");
