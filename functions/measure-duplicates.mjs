// Can the duplicate check tell a per-diem from a double-bill?
//
//   node functions/measure-duplicates.mjs [runs]
//
// The prompt's whole test for duplicate_charge is "the same service billed more
// times than plausibly performed" (providers/gemini.js). Plausibility is doing
// all the work, and on a real bill-only audit on 2026-09-14 it went both ways on
// one account: a $3,523 line repeated on a 2-night stay was called a duplicate
// and became the entire headline, while a $4,951 line repeated on another bill
// was not flagged at all.
//
// The fixture contains BOTH patterns in one document, so there is no ambiguity
// about what the right answer is:
//
//   legitimate  Room & Board x3, three different dates   (a 3-night stay)
//   legitimate  acetaminophen x3, three different dates  (a drug given daily)
//   DUPLICATE   Delivery Room x2, SAME date, SAME charge (nothing else it can be)
//
// Expected: exactly one duplicate_charge, $4,951. Anything flagged on the room or
// pharmacy lines is a false positive of the kind that tells someone to dispute
// money they owe.
//
// Runs the audit several times because temperature 0 is not determinism — the
// $18/$20 cost_share_error drift in schema.js was three identical runs apart.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAudit } from "./providers/gemini.js";
import { computeAtStake, verifyEvidence } from "./schema.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = process.env.MODEL_ID || "gemini-3.6-flash";
const RUNS = Number(process.argv[2] || 3);

// Never echoed, never written down — read from the environment, else the keychain.
const KEY = process.env.GEMINI_API_KEY || execFileSync(
  "security", ["find-generic-password", "-w", "-s", "askmyfit-gemini"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
).trim();

// Two fixtures, identical charges, one difference: whether the statement prints a
// date of service per line. That is the whole question. With dates, "same service
// on three consecutive days" is written on the page; without them, three identical
// lines are indistinguishable from one line billed three times, and the model has
// nothing to reason from. The real bills that produced the $3,523 were the second
// kind — their stored occurrenceTable rows carry no code and no date.
const FIXTURES = [
  ["with dates   ", "dup-perdiem-bill.txt"],
  ["without dates", "dup-perdiem-bill-nodates.txt"],
];
const DOUBLE = 4951;            // the one real duplicate
const LEGIT = [3523, 6.44];     // per-diem and daily-dose repeats: must NOT be flagged
const money = (n) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");

let passes = 0, total = 0;
for (const [label, file] of FIXTURES) {
const BILL = readFileSync(join(HERE, "../test-fixtures/", file), "utf8");
console.log(`\n=== ${label} (${file}) ===`);
for (let i = 1; i <= RUNS; i++) {
  total++;
  const { data } = await runAudit(
    { text: BILL, images: [] },
    { text: "", images: [] },          // no EOB — this is the bill-only path
    { modelId: MODEL, apiKey: KEY },
  );
  // Exactly what index.js does before anything reaches the report.
  const { result } = verifyEvidence(data, { bill: data.billText || BILL, eob: "", sbc: "" });
  const dups = (result.findings || []).filter((f) => f.type === "duplicate_charge");

  const caught = dups.some((f) => Math.abs((f.amountAtStake ?? 0) - DOUBLE) < 0.01);
  const falsePos = dups.filter((f) => LEGIT.some((n) => Math.abs((f.amountAtStake ?? 0) - n) < 0.01));
  const ok = caught && falsePos.length === 0 && dups.length === 1;
  if (ok) passes++;

  console.log(`\nrun ${i}  ${ok ? "PASS" : "FAIL"}`);
  console.log(`  caught the real double-bill   ${caught ? "✓" : "✗"}  (expected ${money(DOUBLE)})`);
  console.log(`  flagged a legitimate repeat   ${falsePos.length === 0 ? "✓ none" : `✗ ${falsePos.length}`}`);
  for (const f of dups) console.log(`    - ${money(f.amountAtStake)}  ${f.lineRef}  ${String(f.description).slice(0, 96)}`);
  console.log(`  other findings   ${(result.findings || []).filter((f) => f.type !== "duplicate_charge").map((f) => `${f.type} ${money(f.amountAtStake)}`).join(", ") || "none"}`);
  console.log(`  worth disputing  ${money(computeAtStake(result.findings, result.totals?.billed))}   (correct answer: ${money(DOUBLE)})`);
}
}

console.log(`\n${passes}/${total} runs separated the per-diem from the double-bill.`);
process.exit(passes === total ? 0 : 1);
