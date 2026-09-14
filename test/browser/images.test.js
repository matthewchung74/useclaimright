// IMG1, as a test instead of a checklist.
//
// The plan says "0 audits — extraction is what is under test, not the model",
// and records that it was verified by calling extractText on each file by hand.
// That is a test someone typed into a browser console and then wrote down. It
// runs here now, on every `npm test`, in real Chromium, against the same files.
//
//   npm --prefix test/browser run test:images
//
// Fixtures live in test-fixtures/by-plan/IMG1-image-edge-cases/, which is
// generated and gitignored — `pretest` rebuilds it via gen-by-plan.mjs, and
// these skip if it has not been run.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB = join(ROOT, "web");
const IMG = join(ROOT, "test-fixtures", "by-plan", "IMG1-image-edge-cases");

// Every image IMG1 expects to be ACCEPTED, and what Chrome reports for it.
const ACCEPTED = [
  "01-normal-scan.png", "02-rotated-90.png", "03-upside-down.png",
  "05-screenshot.png", "06-low-res.png", "07-full-res-phone.png",
  "08-eob-page-1.png",
];
const HEIC = "04-iphone.heic";

const SKIP = existsSync(join(IMG, ACCEPTED[0]))
  ? false : "run `node test-fixtures/gen-by-plan.mjs` first";

// The exact sentence the plan demands, read out of the source so the test
// cannot drift from the message a member is shown.
const HEIC_MESSAGE = SKIP ? "" : (() => {
  const m = readFileSync(join(ROOT, "web/js/extract.js"), "utf8")
    .match(/const HEIC_MESSAGE\s*=\s*([\s\S]*?);\n/);
  assert.ok(m, "HEIC_MESSAGE not found in extract.js");
  // Concatenated string literals — pull the quoted pieces and join them.
  return [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((q) => q[1]).join("");
})();

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".pdf": "application/pdf",
  // Deliberately NOT image/heic. Chrome reports application/octet-stream for a
  // .heic file with no type, which is the route that used to reach the generic
  // "unsupported file type" message instead of the useful one.
  ".heic": "application/octet-stream" };

let server, browser, page, origin;

before(async () => {
  if (SKIP) return;
  server = createServer(async (req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    let file = rel.startsWith("/img/") ? join(IMG, rel.slice("/img/".length)) : join(WEB, rel);
    if (!file.startsWith(WEB) && !file.startsWith(IMG)) { res.writeHead(403).end(); return; }
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

// Mirrors what the dropzone does: hand extractText a File built from the bytes,
// with whatever type the browser reports for it.
const extract = (name) => page.evaluate(async (f) => {
  const { extractText } = await import("/js/extract.js");
  const res = await fetch(`/img/${f}`);
  const blob = await res.blob();
  const file = new File([blob], f, { type: blob.type });
  try {
    const out = await extractText(file);
    return { ok: true, reportedType: file.type, method: out.method,
      text: out.text, pages: out.images.length,
      bytes: out.images.reduce((n, d) => n + d.length, 0) };
  } catch (e) {
    return { ok: false, reportedType: file.type, message: e.message };
  }
}, name);

test("every image IMG1 accepts becomes exactly one page render",
  { skip: SKIP, timeout: 180_000 }, async () => {
    for (const f of ACCEPTED) {
      const r = await extract(f);
      assert.ok(r.ok, `${f}: threw — ${r.message}`);
      assert.equal(r.method, "image", f);
      assert.equal(r.pages, 1, `${f}: expected one render`);
      // An image has no text layer, and a non-empty string here would mean
      // something is being sent that the reviewer never saw on the page.
      assert.equal(r.text, "", `${f}: carried text as well as pixels`);
      assert.ok(r.bytes > 0, `${f}: empty render`);
    }
  });

test("a rotated or upside-down page is accepted, not rejected",
  { skip: SKIP, timeout: 180_000 }, async () => {
    // The point of IMG1, and easy to get backwards: the app must NOT refuse
    // these. Orientation is the reviewer's call on the review screen, before an
    // audit is spent — refusing them would remove that judgement and reject
    // documents that are perfectly readable once turned around.
    for (const f of ["02-rotated-90.png", "03-upside-down.png"]) {
      const r = await extract(f);
      assert.ok(r.ok, `${f}: refused, but orientation is the reviewer's call`);
      assert.equal(r.pages, 1, f);
    }
  });

test("a HEIC photo is refused with the message that tells you what to do",
  { skip: SKIP, timeout: 180_000 }, async () => {
    // Chrome reports application/octet-stream for .heic — no type at all — so
    // this never reached the image branch and fell through to "Unsupported file
    // type", which tells a member nothing they can act on. It is also the
    // likeliest single thing a person photographing a bill will hand us.
    const r = await extract(HEIC);
    assert.equal(r.reportedType, "application/octet-stream",
      "Chrome now reports a type for .heic — re-read this test before trusting it");
    assert.equal(r.ok, false, "HEIC was accepted; the browser cannot decode it");
    assert.equal(r.message, HEIC_MESSAGE);
    assert.match(r.message, /Settings → Camera → Formats/,
      "the refusal no longer names the setting that fixes it");
    assert.doesNotMatch(r.message, /Unsupported file type/,
      "fell through to the generic message");
  });
