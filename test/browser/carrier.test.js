// What five real carriers' documents do to code written against one fake one.
//
// Everything in test-fixtures/ that the app has ever been tested on, we wrote:
// fake-sbc.pdf is one plan with one deductible, and sections.test.js models a
// booklet by hand. test-fixtures/carrier/ holds documents from Kaiser, Blue
// Shield, BCBS Kansas, a Kansas exchange plan, Aetna and Cigna — real layouts,
// real numbers, nobody's personal data.
//
// They are the carriers' copyright, so they are gitignored and rebuilt by
// test-fixtures/carrier/fetch.sh. These tests skip cleanly when they are
// absent, the same contract as functions/ test:integration and the emulator:
// coverage for whoever has the fixtures, no red run for whoever does not.
//
//   node --test test/browser/carrier.test.js
//
// No network, no model, no audits. Page text only — the far side of extraction
// is Gemini and cannot be unit-tested; everything here is a pure function of
// what a real PDF's text layer says.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findPlanSections, selectSchedulePages, pagesOf } from "../../web/js/sections.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(ROOT, "test-fixtures", "carrier");

// The SBCs, and the deductible each is here to contribute. fetch.sh pulls live
// URLs, so a carrier can replace a plan year under us and quietly hand back a
// different plan — these figures are the corpus's own drift test.
const SBCS = [
  ["kaiser-calpers-2026.pdf", "$0"],
  ["blueshield-ppo-2026.pdf", "$1,000"],
  ["bcbsks-plan-a-2026.pdf", "$1,000"],
  ["qhp-ks-2026.pdf", "$2,000"],
  ["bcbsks-plan-c-2026.pdf", "$2,750"],
];

// Mirrored from the source rather than retyped, because a test that pins a
// margin to a constant is worthless once the constant moves without it.
const numberFrom = (file, name) => {
  const m = readFileSync(join(ROOT, file), "utf8").match(
    new RegExp(`${name}\\s*=\\s*([\\d_]+)`)
  );
  assert.ok(m, `${name} not found in ${file} — this test is pinned to it`);
  return Number(m[1].replace(/_/g, ""));
};
const PAGE_BUDGET = numberFrom("web/js/extract.js", "PAGE_BUDGET");
const MAX_PAGES = numberFrom("functions/index.js", "MAX_PAGES");

// pdftotext is poppler, which is not a project dependency. Its absence is a
// skip, not a failure — same as a missing fixture.
const havePdftotext = (() => {
  try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();
const present = SBCS.every(([f]) => existsSync(join(DIR, f)));
const SKIP = !havePdftotext ? "pdftotext (poppler) not installed"
  : !present ? "run test-fixtures/carrier/fetch.sh first" : false;

// One page per string, in page order — the shape findPlanSections takes and
// extract.js builds from the pdf.js text layer.
const pagesOfPdf = (file) =>
  execFileSync("pdftotext", ["-layout", join(DIR, file), "-"],
    { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\f").slice(0, -1);

test("every real SBC carries a text layer", { skip: SKIP }, () => {
  for (const [file] of SBCS) {
    const chars = pagesOfPdf(file).join("").length;
    assert.ok(chars > 20000, `${file}: ${chars} characters`);
  }
  // Which is why the scanned case is a separate corpus (test-fixtures/scans/)
  // and not something these can stand in for. A carrier publishing a PDF and a
  // member photographing a bill are different problems; only one is covered here.
});

test("a real SBC is not mistaken for a plan booklet", { skip: SKIP }, () => {
  // findPlanSections exists for a 135-page booklet holding three plans. An SBC
  // is 7-14 pages holding one, and must fall through to "send the whole thing".
  //
  // It currently does, but by a margin worth pinning: HEADING matches "summary
  // of benefits", and every one of these documents is titled "Summary of
  // Benefits and Coverage: What this Plan Covers & What You Pay For Covered
  // Services". It does not match only because looksLikeHeading caps a heading
  // at 80 characters and that title is 91. Loosen the cap and every real SBC
  // narrows to its cover page, losing the schedule entirely.
  for (const [file] of SBCS) {
    assert.deepEqual(findPlanSections(pagesOfPdf(file)), [], file);
  }
});

test("no real SBC reaches the page limits, and the margin is the whole story",
  { skip: SKIP }, () => {
    for (const [file] of SBCS) {
      const n = pagesOfPdf(file).length;
      assert.ok(n <= PAGE_BUDGET, `${file}: ${n} pages, budget ${PAGE_BUDGET}`);
      assert.ok(n <= MAX_PAGES, `${file}: ${n} pages, server limit ${MAX_PAGES}`);
      // Narrowing only runs above PAGE_BUDGET, so under it the whole document
      // goes and these documents are safe. Above it there is no rescue: the
      // test above proves findPlanSections finds nothing in an SBC, so a
      // carrier publishing a 26-page SBC gets "Too many pages" with no path
      // through. Worth knowing before a member finds it.
      assert.deepEqual(pagesOf(selectSchedulePages(findPlanSections(pagesOfPdf(file)), PAGE_BUDGET)), [1]);
    }
  });

test("the corpus still spans the deductibles it was assembled for",
  { skip: SKIP }, () => {
    // $0 to $2,750 across five carriers. fake-sbc.pdf is one number; a rule
    // like "a deductible charge is impossible on this plan" cannot be written,
    // let alone tested, without the $0 end of this range.
    for (const [file, deductible] of SBCS) {
      const all = pagesOfPdf(file).join("\n");
      // "The plan's overall deductible" is the SBC's own standardised wording,
      // required on every one of these by the same regulation.
      const m = all.match(/overall deductible\??\s+([^\n]{0,60})/i);
      assert.ok(m, `${file}: no "overall deductible" line`);
      assert.ok(
        all.includes(deductible),
        `${file}: expected deductible ${deductible}; carrier may have replaced the plan year`
      );
    }
  });

test("no two fixtures are the same document under different names",
  { skip: SKIP }, () => {
    // fetch.sh pulled an Aetna sample and an Aetna "annotated guide" from two
    // URLs, and on 2026-09-12 they came back byte-identical — the guide URL
    // serves the sample. curl -f catches a 404; it cannot catch a 200 serving
    // the wrong file. The README claimed two Aetna layouts and there was one,
    // and nothing would ever have said so.
    const sums = new Map();
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".pdf"))) {
      const sum = createHash("sha256").update(readFileSync(join(DIR, f))).digest("hex");
      assert.ok(!sums.has(sum), `${f} is byte-identical to ${sums.get(sum)}`);
      sums.set(sum, f);
    }
  });
