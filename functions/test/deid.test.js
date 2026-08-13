// Unit tests for the browser de-id module. It is dependency-free at the top
// level (the NER model is a lazy dynamic import), so node can import it and we
// mock the NER pipeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deidentify, createRegistry, manualRedact } from "../../web/js/deid.js";

// Mock NER: tags "John Smith" as a NAME entity wherever it appears in a chunk.
function mockNer(target, label) {
  return async (chunk) => {
    const tokens = [];
    let idx = chunk.indexOf(target);
    while (idx !== -1) {
      tokens.push({ entity: `B-${label}`, start: idx, end: idx + target.length });
      idx = chunk.indexOf(target, idx + 1);
    }
    return tokens;
  };
}

test("NER entities become typed numbered placeholders", async () => {
  const registry = createRegistry();
  const { redacted } = await deidentify(
    "Patient John Smith owes $50. John Smith was seen on 3/2.",
    mockNer("John Smith", "PATIENT"),
    registry
  );
  assert.match(redacted, /\[NAME_1\] owes \$50\. \[NAME_1\] was seen/);
  assert.ok(!redacted.includes("John Smith"));
});

test("same surface string maps to the same placeholder across documents", async () => {
  const registry = createRegistry();
  const ner = mockNer("John Smith", "PATIENT");
  const a = await deidentify("Bill for John Smith", ner, registry);
  const b = await deidentify("EOB for John Smith", ner, registry);
  assert.ok(a.redacted.includes("[NAME_1]"));
  assert.ok(b.redacted.includes("[NAME_1]"));
});

test("distinct surfaces get distinct numbers", async () => {
  const registry = createRegistry();
  const a = await deidentify("John Smith", mockNer("John Smith", "PATIENT"), registry);
  const b = await deidentify("Jane Doe", mockNer("Jane Doe", "PATIENT"), registry);
  assert.ok(a.redacted.includes("[NAME_1]"));
  assert.ok(b.redacted.includes("[NAME_2]"));
});

test("regex backstop catches SSN, phone, and email even when NER misses them", async () => {
  const registry = createRegistry();
  const noopNer = async () => [];
  const { redacted } = await deidentify(
    "SSN 123-45-6789, call (555) 123-4567, email jane@example.com",
    noopNer,
    registry
  );
  assert.ok(!redacted.includes("123-45-6789"));
  assert.ok(!redacted.includes("555) 123-4567"));
  assert.ok(!redacted.includes("jane@example.com"));
  assert.match(redacted, /\[SSN_1\]/);
  assert.match(redacted, /\[PHONE_1\]/);
  assert.match(redacted, /\[EMAIL_1\]/);
});

test("organization-like labels are kept (counterparty names survive)", async () => {
  const registry = createRegistry();
  const { redacted } = await deidentify(
    "St. Mary Hospital billed you.",
    mockNer("St. Mary Hospital", "HOSPITAL"),
    registry
  );
  assert.ok(redacted.includes("St. Mary Hospital"));
});

test("manualRedact replaces every occurrence and reuses the registry", () => {
  const registry = createRegistry();
  const out = manualRedact("code X99 then X99 again", "X99", registry);
  assert.equal(out, "code [MANUAL_1] then [MANUAL_1] again");
});

// --- span reconstruction (the live path: the real model returns no offsets) ---

// Mock NER with NO char offsets, only token text — what transformers.js
// actually returns. Spans must be reconstructed by walking the chunk.
const offsetlessNer = (tokens) => async () => tokens;

test("a subword match landing inside a word is dropped, not redacted", async () => {
  // Live failure: an audit stored "Therape[COORDINATE_1]tic exercises". With
  // ignore_labels:["O"] only entity tokens come back, so the cursor walk
  // searched the whole chunk for "u" and hit the one inside "Therapeutic".
  const { redacted } = await deidentify(
    "97110 Therapeutic exercises, 15 min",
    offsetlessNer([{ entity: "B-COORDINATE", word: "u" }]),
    createRegistry()
  );
  assert.equal(redacted, "97110 Therapeutic exercises, 15 min");
  assert.ok(!redacted.includes("COORDINATE"));
});

test("subword tokens spanning a whole word still redact it", async () => {
  // The guard must not cost us real entities: "Johnson" arrives as two pieces
  // that merge into one word-aligned span.
  const { redacted } = await deidentify(
    "Patient Johnson owes $50.",
    offsetlessNer([
      { entity: "B-PATIENT", word: "John" },
      { entity: "I-PATIENT", word: "##son" },
    ]),
    createRegistry()
  );
  assert.match(redacted, /Patient \[NAME_1\] owes/);
  assert.ok(!redacted.includes("Johnson"));
});

test("a whole-word offsetless match still redacts", async () => {
  const { redacted } = await deidentify(
    "Seen by Alice today.",
    offsetlessNer([{ entity: "B-PATIENT", word: "Alice" }]),
    createRegistry()
  );
  assert.match(redacted, /Seen by \[NAME_1\] today\./);
});

// --- confidence floor ---

test("a near-chance model span never redacts", async () => {
  // The live model returns garbage at ~0.04: "Jane" tagged phone_number,
  // "Alice" tagged certificate_license_number. Acting on that is how a single
  // letter inside "Therapeutic" became a placeholder.
  const { redacted } = await deidentify(
    "97110 Therapeutic exercises, 15 min",
    async () => [{ entity: "B-COORDINATE", word: "Therapeutic", score: 0.042 }],
    createRegistry()
  );
  assert.equal(redacted, "97110 Therapeutic exercises, 15 min");
});

test("a confident model span still redacts", async () => {
  const { redacted } = await deidentify(
    "Seen by Alice today.",
    async () => [{ entity: "B-PATIENT", word: "Alice", score: 0.97 }],
    createRegistry()
  );
  assert.match(redacted, /Seen by \[NAME_1\] today\./);
});

test("scoreless tokens are trusted (offset-bearing callers and mocks)", async () => {
  const { redacted } = await deidentify(
    "Seen by Alice today.",
    async () => [{ entity: "B-PATIENT", word: "Alice" }],
    createRegistry()
  );
  assert.match(redacted, /Seen by \[NAME_1\] today\./);
});
