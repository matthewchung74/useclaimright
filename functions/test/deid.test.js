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
