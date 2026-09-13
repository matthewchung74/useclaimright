// Real carrier documents through the real client pipeline, in a real browser.
//
// carrier.test.js reads the same PDFs with poppler and asserts on page text.
// That is not what the app does. The app runs pdf.js, rasterises every page to
// a canvas, and hands the server a JPEG data URL per page — and the two
// extractors are not interchangeable. A document poppler reads cleanly and
// pdf.js does not would pass carrier.test.js and fail a member.
//
// Nothing here signs in, calls a model, or costs an audit: it is extractText()
// against bytes, which is the whole client half of an upload.
//
//   npm --prefix test/browser run test:carrier-browser
//
// Skips without test-fixtures/carrier/ — the PDFs are the carriers' copyright
// and gitignored. Rebuild with test-fixtures/carrier/fetch.sh.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB = join(ROOT, "web");
const CARRIER = join(ROOT, "test-fixtures", "carrier");

const SBCS = [
  "kaiser-calpers-2026.pdf",   // 14 pages, the longest we hold
  "blueshield-ppo-2026.pdf",
  "bcbsks-plan-a-2026.pdf",
  "bcbsks-plan-c-2026.pdf",
  "qhp-ks-2026.pdf",
];
const SKIP = SBCS.every((f) => existsSync(join(CARRIER, f)))
  ? false : "run test-fixtures/carrier/fetch.sh first";

// Everything fetch.sh pulls, not just the SBCs: two EOBs and four provider
// claim forms as well. They are different document classes and the client does
// not care — it renders pages — which is exactly why they belong in the
// corpus-wide check at the bottom of this file.
const everyCarrierPdf = () => SKIP ? []
  : readdirSync(CARRIER).filter((f) => f.endsWith(".pdf")).sort();

// What the client must stay under. Both are mirrored from source rather than
// retyped: MAX_IMAGE_BYTES is the server's own check, and the 10MB is the
// Firebase callable request limit, which is not ours to change.
const numberFrom = (file, name) => {
  const m = readFileSync(join(ROOT, file), "utf8").match(new RegExp(`${name}\\s*=\\s*([\\d_]+)`));
  assert.ok(m, `${name} not found in ${file}`);
  return Number(m[1].replace(/_/g, ""));
};
const MAX_IMAGE_BYTES = SKIP ? 0 : numberFrom("functions/index.js", "MAX_IMAGE_BYTES");
const MAX_PAGES = SKIP ? 0 : numberFrom("functions/index.js", "MAX_PAGES");
const CALLABLE_LIMIT = 10_000_000;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".pdf": "application/pdf" };

let server, browser, page, origin;

