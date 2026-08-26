import { test } from "node:test";
import assert from "node:assert/strict";
import { crossBillDuplicates, runningTotals, groupAuditsByProvider, splitJustAudited, billKeyOf } from "../../web/js/crossbill.js";

// Client-normalized audit shape (see loadHistory in web/js/app.js).
const audit = (id, billKey, provider, code, dates, amount, extra = {}) => ({
  id, billKey, provider,
  serviceDates: dates,
  occurrenceTable: [{ code, description: "Psychotherapy, 60 minutes", count: 1, unitCharges: [amount], dates }],
  atStake: extra.atStake ?? 0,
  findingTypes: extra.findingTypes ?? [],
  summary: extra.summary ?? "",
  createdAtDate: extra.createdAtDate ?? dates[0] ?? "",
  ...extra,
});

// --- crossBillDuplicates ---

test("flags the same charge appearing on two different bills", () => {
  const dups = crossBillDuplicates([
    audit("a1", "billA", "Mercy General Hospital", "90837", ["2026-02-12"], 175),
    audit("a2", "billB", "Mercy General Hospital", "90837", ["2026-02-12"], 175),
  ]);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].code, "90837");
  assert.equal(dups[0].date, "2026-02-12");
  assert.equal(dups[0].amount, 175); // you owe one, not both
  assert.equal(dups[0].bills.length, 2);
});

test("the SAME bill audited twice is never a duplicate (M4 pattern)", () => {
  // One bill audited against an individual EOB, then against a consolidated one.
  const dups = crossBillDuplicates([
    audit("a1", "sameBill", "Testville Behavioral", "90837", ["2026-02-12"], 175),
    audit("a2", "sameBill", "Testville Behavioral", "90837", ["2026-02-12"], 175),
  ]);
  assert.deepEqual(dups, []);
});

test("recurring care is not a duplicate — same code, different dates", () => {
  const dups = crossBillDuplicates([
    audit("a1", "b1", "Testville Behavioral", "90837", ["2026-01-15"], 175),
    audit("a2", "b2", "Testville Behavioral", "90837", ["2026-02-12"], 175),
    audit("a3", "b3", "Testville Behavioral", "90837", ["2026-03-11"], 175),
  ]);
  assert.deepEqual(dups, []);
});

test("same code and date but different providers is not a duplicate", () => {
  const dups = crossBillDuplicates([
    audit("a1", "b1", "Mercy General", "90837", ["2026-02-12"], 175),
    audit("a2", "b2", "Bay Area Radiology", "90837", ["2026-02-12"], 175),
  ]);
  assert.deepEqual(dups, []);
});

test("amount at stake is the lesser of the two charges", () => {
  const dups = crossBillDuplicates([
    audit("a1", "b1", "Mercy", "90837", ["2026-02-12"], 175),
    audit("a2", "b2", "Mercy", "90837", ["2026-02-12"], 140),
  ]);
  assert.equal(dups[0].amount, 140);
});

test("audits without a bill identity are skipped, not guessed", () => {
  const a = audit("a1", "", "Mercy", "90837", ["2026-02-12"], 175);
  const b = audit("a2", "", "Mercy", "90837", ["2026-02-12"], 175);
  assert.deepEqual(crossBillDuplicates([a, b]), []);
});

test("falls back to the audit's serviceDates when an occurrence row has no dates", () => {
  const mk = (id, key) => ({
    id, billKey: key, provider: "Mercy", serviceDates: ["2026-02-12"],
    occurrenceTable: [{ code: "90837", description: "", count: 1, unitCharges: [175], dates: [] }],
    atStake: 0, findingTypes: [], summary: "", createdAtDate: "2026-02-12",
  });
  assert.equal(crossBillDuplicates([mk("a1", "b1"), mk("a2", "b2")]).length, 1);
});

// --- runningTotals ---

