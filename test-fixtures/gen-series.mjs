// Generates the synthetic visit-series fixtures (Series T: 6 psychotherapy
// visits; Series P: 1 physical therapy control) as HTML, plus the E2E answer
// key. PDFs are rendered from the HTML by the browse CLI (see docs/SETUP.md).
// Same canary patient as the base fixtures. Run: node gen-series.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = new URL("./series/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const PATIENT = `<b>Patient:</b> Jane Q. Testpatient<br><b>DOB:</b> 03/14/1985<br>
<b>MRN:</b> TESTMRN-424242<br><b>Member ID:</b> AHX-55512345`;

const css = `<style>body{font-family:Arial;margin:40px;font-size:13px;color:#111}
h1{font-size:18px;margin:0}.muted{color:#555}
.head{display:flex;justify-content:space-between;border-bottom:3px solid #123;padding-bottom:10px;margin-bottom:14px}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{border-bottom:1px solid #ccc;padding:6px 8px;text-align:left;font-size:12.5px}
th{background:#eef2f5}td.r,th.r{text-align:right}.tot{font-weight:bold;background:#fdf6e3}
.box{border:1px solid #bbb;padding:10px;margin-top:10px;width:48%}
.note{background:#f5f7fa;border:1px solid #ccd;padding:10px;margin-top:14px;font-size:12px}
.due{margin-top:14px;padding:10px;border:2px solid #a33;font-weight:bold}</style>`;

function bill({ n, date, code, desc, charge, provider }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${css}</head><body>
<div class="head"><div><h1>${provider.toUpperCase()}</h1>
<div class="muted">88 Fixture Court, Testville, CA 90000 · (800) 555-0177</div></div>
<div style="text-align:right"><b>ITEMIZED STATEMENT</b><br>Statement date: ${date}<br>Account #: ACCT-SER-${String(n).padStart(3, "0")}</div></div>
<div class="box">${PATIENT}</div>
<p><b>Date of service:</b> ${date}</p>
<table><tr><th>Code</th><th>Description</th><th class="r">Qty</th><th class="r">Charge</th></tr>
<tr><td>${code}</td><td>${desc}</td><td class="r">1</td><td class="r">$${charge.toFixed(2)}</td></tr>
<tr class="tot"><td colspan="3">TOTAL CHARGES</td><td class="r">$${charge.toFixed(2)}</td></tr></table>
<div class="due">PATIENT BALANCE DUE: $${charge.toFixed(2)}</div>
</body></html>`;
}

function eob({ n, date, code, desc, charge, allowed, dedToDate, remark, provider }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${css}</head><body>
<div class="head"><div><h1 style="color:#123c78">ACME HEALTH INSURANCE</h1>
<div class="muted">Explanation of Benefits — THIS IS NOT A BILL</div></div>
<div style="text-align:right">Claim #: CLM-SER-${String(n).padStart(3, "0")}<br>Processed: ${date}<br>Member ID: AHX-55512345</div></div>
<div class="box"><b>Member:</b> Jane Q. Testpatient<br><b>DOB:</b> 03/14/1985<br><b>Plan:</b> Acme Silver PPO</div>
<p><b>Provider:</b> ${provider}<br><b>Date of service:</b> ${date}</p>
<table><tr><th>Code</th><th>Service</th><th class="r">Billed</th><th class="r">Allowed</th><th class="r">Applied to deductible</th><th class="r">Plan paid</th><th class="r">Your responsibility</th></tr>
<tr><td>${code}</td><td>${desc}</td><td class="r">$${charge.toFixed(2)}</td><td class="r">$${allowed.toFixed(2)}</td>
<td class="r">${dedToDate === null ? "—" : `$${allowed.toFixed(2)}`}</td><td class="r">$0.00</td><td class="r">$${allowed.toFixed(2)}</td></tr></table>
${dedToDate === null ? "" : `<div class="note"><b>Deductible met to date: $${dedToDate.toFixed(2)} of $1,500.00</b> — this claim applied $${allowed.toFixed(2)} to your annual deductible.</div>`}
${remark ? `<div class="note"><b>Plan note:</b> ${remark}</div>` : ""}
<div class="note">What you may owe the provider: $${allowed.toFixed(2)}. Amounts above the allowed amount are provider write-offs under your plan's network contract.</div>
</body></html>`;
}

const THERAPY = { code: "90837", desc: "Psychotherapy, 60 minutes", charge: 175, allowed: 120, provider: "Testville Behavioral Health Associates" };
const PT = { code: "97110", desc: "Therapeutic exercises, 15 min", charge: 210, allowed: 95, provider: "Testville Physical Therapy Group" };

const T_DATES = ["2026-01-15", "2026-02-12", "2026-03-11", "2026-04-15", "2026-05-13", "2026-06-10"];
const T_REMARKS = [null, null, null, null,
  "5 of 6 covered outpatient mental health visits used this plan year.",
  "BENEFIT MAXIMUM REACHED: your plan covers 6 outpatient mental health visits per calendar year. Additional visits are member responsibility."];

const expected = { tracker: { label: "Psychotherapy", codes: ["90832", "90834", "90837"], limit: 6, planYearStartMonth: 1 }, steps: [] };

T_DATES.forEach((date, i) => {
  const n = i + 1;
  const dedToDate = 120 * n;
  writeFileSync(`${OUT}t${n}-bill.html`, bill({ n, date, ...THERAPY }));
  writeFileSync(`${OUT}t${n}-eob.html`, eob({ n, date, ...THERAPY, dedToDate, remark: T_REMARKS[i] }));
  expected.steps.push({
    pair: `t${n}`, date, code: THERAPY.code,
    afterCount: n, afterLevel: n === 5 ? "near" : n === 6 ? "at" : "ok",
    deductibleToDate: dedToDate,
  });
});

writeFileSync(`${OUT}p1-bill.html`, bill({ n: 101, date: "2026-03-20", ...PT }));
writeFileSync(`${OUT}p1-eob.html`, eob({ n: 101, date: "2026-03-20", ...PT, dedToDate: null, remark: null }));
expected.ptControl = { pair: "p1", code: PT.code, therapyCountUnchanged: true };
expected.final = { therapyCount: 6, level: "at", deductibleToDate: 720, deductibleLimit: 1500, suggestionCode: "90837" };

writeFileSync(new URL("./series-expected.json", import.meta.url).pathname, JSON.stringify(expected, null, 2));
console.log("Wrote 14 HTML fixtures + series-expected.json");
