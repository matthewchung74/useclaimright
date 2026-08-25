import { test } from "node:test";
import assert from "node:assert/strict";
import { crossBillDuplicates } from "../../web/js/crossbill.js";

// The shape loadHistory() builds for the dashboard. Note what is NOT here:
// any notion of WHO the bill was for. Every audit is anonymous to this layer.
const audit = (id, billKey, code, date, amount, patientName = "") => ({
  id, billKey, patientName, provider: "Testville Family Medicine Associates",
  serviceDates: [date], atStake: 0, findingTypes: [], summary: "", createdAtDate: date,
  occurrenceTable: [{ code, description: "svc", count: 1, unitCharges: [amount], dates: [date] }],
});

test("REGRESSION: two family members, same clinic, same day, is NOT a double-bill", () => {
  // Matthew and Sarah each get a flu shot on 2026-03-10. Two people, two
  // legitimate charges, two separate statements — so two different billKeys.
  const found = crossBillDuplicates([
    audit("a-matthew", "b-matthew", "90686", "2026-03-10", 85, "Matthew T. Testpatient"),
    audit("a-sarah", "b-sarah", "90686", "2026-03-10", 85, "Sarah L. Testpatient"),
  ]);
  assert.deepEqual(
    found, [],
    "reported a duplicate charge for two different patients — this tells a user to dispute a charge they owe",
  );
});

test("a genuine duplicate across two statements is still caught", () => {
  // The same person's single visit appearing on two different statements is
  // the real thing this detector exists for, and must keep firing.
  const found = crossBillDuplicates([
    audit("a-1", "b-first-statement", "99213", "2026-03-10", 210, "Emma R. Testpatient"),
    audit("a-2", "b-second-statement", "99213", "2026-03-10", 210, "Emma R. Testpatient"),
  ]);
  assert.equal(found.length, 1, "a real cross-statement duplicate must still be reported");
  assert.equal(found[0].code, "99213");
});

test("name spelling variants are still one person", () => {
  // Bills print names inconsistently; a duplicate must not slip through just
  // because one statement used a middle initial and the other did not.
  const found = crossBillDuplicates([
    audit("a-1", "b-1", "99213", "2026-03-10", 210, "EMMA TESTPATIENT"),
    audit("a-2", "b-2", "99213", "2026-03-10", 210, "Emma R. Testpatient"),
  ]);
  assert.equal(found.length, 1, "same person, two statements — still a duplicate");
});

test("audits with no patient name behave exactly as before", () => {
  // Everything stored before patientName existed, and every single-patient
  // account, must keep getting duplicate detection.
  const found = crossBillDuplicates([
    audit("a-1", "b-1", "99213", "2026-03-10", 210),
    audit("a-2", "b-2", "99213", "2026-03-10", 210),
  ]);
  assert.equal(found.length, 1);
});

test("REGRESSION: one named, one unnamed, at the same charge is still a duplicate", () => {
  // patientName is model-extracted and comes back empty often enough to matter:
  // on the D1 fixtures the model read it from one statement of a pair and not
  // the other. Keying on it directly made "" a different person from
  // "jane testpatient", so a real double-bill went unreported — silently, and in
  // the direction that costs the user money.
  const found = crossBillDuplicates([
    audit("a-1", "b-1", "90837", "2026-02-12", 175, "Jane Q. Testpatient"),
    audit("a-2", "b-2", "90837", "2026-02-12", 175, ""),
  ]);
  assert.equal(found.length, 1, "an unknown name means we cannot tell them apart, which is what this check reports");
});

test("three bills, two named the same and one unnamed: still reported together", () => {
  const found = crossBillDuplicates([
    audit("a-1", "b-1", "90837", "2026-02-12", 175, "Jane Q. Testpatient"),
    audit("a-2", "b-2", "90837", "2026-02-12", 175, "Jane Q. Testpatient"),
    audit("a-3", "b-3", "90837", "2026-02-12", 175, ""),
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].bills.length, 3, "one unknown name collapses the whole group");
});

test("two different people PLUS a third unnamed: no split, all reported", () => {
  // The conservative direction. Splitting here would rely on the unnamed bill
  // belonging to neither, which is exactly what is not known.
  const found = crossBillDuplicates([
    audit("a-1", "b-1", "90686", "2026-03-10", 85, "Matthew T. Testpatient"),
    audit("a-2", "b-2", "90686", "2026-03-10", 85, "Sarah L. Testpatient"),
    audit("a-3", "b-3", "90686", "2026-03-10", 85, ""),
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].bills.length, 3);
});
