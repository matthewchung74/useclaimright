// Does TESTING.md still describe the app that exists?
//
// Every plan in TESTING.md reads as verified — most carry a "Verified on
// production" stamp with real figures. That is exactly what makes a stale claim
// dangerous: it looks authoritative while describing something deleted months
// ago. On 2026-08-29 five claims were stale at once, and every one had been
// read past repeatedly.
//
// These tests are the cheap half of the fix. They need no browser and no
// network: a claim in the doc is tied to a fact in the source, and removing the
// feature fails the run instead of quietly rotting.
//
//   node --test test/browser/drift.test.js
//
// The expensive half — layout, extraction, tap targets — is ui.test.js, which
// needs Playwright.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const TESTING = read("docs/TESTING.md");
// Comments stripped, and this is not fussiness. On 2026-09-07 the doc claimed the
// manual tracker form is labelled "Add a custom limit"; it is labelled "Add a limit
// the insurer mentioned", and the old phrase survives ONLY inside an app.html comment
// explaining the rename. So the check passed on the very sentence recording that the
// claim had stopped being true — a doc-drift suite kept alive by the changelog it was
// meant to catch. A claim must be held to what the app RENDERS, never to its history.
const stripComments = (s) =>
  s.replace(/<!--[\s\S]*?-->/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const APP_HTML = stripComments(read("web/app.html"));
const APP_JS = stripComments(read("web/js/app.js"));
const EXTRACT_JS = stripComments(read("web/js/extract.js"));

// Two kinds of text mention a feature, and only one is a claim about today:
//
//   an ASSERTION  — a line carrying ✓, i.e. "this is what you should see now"
//   a RECORD      — "Verified on production 2026-08-25: the banner fired"
//
// A record naming a since-removed feature is correct history and must survive;
// an assertion naming one is a lie the next reader will act on. Struck-through
// text (~~…~~) is history by construction. Scoping to ✓ lines is what lets a
// fix keep its own account of what it replaced.
// *(...)* italic parentheticals are this doc's convention for "why this
// changed" asides, and a correction usually quotes the wording it replaces —
// "Was 'the text layer is read directly' until 2026-08-29". Left in, the
// repudiated phrase reads as a live claim and the fix fails its own check.
const live = TESTING.replace(/~~[\s\S]*?~~/g, "");
const assertionLines = live
  .split("\n")
  .filter((l) => l.includes("✓"))
  .map((l) => l.replace(/\*\([^)]*\)\*/g, ""));
const assertions = assertionLines.join("\n");

const mentions = (phrase) => assertions.includes(phrase);

