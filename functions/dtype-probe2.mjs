import { pipeline } from "@huggingface/transformers";
const MODEL = "onnx-community/OpenMed-PII-SuperClinical-Base-184M-v1-ONNX";
const text = "Patient: Jane Q. Testpatient DOB: 03/14/1985 MRN: TESTMRN-424242 seen by Dr. Alice Smith at 123 Canary Lane.";
// smallest first — q4 (~92MB) would be the ideal browser payload if it works
for (const dtype of ["q4", "q4f16", "fp16"]) {
  try {
    const p = await pipeline("token-classification", MODEL, { dtype });
    const out = await p(text, { ignore_labels: ["O"] });
    const max = out.length ? Math.max(...out.map(o => o.score)) : 0;
    const names = out.filter(o => /name/i.test(o.entity)).map(o => o.word);
    console.log(`${dtype}: ${out.length} entities | max ${max.toFixed(3)} | names=[${names.join(",")}] | ` +
      out.slice(0,4).map(o=>`${o.word}:${o.entity}@${o.score.toFixed(2)}`).join(", "));
  } catch (e) { console.log(`${dtype}: FAILED ${String(e.message).slice(0,90)}`); }
}
