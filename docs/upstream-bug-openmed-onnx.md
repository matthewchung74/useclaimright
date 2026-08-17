# Upstream bug report — OpenMed-PII-SuperClinical ONNX variants

**Where to post:** https://huggingface.co/onnx-community/OpenMed-PII-SuperClinical-Base-184M-v1-ONNX/discussions/new
**Status:** drafted 2026-08-16, not yet posted (needs a Hugging Face account).

Paste everything below the line as the discussion body. Title:

> Three of five ONNX variants are unusable: q8 returns near-chance logits, fp16 and q4f16 fail to load

---

Thanks for publishing this model — the fp32 and q4 builds work well for on-device PII redaction.

Reporting three broken variants, since two of them fail *silently* and cost us a while to track down.

## Environment

- `@huggingface/transformers` 4.2.0 (also reproduced in-browser via the jsDelivr build)
- `onnxruntime-node` 1.24.3
- Node v23.6.1, macOS (Darwin arm64)

## Summary

| Variant | File | Result |
|---|---|---|
| `fp32` | `model.onnx` | ✅ works — max score 1.00, correct labels |
| `q4` | `model_q4.onnx` | ✅ works — max score 0.999, correct labels |
| `q8` | `model_quantized.onnx` | ❌ **loads but outputs near-chance logits with wrong labels** |
| `fp16` | `model_fp16.onnx` | ❌ fails to load (type mismatch) |
| `q4f16` | `model_q4f16.onnx` | ❌ fails to load (same class of error) |

## 1. `q8` — loads fine, predictions are noise

This is the damaging one: nothing errors, so a pipeline appears healthy while detecting essentially nothing.

```js
import { pipeline } from "@huggingface/transformers";
const MODEL = "onnx-community/OpenMed-PII-SuperClinical-Base-184M-v1-ONNX";
const text = "Patient: Jane Q. Testpatient DOB: 03/14/1985 MRN: TESTMRN-424242 seen by Dr. Alice Smith at 123 Canary Lane.";

const p = await pipeline("token-classification", MODEL, { dtype: "q8" });
console.log(await p(text, { ignore_labels: ["O"] }));
```

Observed with `q8`:

```
[ { entity: "I-phone_number",             score: 0.042, word: "Jane"  },
  { entity: "B-certificate_license_number", score: 0.033, word: "Alice" } ]
```

Two spans, both mislabelled, both at roughly chance. `Jane` classified as a phone number and `Alice` as a licence number.

Same input, same code, `dtype: "q4"`:

```
11 entities, max score 0.999
Jane -> B-first_name @ 1.00
03/14/1985 -> date_of_birth @ 0.99
Alice, Smith, Robert, Chen all detected as names
```

So the softmax looks near-uniform for `q8` — consistent with a quantization that damaged the classifier head rather than a tokenizer or config problem.

## 2. `fp16` — fails to load

```js
await pipeline("token-classification", MODEL, { dtype: "fp16" });
```

```
Load model from .../onnx/model_fp16.onnx failed:
Type Error: Type (tensor(float16)) of output arg (/deberta/embeddings/Cast_output_0)
of node (/deberta/embeddings/Cast) does not match expected type (tensor(float)).
```

The `Cast` node at the DeBERTa embeddings emits `float16` where the consumer expects `float32`, so the graph fails type-checking at session creation. The file downloads completely (369 MB), so this is not a truncated artifact.

## 3. `q4f16` — fails to load

Same failure mode as `fp16` (mixed-precision cast mismatch). File is 275 MB and downloads completely.

## Impact

`q8` at 232 MB and `fp16` at 369 MB are the two sizes most attractive for browser deployment. With those unusable, the smallest working option is `q4` at 496 MB — more than double the broken `q8`, which is a hard trade for a web app.

The silent failure is worth emphasising: a consumer of `q8` gets a pipeline that loads, runs, returns a couple of low-confidence spans, and never errors. Any redaction system built on it would appear to work while catching nothing.

## Suggested fixes

1. Re-export `q8` and verify the classifier head survives quantization (a smoke test asserting max score > 0.5 on a labelled example would catch it).
2. Re-export `fp16` / `q4f16` with consistent precision through the embeddings `Cast`.
3. Failing that, note the broken variants in the model card so consumers pick `q4` or `fp32` directly.
