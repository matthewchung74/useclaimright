import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFile, stemOf, pairFiles, uniqueDocs } from "../../web/js/batch.js";

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

test("one consolidated EOB is shared by every bill in its group", () => {
  const { pairs, billOnly, orphanEobs } = pairFiles([
    f("visit-bill-1.pdf"), f("visit-bill-2.pdf"), f("visit-bill-3.pdf"), f("visit-eob.pdf"),
  ]);
  assert.equal(pairs.length, 3);
  assert.equal(billOnly.length, 0);
  assert.equal(orphanEobs.length, 0);
  for (const p of pairs) assert.equal(p.eob.name, "visit-eob.pdf");
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

test("uniqueDocs: every bill, shared EOB File once, saved EOBs once by id", () => {
  const b1 = { name: "t1-bill.pdf" }, b2 = { name: "t2-bill.pdf" }, b3 = { name: "t3-bill.pdf" };
  const cons = { name: "t-eob.pdf" };
  const saved = { id: "abc", label: "Testville · 2026-01-15" };
  const docs = uniqueDocs([
    { bill: b1, eob: cons, savedEob: null },
    { bill: b2, eob: cons, savedEob: null },
    { bill: b3, eob: null, savedEob: saved },
    { bill: { name: "t4-bill.pdf" }, eob: null, savedEob: saved },
  ]);
  assert.equal(docs.length, 6); // 4 bills + cons once + saved once
  assert.deepEqual(docs.map((d) => d.kind), ["bill", "eob", "bill", "bill", "eob", "bill"]);
  assert.equal(docs.filter((d) => d.file === cons).length, 1);
  assert.equal(docs.filter((d) => d.savedEob === saved).length, 1);
});

test("uniqueDocs: bill-only queue yields just the bills in order", () => {
  const q = [{ bill: { name: "a-bill.pdf" }, eob: null, savedEob: null },
             { bill: { name: "b-bill.pdf" }, eob: null, savedEob: null }];
  const docs = uniqueDocs(q);
  assert.deepEqual(docs.map((d) => d.file.name), ["a-bill.pdf", "b-bill.pdf"]);
});

test("one bill and one EOB pair even when the filenames disagree", () => {
  // The family case, and the ordinary consolidated-statement case: a household
  // EOB shares a stem with no single bill. Before this, the app showed the EOB
  // in the list with a tick and refused to run, asking for an EOB.
  const { pairs, billOnly, orphanEobs } = pairFiles([
    { name: "matthew-bill.pdf" },
    { name: "family-eob.pdf" },
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].bill.name, "matthew-bill.pdf");
  assert.equal(pairs[0].eob.name, "family-eob.pdf");
  assert.deepEqual(billOnly, []);
  assert.deepEqual(orphanEobs, []);
});

test("the one-and-one rescue does not fire when there is real ambiguity", () => {
  // Two bills and one unmatched EOB is genuinely ambiguous — which bill does it
  // cover? Leave it orphaned and let the user say, rather than guessing.
  const r = pairFiles([
    { name: "alpha-bill.pdf" },
    { name: "beta-bill.pdf" },
    { name: "unrelated-eob.pdf" },
  ]);
  assert.equal(r.pairs.length, 0);
  assert.equal(r.billOnly.length, 2);
  assert.equal(r.orphanEobs.length, 1);
});

test("matching stems still pair normally, untouched by the rescue", () => {
  const r = pairFiles([{ name: "t3-bill.pdf" }, { name: "t3-eob.pdf" }]);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].bill.name, "t3-bill.pdf");
});
