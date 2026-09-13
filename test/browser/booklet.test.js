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

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "node:http";
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

// ---------------------------------------------------------------------------
// The same document through the code that actually runs.
//
// Everything above reads the booklet with poppler. extract.js does not: above
// the page budget it pulls each page's text with pdf.js getTextContent and
// rebuilds lines by rounding item y-positions — "group by vertical position so
// a heading stays one line", because a flat join makes every page one line and
// findPlanSections reads line shape.
//
// Two different extractors, and only one of them ships. If pdf.js grouped lines
// differently the tests above would still pass while the app found different
// sections, or none. This is also the ONLY document in the project that reaches
// that branch at all: every SBC is under the budget, so `narrowed` is null for
// all of them and the whole path is dead code as far as the rest of the suite
// is concerned.
// ---------------------------------------------------------------------------

const WEB = join(ROOT, "web");
const PRIVATE = join(ROOT, "test-fixtures", "private");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".pdf": "application/pdf" };

let server, browser, page, origin;

before(async () => {
  if (SKIP) return;
  server = createServer(async (req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    let file = rel.startsWith("/private/") ? join(PRIVATE, rel.slice("/private/".length)) : join(WEB, rel);
    if (!file.startsWith(WEB) && !file.startsWith(PRIVATE)) { res.writeHead(403).end(); return; }
    if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(`${origin}/app`, { waitUntil: "domcontentloaded" });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
});

let live = null;
const throughTheApp = async () => (live ??= await page.evaluate(async () => {
  const { extractText } = await import("/js/extract.js");
  const blob = await (await fetch("/private/booklet.pdf")).blob();
  const out = await extractText(new File([blob], "booklet.pdf", { type: "application/pdf" }));
  return {
    pages: out.images.length,
    bytes: out.images.reduce((n, d) => n + d.length, 0),
    narrowed: out.narrowed && {
      pages: out.narrowed.pages, total: out.narrowed.total,
      sections: out.narrowed.sections.map((s) => `${s.kind}|${s.plan}|${s.start}-${s.end}`),
    },
  };
}));

test("the app narrows the booklet, and is the only thing that ever narrows anything",
  { skip: SKIP, timeout: 300_000 }, async () => {
    const r = await throughTheApp();
    assert.ok(r.narrowed, "narrowed is null — the app sent all 135 pages");
    assert.equal(r.narrowed.total, 135);
    assert.equal(r.pages, r.narrowed.pages.length);
    assert.equal(r.narrowed.pages[0], 1, "the cover is not in what the app sends");
  });

test("pdf.js and poppler find the same sections in the same places",
  { skip: SKIP, timeout: 300_000 }, async () => {
    // The claim the cheap tests above rest on. Verified 2026-09-13: identical,
    // all ten sections, same page boundaries. If this ever fails, the poppler
    // tests are measuring a document the app does not see, and they are the
    // ones to distrust.
    const r = await throughTheApp();
    const viaPoppler = findPlanSections(pages())
      .map((s) => `${s.kind}|${s.plan}|${s.start}-${s.end}`);
    assert.deepEqual(r.narrowed.sections, viaPoppler);
  });

test("narrowing is what keeps the booklet inside the callable limit",
  { skip: SKIP, timeout: 300_000 }, async () => {
    // Measured 2026-09-13: 24 pages, 3.94MB, 164KB a page — the low end of the
    // 120-500KB band in carrier-browser.test.js, because a booklet page is
    // sparse text where a benefits grid is dense colour.
    //
    // At that rate the whole 135 pages is ~22MB against a 10MB callable, which
    // is the failure this code was written for: "please try again", forever,
    // since retrying sends it again. So this is not a nice-to-have — it is the
    // only reason the document works at all, and the assertion says so by
    // checking both halves.
    const r = await throughTheApp();
    const perPage = r.bytes / r.pages;
    assert.ok(r.bytes < 10_000_000 / 2,
      `${(r.bytes / 1e6).toFixed(2)}MB narrowed — past half the callable limit`);
    assert.ok(perPage * r.narrowed.total > 10_000_000,
      `the whole document would be ${(perPage * r.narrowed.total / 1e6).toFixed(1)}MB, which fits — ` +
      `narrowing is no longer load-bearing for this file and this test has stopped meaning anything`);
  });
