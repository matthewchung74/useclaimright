import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planYearWindow, visitsUsed, latestAccumulators, suggestedTrackers, warningLevel,
} from "../../web/js/usage.js";

const THERAPY = { label: "Psychotherapy", codes: ["90832", "90834", "90837"], limit: 6, planYearStartMonth: 1 };

const audit = (id, date, code = "90837", extra = {}) => ({
  id,
  serviceDates: date ? [date] : [],
  occurrenceTable: [{ code, description: "Psychotherapy 60 min", count: 1, dates: date ? [date] : [] }],
  createdAtDate: extra.createdAtDate || date || "",
  ...extra,
});

// --- planYearWindow ---
test("January plan year covers the calendar year", () => {
  assert.deepEqual(planYearWindow(1, "2026-08-06"), { start: "2026-01-01", end: "2026-12-31" });
});
test("July plan year crosses the calendar boundary", () => {
  assert.deepEqual(planYearWindow(7, "2026-03-15"), { start: "2025-07-01", end: "2026-06-30" });
  assert.deepEqual(planYearWindow(7, "2026-08-06"), { start: "2026-07-01", end: "2027-06-30" });
});
test("March plan year end handles leap February", () => {
  assert.deepEqual(planYearWindow(3, "2027-03-01"), { start: "2027-03-01", end: "2028-02-29" });
});

// --- visitsUsed ---
const W2026 = { start: "2026-01-01", end: "2026-12-31" };

test("five monthly therapy visits count 5", () => {
  const audits = ["01-15", "02-12", "03-11", "04-15", "05-13"].map((d, i) => audit(`t${i}`, `2026-${d}`));
  const { count, contributions } = visitsUsed(audits, THERAPY, W2026);
  assert.equal(count, 5);
  assert.ok(contributions.every((c) => !c.approximate));
});

test("multi-code grouping counts all psychotherapy lengths together", () => {
  const audits = [audit("a", "2026-01-10", "90834"), audit("b", "2026-02-10", "90837")];
  assert.equal(visitsUsed(audits, THERAPY, W2026).count, 2);
});

test("other codes are isolated", () => {
  const audits = [audit("a", "2026-01-10"), audit("p", "2026-03-20", "97110")];
  assert.equal(visitsUsed(audits, THERAPY, W2026).count, 1);
});

test("E1: double-billed visit (count 2, one date) contributes 2, approximate", () => {
  const a = audit("dup", "2026-04-01");
  a.occurrenceTable[0].count = 2;
  const { count, contributions } = visitsUsed([a], THERAPY, W2026);
  assert.equal(count, 2);
  assert.equal(contributions[0].approximate, true);
});

test("E2: old-format audit (no dates anywhere) falls back to createdAt, approximate", () => {
  const a = { id: "old", occurrenceTable: [{ code: "90837", count: 1 }], createdAtDate: "2026-02-20" };
  const { count, contributions } = visitsUsed([a], THERAPY, W2026);
  assert.equal(count, 1);
  assert.equal(contributions[0].approximate, true);
});

test("E3: prior-year visit excluded from Jan window, included in Jul window", () => {
  const a = audit("dec", "2025-12-20");
  assert.equal(visitsUsed([a], THERAPY, W2026).count, 0);
  assert.equal(visitsUsed([a], THERAPY, { start: "2025-07-01", end: "2026-06-30" }).count, 1);
});

// --- latestAccumulators ---
test("latest snapshot wins; per-claim amounts sum; agreement detected", () => {
  const audits = [1, 2, 3].map((i) =>
    audit(`t${i}`, `2026-0${i}-15`, "90837", {
      accumulators: {
        deductibleToDate: i * 120, deductibleLimit: 1500, oopToDate: null, oopLimit: null,
        deductibleAppliedThisClaim: 120,
      },
    })
  );
  const r = latestAccumulators(audits, W2026);
  assert.equal(r.snapshot.deductibleToDate, 360);
  assert.equal(r.asOf, "2026-03-15");
  assert.equal(r.summedApplied, 360);
  assert.equal(r.disagreement, false);
});

