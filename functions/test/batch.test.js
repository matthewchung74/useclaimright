import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFile, stemOf, pairFiles } from "../../web/js/batch.js";

const f = (name, role) => (role ? { name, role } : { name });

test("classifyFile recognizes common naming", () => {
  assert.equal(classifyFile("t1-eob.pdf"), "eob");
  assert.equal(classifyFile("t1-bill.pdf"), "bill");
  assert.equal(classifyFile("Explanation of Benefits March.pdf"), "eob");
  assert.equal(classifyFile("hospital statement.pdf"), "bill");
  assert.equal(classifyFile("Invoice_2026-03.pdf"), "bill");
  assert.equal(classifyFile("scan001.pdf"), "unknown");
});

test("stemOf strips role tokens so pairs share a key", () => {
  assert.equal(stemOf("t3-bill.pdf"), stemOf("t3-eob.pdf"));
  assert.equal(stemOf("march_visit_bill.pdf"), stemOf("march_visit_EOB.pdf"));
});

test("series drop pairs all six therapy visits plus the PT control", () => {
  const files = [];
  for (const p of ["t1", "t2", "t3", "t4", "t5", "t6", "p1"]) {
    files.push(f(`${p}-bill.pdf`), f(`${p}-eob.pdf`));
  }
  const { pairs, billOnly, orphanEobs } = pairFiles(files);
  assert.equal(pairs.length, 7);
  assert.equal(billOnly.length, 0);
  assert.equal(orphanEobs.length, 0);
  for (const { bill, eob } of pairs) {
    assert.equal(stemOf(bill.name), stemOf(eob.name));
  }
});

test("bill without a matching EOB becomes a bill-only audit", () => {
  const { pairs, billOnly } = pairFiles([f("t1-bill.pdf"), f("t1-eob.pdf"), f("urgent-care-bill.pdf")]);
  assert.equal(pairs.length, 1);
  assert.deepEqual(billOnly.map((x) => x.name), ["urgent-care-bill.pdf"]);
});

test("EOB without a bill is reported as an orphan", () => {
  const { pairs, orphanEobs } = pairFiles([f("jan-eob.pdf")]);
  assert.equal(pairs.length, 0);
  assert.deepEqual(orphanEobs.map((x) => x.name), ["jan-eob.pdf"]);
});

test("unknown file fills the missing side of its stem group", () => {
  const { pairs } = pairFiles([f("visit3-bill.pdf"), f("visit3-scan.pdf")]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].bill.name, "visit3-bill.pdf");
  assert.equal(pairs[0].eob.name, "visit3-scan.pdf");
});

test("explicit role overrides filename classification", () => {
  // Names say the opposite of the user's manual assignment — role must win.
  const { pairs } = pairFiles([f("t1-bill.pdf", "eob"), f("t1-eob.pdf", "bill")]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].bill.name, "t1-eob.pdf");
  assert.equal(pairs[0].eob.name, "t1-bill.pdf");
});

test("same-stem group with several of each zips by name order", () => {
  const { pairs } = pairFiles([
    f("visit-bill-1.pdf"), f("visit-bill-2.pdf"),
    f("visit-eob-1.pdf"), f("visit-eob-2.pdf"),
  ]);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].bill.name, "visit-bill-1.pdf");
  assert.equal(pairs[0].eob.name, "visit-eob-1.pdf");
});
