import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFeedback, FEEDBACK_MESSAGE_MAX_LENGTH } from "../feedback.js";

test("validateFeedback: accepts a normal submission and trims the message", () => {
  const r = validateFeedback({ message: "  the button broke  ", category: "bug", screen: "report", auditId: "abc123" });
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.deepEqual(r.value, { message: "the button broke", category: "bug", screen: "report", auditId: "abc123" });
});

test("validateFeedback: optional context may be omitted", () => {
  const r = validateFeedback({ message: "idea: dark mode", category: "idea" });
  assert.equal(r.ok, true);
  assert.equal(r.value.screen, null);
  assert.equal(r.value.auditId, null);
});

test("validateFeedback: rejects empty, whitespace-only, and overlong messages", () => {
  assert.equal(validateFeedback({ message: "", category: "bug" }).ok, false);
  assert.equal(validateFeedback({ message: "   ", category: "bug" }).ok, false);
  assert.equal(validateFeedback({ message: "x".repeat(FEEDBACK_MESSAGE_MAX_LENGTH + 1), category: "bug" }).ok, false);
  assert.equal(validateFeedback({ message: "x".repeat(FEEDBACK_MESSAGE_MAX_LENGTH), category: "bug" }).ok, true);
});

test("validateFeedback: rejects unknown categories and oversized context", () => {
  assert.equal(validateFeedback({ message: "hi", category: "rant" }).ok, false);
  assert.equal(validateFeedback({ message: "hi", category: "bug", screen: "s".repeat(121) }).ok, false);
  assert.equal(validateFeedback({ message: "hi", category: "bug", auditId: "a".repeat(201) }).ok, false);
  assert.equal(validateFeedback({ message: "hi" }).ok, false); // missing category
});
