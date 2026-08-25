import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuditParts } from "../providers/gemini.js";

const INS = "INSTRUCTIONS";
const texts = (parts) => parts.filter((p) => p.text).map((p) => p.text).join("\n");
const imageCount = (parts) => parts.filter((p) => p.inlineData).length;

test("both documents as text: each appears once, under its own heading", () => {
  const p = buildAuditParts({ text: "BILL LINES", images: [] }, { text: "EOB LINES", images: [] }, INS);
  assert.match(texts(p), /ITEMIZED BILL[\s\S]*BILL LINES/);
  assert.match(texts(p), /===== EOB =====[\s\S]*EOB LINES/);
  assert.equal(imageCount(p), 0);
});

test("REGRESSION: a scanned bill must not silently drop a text EOB", () => {
  // The whole request used to branch on "is anything an image", so one image
  // discarded every text document. A photographed bill reached the model with
  // no EOB at all, which it reported as "missing from the EOB" — inflating
  // worth-disputing by the entire bill, with no error shown anywhere.
  const p = buildAuditParts({ text: "", images: ["AAAA"] }, { text: "EOB LINES", images: [] }, INS);
  assert.equal(imageCount(p), 1, "the bill image must be sent");
  assert.match(texts(p), /EOB LINES/, "the EOB text must NOT be dropped");
});

test("the mirror case: a text bill with a scanned EOB", () => {
  const p = buildAuditParts({ text: "BILL LINES", images: [] }, { text: "", images: ["BBBB", "CCCC"] }, INS);
  assert.match(texts(p), /BILL LINES/);
  assert.equal(imageCount(p), 2);
});

test("both scanned: images are ordered bill first, then EOB", () => {
  const p = buildAuditParts({ text: "", images: ["BILL1"] }, { text: "", images: ["EOB1", "EOB2"] }, INS);
  const order = p.filter((x) => x.inlineData).map((x) => x.inlineData.data);
  assert.deepEqual(order, ["BILL1", "EOB1", "EOB2"], "order is how the model tells them apart");
});

test("bill-only: no EOB heading is emitted at all", () => {
  const p = buildAuditParts({ text: "BILL LINES", images: [] }, { text: "", images: [] }, INS);
  assert.match(texts(p), /BILL LINES/);
  assert.doesNotMatch(texts(p), /===== EOB/, "an empty EOB must not appear as a heading with nothing under it");
});

test("a document with BOTH text and images sends the images", () => {
  // extract.js never produces this, but the contract should be unambiguous
  // rather than silently sending both and confusing the model.
  const p = buildAuditParts({ text: "SOME TEXT", images: ["IMG"] }, { text: "", images: [] }, INS);
  assert.equal(imageCount(p), 1);
  assert.doesNotMatch(texts(p), /SOME TEXT/);
});

test("instructions lead, so the model reads them before any document", () => {
  const p = buildAuditParts({ text: "B", images: [] }, { text: "E", images: [] }, INS);
  assert.equal(p[0].text, INS);
});
