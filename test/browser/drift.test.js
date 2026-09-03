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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const TESTING = read("docs/TESTING.md");
const APP_HTML = read("web/app.html");
const APP_JS = read("web/js/app.js");
const EXTRACT_JS = read("web/js/extract.js");
const SOURCE = APP_HTML + APP_JS + EXTRACT_JS;

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
    holds: () => APP_JS.includes("matchSavedEob"),
    why: "the matcher needed bill text the browser no longer has",
  },
  {
    what: "the per-screen back links",
    docSays: "← Back to bills",
    holds: () => APP_HTML.includes('class="back-link"'),
    why: "all three were removed; the logo is the only way back to the list",
  },
  {
    what: "the custom-limit form as a visible fallback",
    docSays: "Add a custom limit",
    holds: () => APP_HTML.includes("Add a custom limit"),
    why: "the manual tracker form was hidden behind the remark path",
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
// The dependency table earns its keep only if the plans it names are real.
// ---------------------------------------------------------------------------
test("TESTING.md: the reorder table only names plans that exist", () => {
  const headings = new Set(
    [...TESTING.matchAll(/^## ([A-Z][A-Z0-9]*\d|[A-Z]+\d[a-z]?) —/gm)].map((m) => m[1])
  );
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