test("runningTotals sums money, findings and bills", () => {
  const t = runningTotals([
    audit("a1", "b1", "Mercy", "90837", ["2026-02-12"], 175, { atStake: 175, findingTypes: ["duplicate_charge", "copay_mismatch"] }),
    audit("a2", "b2", "Mercy", "97110", ["2026-03-20"], 210, { atStake: 35, findingTypes: ["copay_mismatch"] }),
    audit("a3", "b3", "Mercy", "99284", ["2026-04-01"], 500, { atStake: 0, findingTypes: [] }),
  ]);
  assert.deepEqual(t, { audited: 3, findings: 3, atStake: 210 });
});

test("runningTotals honours a plan-year window", () => {
  const t = runningTotals([
    audit("a1", "b1", "Mercy", "90837", ["2025-12-30"], 175, { atStake: 100, findingTypes: ["x"] }),
    audit("a2", "b2", "Mercy", "90837", ["2026-02-12"], 175, { atStake: 55, findingTypes: ["y"] }),
  ], { start: "2026-01-01", end: "2026-12-31" });
  assert.deepEqual(t, { audited: 1, findings: 1, atStake: 55 });
});

// --- groupAuditsByProvider ---

test("groups by provider, sorts by money at stake, and separates clean bills", () => {
  const { groups, clean } = groupAuditsByProvider([
    audit("a1", "b1", "Small Clinic", "99213", ["2026-02-01"], 100, { atStake: 50, findingTypes: ["wrong_code"] }),
    audit("a2", "b2", "Mercy General", "90837", ["2026-02-12"], 175, { atStake: 437, findingTypes: ["duplicate_charge"] }),
    audit("a3", "b3", "Mercy General", "90837", ["2026-01-08"], 175, { atStake: 175, findingTypes: ["not_in_eob"] }),
    audit("a4", "b4", "Mercy General", "90837", ["2026-01-02"], 175, { atStake: 0, findingTypes: [] }),
  ]);
  assert.deepEqual(groups.map((g) => g.provider), ["Mercy General", "Small Clinic"]); // by stake desc
  assert.equal(groups[0].atStake, 612);
  assert.deepEqual(groups[0].bills.map((b) => b.id), ["a2", "a3"]); // by stake desc, clean excluded
  assert.deepEqual(clean.map((c) => c.id), ["a4"]);
});

