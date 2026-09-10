import { test } from "node:test";
import assert from "node:assert/strict";
import { findPlanSections, selectSchedulePages, pagesOf } from "../../web/js/sections.js";

// Modelled on a member's real UMR booklet (2026-09-10): a contents page listing
// every section, then three medical schedules and three transplant schedules.
// The page text here is written by hand rather than lifted from the document —
// it is somebody's health plan, and the structure is what the code cares about.
const blank = (n) => Array(n).fill("");
const contents = [
  "TABLE OF CONTENTS",
  "INTRODUCTION ................................................................ 1",
  "MEDICAL SCHEDULE OF BENEFITS (EPO PLAN) .................... 4",
  "MEDICAL SCHEDULE OF BENEFITS (PPO PLAN) .................... 10",
  "MEDICAL SCHEDULE OF BENEFITS (HDHP PLANS) ................ 16",
  "TRANSPLANT SCHEDULE OF BENEFITS (EPO PLAN) ............. 22",
].join("\n");
const schedule = (plan, rows, kind = "MEDICAL") =>
  `${kind} SCHEDULE OF BENEFITS (${plan})\n\nAnnual Deductible Per Calendar Year\n${rows}`;

// Body text the real booklet repeats on 26 pages. Before headings had to sit at
// the top of a page and carry no full stop, this sentence started 26 sections.
const PROSE = "Benefits are payable as described below. The Co-pay and out-of-pocket " +
  "maximum are shown on the Schedule of Benefits.";

// pages 1-2 front matter, 3 contents, 7-12 EPO, 13-18 PPO, 19-24 HDHP, 25 transplant
function booklet() {
  const p = blank(30);
  p[2] = contents;
  p[6] = schedule("EPO Plan", "• Per Person   $0");
  p[12] = schedule("PPO Plan", "• Per Person   $500\n• Per Family   $1,500");
  p[18] = schedule("HDHP Plans", "• Single Coverage   $2,500\n• Family Coverage   $5,000");
  p[24] = schedule("EPO Plan", "Lifetime maximum", "TRANSPLANT");
  p[25] = schedule("PPO Plan", "Lifetime maximum", "TRANSPLANT");
  // Body prose scattered through the rest, as in the real document.
  for (const i of [13, 15, 20, 27, 28]) p[i] = p[i] || `Section ${i}\n\n${PROSE}`;
  return p;
}

test("the three plans in a booklet are found, with their page ranges", () => {
  const s = findPlanSections(booklet()).filter((x) => /MEDICAL/.test(x.kind));
  assert.deepEqual(s.map((x) => [x.plan, x.start, x.end]), [
    ["EPO Plan", 7, 12],
    ["PPO Plan", 13, 18],
    ["HDHP Plans", 19, 24],
  ]);
});

// Found by running the real booklet: capturing only the parenthetical made a
// transplant schedule indistinguishable from a medical one, so the page budget
// was spent on transplant instead of a plan's actual benefits.
test("a section keeps its kind, not just its plan name", () => {
  const s = findPlanSections(booklet());
  const t = s.find((x) => x.start === 25);
  assert.equal(t.plan, "EPO Plan");
  assert.match(t.kind, /TRANSPLANT/);
});

// Also found by the real booklet: with no heading after it, the last section
// claimed pages 32-135 as one prescription schedule.
test("a section cannot swallow the rest of the document", () => {
  const p = blank(200);
  p[9] = schedule("Gold", "• Per Person   $500");
  const [only] = findPlanSections(p);
  assert.equal(only.start, 10);
  assert.ok(only.end - only.start + 1 <= 15, `a schedule is a table, not ${only.end - only.start + 1} pages`);
});

test("prose repeating the phrase does not start a section", () => {
  const p = blank(30);
  for (let i = 0; i < 26; i++) p[i] = `Covered services\n\n${PROSE}`;
  assert.deepEqual(findPlanSections(p), []);
});

// Without this the contents page starts every section at once, and page 3
// swallows the document.
test("a table of contents is not mistaken for the sections it lists", () => {
  const s = findPlanSections(booklet());
  assert.ok(!s.some((x) => x.start <= 3), `contents page read as a section: ${JSON.stringify(s)}`);
});

test("a document with no headings we know returns nothing, rather than a guess", () => {
  const p = blank(40);
  p[10] = "ELIGIBILITY AND ENROLLMENT\n\nYou become eligible on the first day of the month.";
  assert.deepEqual(findPlanSections(p), []);
});

test("other insurers' wording is matched too", () => {
  const p = blank(12);
  p[3] = "BENEFITS AT A GLANCE (Gold PPO)\n\nDeductible";
  p[7] = "Summary of Coverage (Bronze)\n\nDeductible";
  assert.deepEqual(findPlanSections(p).map((x) => x.plan), ["Gold PPO", "Bronze"]);
});

// Prose that mentions a schedule is not a schedule.
test("a sentence referring to the schedule does not start one", () => {
  const p = blank(10);
  p[5] = "Refer to the applicable section of the Schedule of Benefits that corresponds to the " +
         "place of service to determine the benefit level that applies to a given service.";
  assert.deepEqual(findPlanSections(p), []);
});