before(async () => {
  if (SKIP) return;
  server = createServer(async (req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    // /carrier/ is mounted read-only so the page can fetch a gitignored PDF as
    // same-origin bytes. Serving it from disk beats inlining megabytes of
    // base64 through page.evaluate.
    let file = rel.startsWith("/carrier/")
      ? join(CARRIER, rel.slice("/carrier/".length)) : join(WEB, rel);
    if (rel === "/" || rel === "\\") file = join(WEB, "index.html");
    if (!file.startsWith(WEB) && !file.startsWith(CARRIER)) { res.writeHead(403).end(); return; }
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

// One upload, measured the way the server will measure it. pdf.js is loaded
// from a CDN by extract.js, so this needs network — the same network the app
// needs to run at all.
const upload = (file) => page.evaluate(async (name) => {
  const { extractText } = await import("/js/extract.js");
  const blob = await (await fetch(`/carrier/${name}`)).blob();
  const f = new File([blob], name, { type: "application/pdf" });
  const t0 = performance.now();
  const out = await extractText(f);
  return {
    method: out.method,
    text: out.text,
    pages: out.images.length,
    narrowed: out.narrowed ?? null,
    // What actually crosses the wire: the data URLs, as the callable serialises
    // them. Measuring the decoded JPEG would understate it by a third.
    bytes: out.images.reduce((n, d) => n + d.length, 0),
    largestPage: Math.max(...out.images.map((d) => d.length)),
    ms: Math.round(performance.now() - t0),
  };
}, file);

test("every real SBC goes to the model as pages, not as a text layer",
  { skip: SKIP }, async () => {
    for (const f of SBCS) {
      const r = await upload(f);
      // These documents all HAVE a text layer — carrier.test.js proves it with
      // poppler. The client must send pages anyway: a text layer loses the
      // column association that makes a benefits table readable.
      assert.equal(r.method, "image", f);
      assert.equal(r.text, "", `${f}: sent text instead of pages`);
      assert.ok(r.pages > 0, `${f}: no pages rendered`);
    }
  });

test("pdf.js renders every page of every real SBC", { skip: SKIP }, async () => {
  // Not the same claim as "poppler found text". A page pdf.js cannot render
  // comes back as a blank canvas, which is a silent, invisible failure: the
  // upload succeeds, the model is paid, and it reads nothing.
  const expected = { "kaiser-calpers-2026.pdf": 14, "blueshield-ppo-2026.pdf": 9,
    "bcbsks-plan-a-2026.pdf": 7, "bcbsks-plan-c-2026.pdf": 8, "qhp-ks-2026.pdf": 7 };
  for (const f of SBCS) {
    const r = await upload(f);
    assert.equal(r.pages, expected[f], `${f}: page count`);
    assert.ok(r.pages <= MAX_PAGES, `${f}: ${r.pages} pages, server takes ${MAX_PAGES}`);
    assert.equal(r.narrowed, null, `${f}: narrowed, but it is under the page budget`);
  }
});

test("a real SBC fits in a callable request, with room to spare",
  { skip: SKIP }, async () => {
    // The failure this exists for: a member's 135-page booklet rendered to
    // 18.6MB against a 10MB callable limit and failed with "please try again",
    // forever, because retrying sent it again. The fix was narrowing, and
    // narrowing does nothing for an SBC — findPlanSections finds no headings in
    // one (carrier.test.js) and it is under the page budget anyway.
    //
    // So for these documents the only thing standing between a member and that
    // same dead end is that 14 dense colour pages happen to be small enough.
    // "Happen to be" is the part worth measuring, on real pages rather than on
    // the 5-page fixture the estimate came from.
    for (const f of SBCS) {
      const r = await upload(f);
      const perPage = Math.round(r.bytes / r.pages);
      const note = `${f}: ${r.pages}p, ${(r.bytes / 1e6).toFixed(2)}MB, ${Math.round(perPage / 1024)}KB/page`;
      assert.ok(r.bytes < CALLABLE_LIMIT, `${note} — over the 10MB callable limit`);
      assert.ok(r.bytes < MAX_IMAGE_BYTES, `${note} — over MAX_IMAGE_BYTES`);
      // Half the limit is the line between "fits" and "fits by luck". A carrier
      // crossing it means the next slightly longer SBC does not fit at all, and
      // that is worth failing a test over rather than finding in production.
      assert.ok(r.bytes < CALLABLE_LIMIT / 2,
        `${note} — past half the callable limit; narrowing cannot rescue an SBC`);
    }
  });

test("every carrier document renders and fits, whatever kind it is",
  { skip: SKIP }, async () => {
    // fetch.sh pulls live URLs. A carrier can replace a 7-page SBC with a
    // 40-page combined SBC-and-glossary, or serve a PDF pdf.js cannot open, and
    // the first anyone would know is a member's upload failing. The SBC tests
    // above cannot catch that for the EOBs and claim forms, so this one covers
    // the whole directory and makes no assumption about what each file is.
    const seen = [];
    for (const f of everyCarrierPdf()) {
      const r = await upload(f);
      assert.equal(r.method, "image", `${f}: not sent as pages`);
      assert.ok(r.pages > 0, `${f}: rendered no pages`);
      assert.ok(r.pages <= MAX_PAGES, `${f}: ${r.pages} pages, server takes ${MAX_PAGES}`);
      assert.ok(r.bytes < CALLABLE_LIMIT / 2,
        `${f}: ${(r.bytes / 1e6).toFixed(2)}MB, past half the callable limit`);
      seen.push(Math.round(r.bytes / r.pages / 1024));
    }
    assert.ok(seen.length >= 10, `only ${seen.length} carrier PDFs — run fetch.sh`);

    // Measured 2026-09-12 across all eleven: 215-326 KB a page, on documents as
    // different as a colour benefits grid, a two-page EOB and a fillable
    // CMS-1500. The spread is narrow because the number is a property of the
    // render scale and JPEG quality in extract.js, not of what is on the page —
    // which is what makes "the callable runs out around 35 pages" a figure
    // worth quoting rather than a guess from one document.
    const lo = Math.min(...seen), hi = Math.max(...seen);
    assert.ok(lo > 120 && hi < 500,
      `per-page payload moved out of the 120-500KB band actually measured: ${lo}-${hi}KB. ` +
      `The capacity figures in extract.js and docs/TESTING.md are derived from it.`);
  });
