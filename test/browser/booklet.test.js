// The one document that exercises narrowing at all.
//
// findPlanSections exists because of a 135-page employer plan booklet holding
// three medical plans, which rendered to 18.6MB against a 10MB callable limit
// and failed with "please try again" — forever, since retrying sent it again.
// Everything written to fix that has been tested against sections.test.js's
// hand-written `booklet()`: a 30-page array with the headings typed out by
// someone who already knew what the code looked for.
//
// And carrier.test.js proves the real carrier SBCs cannot stand in. All five
// return [] — they are 7-14 pages holding one plan, under the page budget, so
// narrowing never runs on them. Between the model and the SBCs, the path had
// no real document at all.
//
//   npm --prefix test/browser run test:booklet
//
// Skips unless test-fixtures/private/booklet.pdf exists. Unlike carrier/ there
// is no fetch.sh and cannot be one: a booklet belongs to an employer's plan and
// is not published anywhere. See that directory's README.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findPlanSections, selectSchedulePages, pagesOf } from "../../web/js/sections.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BOOKLET = join(ROOT, "test-fixtures", "private", "booklet.pdf");

const havePdftotext = (() => {
  try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();
const SKIP = !havePdftotext ? "pdftotext (poppler) not installed"
  : !existsSync(BOOKLET) ? "no test-fixtures/private/booklet.pdf — see that directory's README"
  : false;

const PAGE_BUDGET = SKIP ? 24 : Number(
  readFileSync(join(ROOT, "web/js/extract.js"), "utf8").match(/PAGE_BUDGET\s*=\s*(\d+)/)[1]);

let cached = null;
const pages = () => (cached ??= execFileSync("pdftotext", ["-layout", BOOKLET, "-"],
  { encoding: "utf8", maxBuffer: 1 << 28 }).split("\f").slice(0, -1));

test("a real booklet is long enough that narrowing actually runs", { skip: SKIP }, () => {
  const n = pages().length;
  assert.ok(n > PAGE_BUDGET,
    `${n} pages, budget ${PAGE_BUDGET} — under it the whole document goes and this file tests nothing`);
});

test("every plan in the booklet is found, and the contents page starts none of them",
  { skip: SKIP }, () => {
    const secs = findPlanSections(pages());
    const medical = secs.filter((s) => /^MEDICAL/.test(s.kind));

    // Three plans, and which one the member is on is printed nowhere — the
    // reason resolvePlan and the "You chose this plan" radio list exist.
    assert.equal(medical.length, 3, `medical schedules: ${JSON.stringify(medical)}`);
    assert.deepEqual(medical.map((s) => s.plan), ["EPO Plan", "PPO Plan", "HDHP Plans"]);

    // Contiguous and in order. A section that starts before the previous one
    // ends means a body-text sentence was read as a heading — the failure that
    // made 26 pages each start their own section.
    for (let i = 1; i < medical.length; i++) {
      assert.equal(medical[i].start, medical[i - 1].end + 1,
        `gap or overlap between ${medical[i - 1].label} and ${medical[i].label}`);
    }

    // PLAN INFORMATION is the only place the coverage period is written; without
    // it the model invented 2025 for a 2026 plan.
    assert.ok(secs.some((s) => /PLAN INFORMATION/i.test(s.kind)),
      "no PLAN INFORMATION section — the plan year has nowhere to come from");

    // The contents page names every section in the document. Read as headings,
    // it starts all of them at once, on one page.
    assert.ok(secs.every((s) => s.start > 4),
      `a section starts in the front matter — the contents page is being read as headings: ` +
      JSON.stringify(secs.filter((s) => s.start <= 4)));
  });

test("the pages sent fit the budget and carry the plan year with the numbers",
  { skip: SKIP }, () => {
    const picked = pagesOf(selectSchedulePages(findPlanSections(pages()), PAGE_BUDGET));

    assert.ok(picked.length <= PAGE_BUDGET, `${picked.length} pages, budget ${PAGE_BUDGET}`);
    assert.ok(picked.length < pages().length / 4,
      `${picked.length} of ${pages().length} pages — narrowing barely narrowed`);

    // Page 1 always. The year itself is on the cover ("Revised 01-01-2026");
    // PLAN INFORMATION has only the shape of the year ("begins on January 1 and
    // ends on the following December 31"). Send one without the other and the
    // model has half a date.
    assert.equal(picked[0], 1, "the cover is not in the selection");

    // All three medical schedules, whole. Selection is all-or-nothing per kind
    // precisely so a member is never shown two of their three plans and asked
    // to choose.
    const medical = findPlanSections(pages()).filter((s) => /^MEDICAL/.test(s.kind));
    for (const s of medical) {
      for (let p = s.start; p <= s.end; p++) {
        assert.ok(picked.includes(p), `${s.label} page ${p} was dropped`);
      }
    }
  });

test("what the budget forces out is the low-priority kind, not a random page",
  { skip: SKIP }, () => {
    // Measured 2026-09-12 on the real booklet: medical (18 pages) + plan
    // information (2) + transplant (3) + the cover = 24, exactly the budget.
    // Prescription needs 19 more and does not fit, so it is dropped whole.
    //
    // That is the intended behaviour and it is still a real cost: a member whose
    // question is about drug coverage gets none of it. It is written down here
    // rather than discovered, because the fix — if there is one — is to raise
    // PAGE_BUDGET, and the 286KB/page measurement in carrier-browser.test.js
    // says how much room there is to do that.
    const secs = findPlanSections(pages());
    const sel = selectSchedulePages(secs, PAGE_BUDGET);
    const kinds = new Set(sel.map((s) => s.kind));

    assert.ok([...kinds].some((k) => /^MEDICAL/.test(k)), "medical was dropped");
    assert.ok(!secs.length || kinds.size < new Set(secs.map((s) => s.kind)).size,
      "nothing was dropped — the budget no longer bites and this test proves nothing");

    // Whatever kinds survive, each survives whole.
    for (const kind of kinds) {
      const all = secs.filter((s) => s.kind === kind);
      const chosen = sel.filter((s) => s.kind === kind);
      assert.equal(chosen.length, all.length,
        `${kind} was sent in part — a member would be shown some of their plans, not all`);
    }
  });
