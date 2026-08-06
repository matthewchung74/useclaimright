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

const registry = createRegistry();
for (const file of ["fake-bill", "fake-eob"]) {
  const text = htmlToText(new URL(`../../test-fixtures/${file}.html`, import.meta.url).pathname);
  const t0 = Date.now();
  const { redacted, entityCount } = await deidentify(text, ner, registry);
  console.log(`\n===== ${file} (${entityCount} NER entities, ${((Date.now()-t0)/1000).toFixed(1)}s) =====`);
  let pass = 0, fail = 0;
  for (const [label, canary] of CANARIES) {
    const leaked = redacted.toLowerCase().includes(canary.toLowerCase());
    if (!text.toLowerCase().includes(canary.toLowerCase())) continue; // not present in this doc
    console.log(`  ${leaked ? "✖ LEAKED " : "✔ redacted"}  ${label}: ${canary}`);
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
