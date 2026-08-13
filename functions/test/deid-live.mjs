// Offline accuracy test: run the REAL OpenMed PII model (same one the browser
// loads) against the synthetic fixtures and grade it against the PHI canaries.
// Run: node test/deid-live.mjs   (first run downloads the model, ~1-2 min)
import { readFileSync } from "node:fs";
import { pipeline } from "@huggingface/transformers";
import { deidentify, createRegistry } from "../../web/js/deid.js";

const MODEL = "onnx-community/OpenMed-PII-SuperClinical-Base-184M-v1-ONNX";

function htmlToText(path) {
  return readFileSync(path, "utf8")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|tr|h1|h2|li|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CANARIES = [
  ["patient name", "Testpatient"],
  ["first name", "Jane"],
  ["SSN", "999-88-7777"],
  ["DOB", "03/14/1985"],
  ["MRN", "TESTMRN-424242"],
  ["phone", "867-5309"],
  ["email", "leakcanary@example.test"],
  ["street address", "123 Canary Lane"],
];

const KEEP = [
  ["hospital name", "St. Verification General Hospital"],
  ["insurer name", "ACME HEALTH"],
  ["CPT code", "80053"],
  ["bill demand", "845.00"],
  ["EOB stated total", "186.35"],
];

console.log("Loading model (first run downloads it)...");
const nerPipe = await pipeline("token-classification", MODEL, { dtype: "q8" });
const ner = (chunk, opts) => nerPipe(chunk, opts);

// A no-op NER, so every run can separate what the model caught from what the
// labeled-field harvest and regex backstop would have caught anyway. Without
// this the harness scored 7/7 while the model contributed NOTHING — the
// fixtures label every PII field, so the deterministic layers alone pass every
// canary and the model's failure is invisible.
const noNer = async () => [];

const registry = createRegistry();
let totalEntities = 0;
for (const file of ["fake-bill", "fake-eob"]) {
  const text = htmlToText(new URL(`../../test-fixtures/${file}.html`, import.meta.url).pathname);
  const t0 = Date.now();
  const { redacted, entityCount } = await deidentify(text, ner, registry);
  const baseline = (await deidentify(text, noNer, createRegistry())).redacted;
  totalEntities += entityCount;
  console.log(`\n===== ${file} (${entityCount} NER entities, ${((Date.now()-t0)/1000).toFixed(1)}s) =====`);
  let pass = 0, fail = 0;
  for (const [label, canary] of CANARIES) {
    const leaked = redacted.toLowerCase().includes(canary.toLowerCase());
    if (!text.toLowerCase().includes(canary.toLowerCase())) continue; // not present in this doc
    // Attribute the catch: only canaries the deterministic layers MISS are
    // evidence the model is doing anything.
    const onlyNer = !leaked && baseline.toLowerCase().includes(canary.toLowerCase());
    console.log(`  ${leaked ? "✖ LEAKED " : "✔ redacted"}  ${label}: ${canary}${onlyNer ? "   [caught by NER only]" : ""}`);
    leaked ? fail++ : pass++;
  }
  for (const [label, keep] of KEEP) {
    if (!text.toLowerCase().includes(keep.toLowerCase())) continue;
    const kept = redacted.toLowerCase().includes(keep.toLowerCase());
    console.log(`  ${kept ? "✔ kept    " : "✖ OVER-REDACTED"}  ${label}: ${keep}`);
    kept ? pass++ : fail++;
  }
  console.log(`  score: ${pass} pass / ${fail} fail`);
  console.log("  --- redacted sample (first 500 chars) ---");
  console.log("  " + redacted.slice(0, 500).replace(/\n/g, "\n  "));
}

// The harness exists to grade the MODEL. A run where the model produced no
// spans is not a pass — it is a run that graded the regex layers and told you
// nothing. Fail loudly rather than printing a green score.
if (totalEntities === 0) {
  console.error("\n✖ FAIL: the NER model produced 0 entities across every fixture.");
  console.error("  The canary scores above come from the labeled-field harvest and regex");
  console.error("  backstop alone — this run did NOT test the model. Check that the ONNX");
  console.error("  weights loaded and that the pipeline options still match the installed");
  console.error("  @huggingface/transformers version.");
  process.exit(1);
}
console.log(`\nNER contributed ${totalEntities} spans across the fixtures.`);