// --- what actually gets sent ------------------------------------------------

test("medical schedules are chosen over transplant when the budget is tight", () => {
  const chosen = selectSchedulePages(findPlanSections(booklet()), 20);
  assert.deepEqual(chosen.map((x) => x.plan), ["EPO Plan", "PPO Plan", "HDHP Plans"]);
  assert.equal(pagesOf(chosen).length, 19, "the cover plus 18 pages of medical schedules");
  assert.deepEqual(pagesOf(chosen).slice(0, 4), [1, 7, 8, 9], "cover first, then the schedules");
});

// One plan's prescription schedule without the other two invites comparing
// plans that were not all shown.
test("a kind that does not fit whole is left out entirely", () => {
  const sections = [
    { kind: "MEDICAL", plan: "A", label: "MEDICAL A", start: 1, end: 6 },
    { kind: "MEDICAL", plan: "B", label: "MEDICAL B", start: 7, end: 12 },
    { kind: "PRESCRIPTION", plan: "A", label: "PRESCRIPTION A", start: 13, end: 14 },
    { kind: "PRESCRIPTION", plan: "B", label: "PRESCRIPTION B", start: 15, end: 25 },
  ];
  const chosen = selectSchedulePages(sections, 20);
  assert.deepEqual(chosen.map((x) => x.label), ["MEDICAL A", "MEDICAL B"]);
});

test("135 pages becomes something that can actually be sent", () => {
  const p = booklet().concat(blank(105));
  const chosen = selectSchedulePages(findPlanSections(p), 20);
  assert.ok(pagesOf(chosen).length <= 21, "over the limit is the failure this exists to prevent");
  assert.ok(pagesOf(chosen).length >= 18, "and it must not throw away the schedules either");
});

// A deliberate, uncomfortable choice, recorded so it is revisited rather than
// rediscovered: if one plan's schedule is too long, the WHOLE medical group is
// dropped and nothing is sent.
//
// Sending the two plans that fit would be worse. The bug this module exists to
// fix is a member picking the wrong plan out of three; offering them two, with
// no sign that a third existed, is that same bug with better manners. Dropping
// the group is at least visibly empty, and the caller can say so.
test("if one plan's schedule is oversized, its whole kind is dropped", () => {
  const sections = [
    { kind: "MEDICAL", plan: "EPO", label: "MEDICAL EPO", start: 1, end: 6 },
    { kind: "MEDICAL", plan: "PPO", label: "MEDICAL PPO", start: 7, end: 40 },
    { kind: "MEDICAL", plan: "HDHP", label: "MEDICAL HDHP", start: 41, end: 46 },
  ];
  assert.deepEqual(selectSchedulePages(sections, 20), [],
    "two plans out of three is the ambiguity bug wearing a nicer hat");
});

// --- the pages that say whether any of the rest applies ---------------------
//
// A real booklet prints the plan year in two halves: the SHAPE in Plan
// Information ("Benefits begin on January 1 and end on the following December
// 31") and the YEAR on the cover ("Revised 01-01-2026"). Sending only the
// schedules meant the model had neither and invented 2025 for a 2026 plan — so
// the plan was on file, correct in every other respect, and applied to nothing.

test("Plan Information is found, and taken before the schedules", () => {
  const p = blank(30);
  p[4] = "PLAN INFORMATION\n\nBenefit Plan Year   Benefits begin on January 1 and end on the following December 31.";
  p[6] = schedule("EPO Plan", "• Per Person   $0");
  p[12] = schedule("PPO Plan", "• Per Person   $500");
  const found = findPlanSections(p);
  assert.match(found[0].kind, /PLAN INFORMATION/);
  assert.equal(found[0].start, 5);
  // Priority, not page order: it must survive a budget that cannot hold everything.
  const chosen = selectSchedulePages(found, 8);
  assert.match(chosen[0].kind, /PLAN INFORMATION/);
});

test("the cover page always goes, because the year is printed on it", () => {
  const pages = pagesOf([{ kind: "MEDICAL", plan: "A", label: "A", start: 7, end: 9 }]);
  assert.deepEqual(pages, [1, 7, 8, 9]);
});

test("the cover is not sent twice when a section already starts at page 1", () => {
  const pages = pagesOf([{ kind: "MEDICAL", plan: "A", label: "A", start: 1, end: 3 }]);
  assert.deepEqual(pages, [1, 2, 3]);
});

test("the cover can be left out when a caller does not want it", () => {
  const pages = pagesOf([{ kind: "MEDICAL", plan: "A", label: "A", start: 7, end: 8 }], { cover: false });
  assert.deepEqual(pages, [7, 8]);
});

// "General Information" is the other common name for the same page.
test("the other name for that page is matched too", () => {
  const p = blank(10);
  p[3] = "GENERAL INFORMATION\n\nPlan year";
  assert.match(findPlanSections(p)[0].kind, /GENERAL INFORMATION/);
});