test("one provider stays one group when extraction varies the casing", () => {
  // Live finding: the model returned "Testville Behavioral Health Associates"
  // on one audit and "TESTVILLE BEHAVIORAL HEALTH ASSOCIATES" on another.
  const { groups } = groupAuditsByProvider([
    audit("a1", "b1", "TESTVILLE BEHAVIORAL HEALTH ASSOCIATES", "90837", ["2026-02-12"], 175, { atStake: 55, findingTypes: ["billed_vs_allowed_mismatch"] }),
    audit("a2", "b2", "Testville Behavioral Health Associates", "90837", ["2026-03-11"], 175, { atStake: 55, findingTypes: ["billed_vs_allowed_mismatch"] }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].bills.length, 2);
  assert.equal(groups[0].atStake, 110);
  // Prefer the readable variant over the SHOUTING one for display.
  assert.equal(groups[0].provider, "Testville Behavioral Health Associates");
});

test("a blank provider becomes its own labelled bucket, never dropped", () => {
  const { groups } = groupAuditsByProvider([
    audit("a1", "b1", "", "99213", ["2026-02-01"], 100, { atStake: 20, findingTypes: ["wrong_code"] }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].provider, "Provider not read");
});

// --- splitJustAudited ---

test("pins only the just-audited ids, in list order", () => {
  const audits = [
    audit("a3", "b3", "Clinic", "90837", ["2026-03-11"], 175, { atStake: 55 }),
    audit("a2", "b2", "Clinic", "90837", ["2026-02-12"], 175, { atStake: 55 }),
    audit("a1", "b1", "Clinic", "90837", ["2026-01-14"], 175, { atStake: 0 }),
  ];
  const just = splitJustAudited(audits, ["a2", "a3"]);
  assert.deepEqual(just.map((a) => a.id), ["a3", "a2"]);
});

test("an id with no surviving audit is dropped, not rendered as a hole", () => {
  const audits = [audit("a1", "b1", "Clinic", "90837", ["2026-01-14"], 175, { atStake: 0 })];
  assert.deepEqual(splitJustAudited(audits, ["a1", "deleted"]).map((a) => a.id), ["a1"]);
});

test("no just-audited ids means no pinned section", () => {
  const audits = [audit("a1", "b1", "Clinic", "90837", ["2026-01-14"], 175, {})];
  assert.deepEqual(splitJustAudited(audits, []), []);
  assert.deepEqual(splitJustAudited(audits, undefined), []);
});


// --- billKeyOf: identity of the paper (production regression 2026-08-26) ---

test("REGRESSION: the same bill as a PDF and as a photo is ONE paper", () => {
  // The live failure. pdf.js text and the model's transcription of a scan differ
  // by far more than whitespace, so the text hash saw two statements and the
  // dashboard accused the provider of double-billing a bill that exists once.
  const fromPdf = "ITEMIZED STATEMENT\nAccount #: ACCT-778899\n80053  Comprehensive metabolic panel  $145.50";
  const fromScan = "Itemized Statement | Account No. ACCT 778899 | 80053 Comprehensive Metabolic Panel 145.50";
  assert.notEqual(billKeyOf(fromPdf), billKeyOf(fromScan)); // text hash alone still cannot tell
  assert.equal(
    billKeyOf(fromPdf, "ACCT-778899", "St. Verification General Hospital"),
    billKeyOf(fromScan, "Account No. ACCT 778899".replace("Account No. ", ""), "ST. VERIFICATION GENERAL HOSPITAL"),
  );
});

test("two different statements for the same visit stay two papers", () => {
  // The case that must keep working: a genuine double-bill shares provider,
  // patient, date and codes, so ONLY the statement id separates them.
  const a = billKeyOf("same text", "ACCT-FAM-101", "Testville Family Medicine");
  const b = billKeyOf("same text", "ACCT-FAM-103", "Testville Family Medicine");
  assert.notEqual(a, b);
});

test("the same account number at different providers is not the same paper", () => {
  assert.notEqual(
    billKeyOf("t", "ACCT-001", "Testville Family Medicine"),
    billKeyOf("t", "ACCT-001", "St. Verification General Hospital"),
  );
});

test("punctuation and case in the id do not change the key", () => {
  const a = billKeyOf("t", "ACCT-778899", "Provider X");
  assert.equal(billKeyOf("t", "acct 778899", "provider x"), a);
  assert.equal(billKeyOf("t", "  ACCT#778899  ", "Provider X"), a);
});

test("a statement id with no digits is ignored as a mis-read label", () => {
  // "Account #" copied without its number is a label, not an identity — falling
  // back to the text hash is better than collapsing every such bill into one key.
  assert.equal(billKeyOf("some text", "Account #", "P"), billKeyOf("some text"));
});

test("no id and no text means no identity, and callers skip those audits", () => {
  assert.equal(billKeyOf("", "", "P"), "");
  assert.equal(billKeyOf(undefined, undefined, undefined), "");
});

test("crossBillDuplicates: one bill audited twice via two extractions is not a duplicate", () => {
  const shared = { provider: "Testville Clinic", serviceDates: ["2026-03-10"],
    occurrenceTable: [{ code: "99213", description: "Office visit", dates: ["2026-03-10"], unitCharges: [210] }] };
  const audits = [
    { ...shared, id: "a1", patientName: "Emma R. Testpatient",
      billKey: billKeyOf("pdf rendering", "ACCT-FAM-103", "Testville Clinic") },
    { ...shared, id: "a2", patientName: "Emma R. Testpatient",
      billKey: billKeyOf("a completely different scan transcription", "ACCT-FAM-103", "Testville Clinic") },
  ];
  assert.deepEqual(crossBillDuplicates(audits), []);
});