// One definition of each, because two tests below disagreed about what a plan id
// looks like — a doc-drift suite quietly disagreeing with itself is the failure
// it exists to prevent.
const PLAN_ID_HEADING = /^## ([A-Z][A-Z0-9]*\d[a-z]?) —/gm;
const PLAN_ID_ROW = /^\| ([A-Z][A-Z0-9]*\d[a-z]?) \|/gm;
const RUN_LOG = live.slice(live.indexOf("## Run log"), live.indexOf("## What you can reorder"));
const planHeadings = () => [...TESTING.matchAll(PLAN_ID_HEADING)].map((m) => m[1]);
const runLogPlans = () => [...RUN_LOG.matchAll(PLAN_ID_ROW)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// Claims that were stale on 2026-08-29, each tied to the fact it depends on.
// Add a row whenever a plan starts asserting something a grep can confirm.
// ---------------------------------------------------------------------------
const CLAIMS = [
  {
    what: "the 📷 scan banner",
    docSays: "📷 banner",
    holds: () => APP_HTML.includes('id="ocr-banner"'),
    why: "the banner was removed when every document became page images",
  },
  {
    what: "the pre-send mismatched-pair banner",
    docSays: "pair-banner",
    holds: () => APP_HTML.includes('id="pair-banner"'),
    why: "the pre-send guard was removed; the report-side one replaced it",
  },
  {
    what: "reading the PDF text layer in the browser",
    docSays: "text layer is read directly",
    holds: () => EXTRACT_JS.includes("getTextContent"),
    why: "PDFs are sent as page images; the browser reads no text layer",
  },
  {
    what: "the saved-EOB content matcher",
    docSays: "matched by provider and service date",
    holds: () => false, // deleted with its caller; the doc must not claim it
    why: "the matcher needed bill text the browser no longer has",
  },
  {
    what: "the per-screen back links",
    // Two spellings, because R2 said "a back link ABOVE the fold" and survived
    // the first sweep, which only looked for the arrow form.
    docSays: "back link",
    holds: () => APP_HTML.includes('class="back-link"'),
    why: "all three were removed; the logo is the only way back to the list",
  },
  {
    what: "the custom-limit form as a visible fallback",
    docSays: "Add a custom limit",
    holds: () => APP_HTML.includes("Add a custom limit"),
    why: "the manual tracker form was renamed to 'Add a limit the insurer mentioned'",
  },
  {
    // Its element id is already covered above, but E6 step 2 quoted the banner's
    // WORDS and not `#pair-banner`, so the id check sailed past it and the plan
    // went on telling you to look for a banner that had been deleted.
    what: "the pre-send mismatched-pair banner, by its wording",
    docSays: "may not cover this bill** (",
    holds: () => APP_HTML.includes('id="pair-banner"'),
    why: "the pre-send guard was removed; only the report-side warning remains",
  },
];

for (const c of CLAIMS) {
  test(`TESTING.md: ${c.what}`, () => {
    if (!mentions(c.docSays)) return; // claim already removed or struck through
    assert.ok(
      c.holds(),
      `TESTING.md still claims "${c.docSays}" but ${c.why}.\n` +
        `Either restore the feature or strike the claim through with ~~…~~ and say what replaced it.`
    );
  });
}

// ---------------------------------------------------------------------------
// Mechanical and general: an element id the doc names must exist. This is what
// would have caught #ocr-banner and #pair-banner without anyone predicting it.
// ---------------------------------------------------------------------------
test("TESTING.md: every element id it names exists in app.html", () => {
  const ids = new Set();
  // `#some-id` in backticks — the form the doc uses when it means an element.
  for (const m of live.matchAll(/`#([a-z][a-z0-9-]{2,})`/g)) ids.add(m[1]);
  const missing = [...ids].filter((id) => !APP_HTML.includes(`id="${id}"`));
  assert.deepEqual(
    missing,
    [],
    `TESTING.md names element ids that no longer exist: ${missing.join(", ")}`
  );
});

// ---------------------------------------------------------------------------
// The run log answers "have I done this?" — so it must not answer twice. A
// stale "not run" row survived beside a fresh result on 2026-08-31 because the
// new row was inserted rather than replacing the old one, and the table then
// said both things about FAM3.
// ---------------------------------------------------------------------------
test("TESTING.md: the run log lists each plan exactly once", () => {
  const seen = new Map();
  for (const p of runLogPlans()) seen.set(p, (seen.get(p) || 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([p, n]) => `${p} x${n}`);
  assert.deepEqual(dupes, [], `run log contradicts itself: ${dupes.join(", ")}`);
});

test("TESTING.md: every plan has a run-log row", () => {
  const rows = new Set(runLogPlans());
  const missing = planHeadings().filter((h) => !rows.has(h));
  assert.deepEqual(missing, [], `plans with no run-log row, so their status is invisible: ${missing.join(", ")}`);
});

// ---------------------------------------------------------------------------
// The dependency table earns its keep only if the plans it names are real.
// ---------------------------------------------------------------------------
test("TESTING.md: the reorder table only names plans that exist", () => {
  const headings = new Set(planHeadings());
  const table = live.slice(
    live.indexOf("## What you can reorder"),
    live.indexOf("**Automated tests first:**")
  );
  const named = new Set([...table.matchAll(/\*\*([A-Z][A-Z0-9]*\d[a-z]?)\*\*/g)].map((m) => m[1]));
  const unknown = [...named].filter((p) => !headings.has(p));
  assert.deepEqual(unknown, [], `reorder table names plans with no section: ${unknown.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Fixtures the plans tell you to upload have to be there. by-plan/ is derived,
// so this also proves gen-by-plan.mjs was re-run after a fixture changed.
// ---------------------------------------------------------------------------
test("by-plan fixtures exist for every plan folder the docs reference", async () => {
  const { existsSync, readdirSync } = await import("node:fs");
  const dir = join(ROOT, "test-fixtures", "by-plan");
  assert.ok(existsSync(dir), "run: node test-fixtures/gen-by-plan.mjs");
  const empty = readdirSync(dir).filter((plan) => {
    const files = readdirSync(join(dir, plan));
    return files.length === 0;
  });
  assert.deepEqual(empty, [], `by-plan folders with nothing in them: ${empty.join(", ")}`);
});

// A substring check on markup, so it belongs here rather than in the browser
// tier — it was paying for Chromium, a local server and a page load to grep
// two ids out of app.html.
test("the removed banners stay removed", () => {
  const back = ["ocr-banner", "pair-banner"].filter((id) => APP_HTML.includes(`id="${id}"`));
  assert.deepEqual(back, [], `re-added banners: ${back.join(", ")} — update TESTING.md too`);
});

// The generator is a fourth copy of the plan list, and drift.test.js was
// checking the other three against each other but not against it. FAM5 and
// PHONE1 already had no folder and nothing failed.
test("every plan has a by-plan fixture folder", () => {
  const dirs = new Set(
    readdirSync(join(ROOT, "test-fixtures", "by-plan"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name.split("-")[0])
  );
  const missing = planHeadings().filter((p) => !dirs.has(p));
  assert.deepEqual(missing, [],
    `plans with no by-plan/ folder — their Data: line points nowhere: ${missing.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Analytics: an event that fires and is written down nowhere is an event nobody
// will look at, and the funnel in ANALYTICS.md is the only place the numbers are
// given meaning. This is cheaper than noticing six months later that the one
// ratio the business rests on was never being read.
// ---------------------------------------------------------------------------
test("ANALYTICS.md documents every event app.js fires", () => {
  const ANALYTICS = read("docs/ANALYTICS.md");
  const fired = [...new Set([...APP_JS.matchAll(/\btrack\("([a-z_]+)"/g)].map((m) => m[1]))];
  const undocumented = fired.filter((e) => !ANALYTICS.includes(`\`${e}\``));
  assert.deepEqual(undocumented, [],
    `events fired but absent from the funnel table in docs/ANALYTICS.md: ${undocumented.join(", ")}`);
});

// The reason vocabulary is fixed on purpose — a free-text reason turns the error
// funnel into a pile of unique strings. Same argument as above: if a slug exists
// in the code and not the doc, nobody knows what they are looking at.
test("ANALYTICS.md documents every error_shown reason", () => {
  const ANALYTICS = read("docs/ANALYTICS.md");
  const block = APP_JS.slice(APP_JS.indexOf("const ERROR_REASONS"), APP_JS.indexOf("const auditShape"));
  const slugs = [...new Set([...block.matchAll(/,\s*"([a-z_]+)"\]/g)].map((m) => m[1]))];
  const missing = slugs.filter((s) => !ANALYTICS.includes(`\`${s}\``));
  assert.deepEqual(missing, [],
    `error_shown reasons in app.js that ANALYTICS.md never names: ${missing.join(", ")}`);
});

// The sample is the one report a prospect sees, and it is served from a frozen
// fixture. A finding type renamed server-side would render there as an
// unlabelled group — on the marketing path, where nobody is looking.
test("the sample fixture only uses finding types the schema still defines", () => {
  const fixture = JSON.parse(read("web/sample-audit.json"));
  const schema = read("functions/schema.js");
  const unknown = fixture.findings.map((f) => f.type).filter((t) => !schema.includes(`"${t}"`));
  assert.deepEqual(unknown, [],
    `web/sample-audit.json uses finding types functions/schema.js no longer defines: ${unknown.join(", ")}`);
});

// A placeholder in a footer link ships silently: the page renders, the link is
// blue, and it 404s for everyone. Nothing else in the suite looks at hrefs.
test("no placeholder URLs in the landing page", () => {
  const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");
  const bad = [...html.matchAll(/href="([^"]*(?:YOUR-|TODO|EXAMPLE|xxx|placeholder)[^"]*)"/gi)]
    .map((m) => m[1]);
  assert.deepEqual(bad, [],
    "set the real URL before this ships — a placeholder link is a 404 with a nice colour");
});

// The tier table and the plan headings are two lists of the same fact — which
// plans an agent must not run — and two lists of the same fact drift. That is
// the whole premise of this file: a plan marked optional in one place and not
// the other reads as un-run rather than deliberately skipped, which is how a
// suite starts looking incomplete forever.
test("the plans marked as needing a person match the tier-3 table", () => {
  const tier3 = TESTING.slice(
    TESTING.indexOf("### 3 — Needs a person"),
    TESTING.indexOf("## Run log"));
  // "| **A1** |" and "| **R2**, step 1 only |" — the bolded id in the first cell.
  const listed = new Set([...tier3.matchAll(/^\|\s*\*\*([A-Z]+[0-9]*)\*\*/gm)].map((m) => m[1]));

  const marked = new Set([...TESTING.matchAll(
    /^## ([A-Z]+[0-9]*[a-z]?) —[^\n]*(?:OPTIONAL|needs? a person)/gm)].map((m) => m[1]));

  assert.deepEqual([...marked].sort(), [...listed].sort(),
    `headings marked as needing a person: ${[...marked].sort()}; ` +
    `rows in the tier-3 table: ${[...listed].sort()}`);
  assert.ok(listed.size > 0, "the tier-3 table has no rows — did the section move?");
});

// asDoc(null) returns { text: "", images: [] }, so `!payload.eob` is false for
// every audit ever run — a truthiness test against a function that always
// returns an object. The bill-only report therefore told people "the bill and
// EOB appear consistent" about a document they had just said they do not have,
// for months after the copy was fixed, because nothing reached the copy.
//
// Found on production 2026-09-13 running E2. The lesson generalises past this
// one line: anything asked "was there an EOB?" must ask what the model
// transcribed, never whether a wrapper object exists.
test("the no-EOB decision is never made by testing an asDoc() wrapper", () => {
  const asDocReturnsObject = /const asDoc = \(d\) =>[^\n]*\{ text:/.test(APP_JS);
  assert.ok(asDocReturnsObject,
    "asDoc no longer always returns an object — re-read this test before trusting it");

  const bad = [...APP_JS.matchAll(/noEob:\s*!([A-Za-z_$][\w$.]*)/g)]
    .map((m) => m[1])
    .filter((expr) => !/^auditText$/.test(expr.split("(")[0]));
  assert.deepEqual(bad, [],
    `noEob computed from ${bad.join(", ")} — asDoc() always returns an object, so a ` +
    `truthiness test on payload.eob is always true. Use auditText(data, "eob").`);
});

// The same lesson as the asDoc test above, one rung further out: a report
// warning is only worth anything if every path that renders a report computes
// it. noEob was correct for months and fired on nothing, because one call site
// had it and the code that ran did not.
//
// renderReport is reached three ways — a fresh single audit, an audit re-opened
// from history, and the signed-out sample. The sample deliberately passes no
// flags (it is a made-up bill and says so on screen), so the two real paths are
// the ones that must carry billUnidentified.
test("every real report path decides whether the bill could be identified", () => {
  assert.match(APP_JS, /const unidentifiedBill = \(data\) =>\s*\n?\s*!String\(data\?\.provider/,
    "unidentifiedBill no longer reads provider — re-read this test before trusting it");

  const wired = [...APP_JS.matchAll(/billUnidentified:\s*unidentifiedBill\(data\)/g)].length;
  assert.equal(wired, 2,
    `billUnidentified is computed at ${wired} of the 2 real renderReport call sites ` +
    `(fresh audit, and openAudit from history). A warning wired into one path is a ` +
    `warning nobody sees on the other.`);

  assert.match(APP_JS, /\$\("report-thin-warning"\)\.hidden = !billUnidentified;/,
    "report-thin-warning is no longer toggled from billUnidentified");
  assert.ok(readFileSync(new URL("../../web/app.html", import.meta.url), "utf8")
    .includes('id="report-thin-warning"'), "report-thin-warning is missing from app.html");
});