test("disagreement flagged when snapshot and sum diverge", () => {
  const a = audit("x", "2026-05-01", "90837", {
    accumulators: { deductibleToDate: 500, deductibleLimit: 1500, oopToDate: null, oopLimit: null, deductibleAppliedThisClaim: 120 },
  });
  const r = latestAccumulators([a], W2026);
  assert.equal(r.disagreement, true);
});

// --- suggestedTrackers ---
test("benefit-maximum remark suggests the audit's codes, minus already-tracked", () => {
  const a = audit("t6", "2026-06-10", "90837", {
    payerRemarks: ["BENEFIT MAXIMUM REACHED: your plan covers 6 outpatient mental health visits per calendar year."],
  });
  assert.equal(suggestedTrackers([a]).length, 1);
  assert.equal(suggestedTrackers([a])[0].code, "90837");
  assert.equal(suggestedTrackers([a], [THERAPY]).length, 0);
});

test("no suggestion without limit-flavored remarks", () => {
  const a = audit("t1", "2026-01-15", "90837", { payerRemarks: ["Claim processed."] });
  assert.equal(suggestedTrackers([a]).length, 0);
});

test("suggestion carries the limit parsed from the remark when printed", () => {
  const used = audit("t5", "2026-05-13", "90837", {
    payerRemarks: ["NOTICE: 5 of 6 covered visits used for outpatient mental health services."],
  });
  assert.equal(suggestedTrackers([used])[0].limit, 6);
  const covers = audit("t6", "2026-06-10", "90837", {
    payerRemarks: ["BENEFIT MAXIMUM REACHED: your plan covers 6 outpatient mental health visits per calendar year."],
  });
  assert.equal(suggestedTrackers([covers])[0].limit, 6);
  const vague = audit("x", "2026-02-01", "97110", { payerRemarks: ["Visit limit may apply to this service."] });
  assert.equal(suggestedTrackers([vague])[0].limit, null);
});

// --- warningLevel ---
test("warning thresholds", () => {
  assert.equal(warningLevel(3, 6), "ok");
  assert.equal(warningLevel(5, 6), "near");
  assert.equal(warningLevel(6, 6), "at");
  assert.equal(warningLevel(7, 6), "over");
  assert.equal(warningLevel(3, 0), "ok"); // invalid limit
});

// --- limit remarks with words between "covered" and "visits" ---

// The real t5/t6 EOB remarks name the benefit before the word "visits". The
// original patterns required "visits" to follow "N of M covered" immediately,
// so zero-entry tracking never fired on the fixtures it was written for.
const REAL_T5 = "5 of 6 covered outpatient mental health visits used this plan year.";
const REAL_T6 = "BENEFIT MAXIMUM REACHED: 6 of 6 covered outpatient mental health visits used.";

test("a remark naming the benefit between 'covered' and 'visits' still suggests a tracker", () => {
  const audits = [{ payerRemarks: [REAL_T5], occurrenceTable: [{ code: "90837", description: "Psychotherapy, 60 minutes" }] }];
  const s = suggestedTrackers(audits, []);
  assert.equal(s.length, 1);
  assert.equal(s[0].code, "90837");
  assert.equal(s[0].limit, 6, "the printed limit must be extracted so 'Track it' needs no form");
});

test("the benefit-maximum variant is suggested and carries its limit", () => {
  const s = suggestedTrackers(
    [{ payerRemarks: [REAL_T6], occurrenceTable: [{ code: "90837", description: "Psychotherapy" }] }], []);
  assert.equal(s.length, 1);
  assert.equal(s[0].limit, 6);
});

test("an already-tracked code is not re-suggested", () => {
  const s = suggestedTrackers(
    [{ payerRemarks: [REAL_T5], occurrenceTable: [{ code: "90837" }] }],
    [{ codes: ["90837"], limit: 6 }]);
  assert.deepEqual(s, []);
});
