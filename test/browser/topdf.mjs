// Turns fixture .html into the .pdf the plans actually upload.
//
// This step was undocumented and done by hand: the family PDFs were written
// four minutes after their HTML in 2026-08, by someone printing them from a
// browser, with nothing in the repo saying so. Anyone regenerating a fixture
// got fresh HTML and a stale PDF beside it, and the plans upload the PDF.
//
//   node test/browser/topdf.mjs test-fixtures/family/*.html
//
// Lives here because this is where Playwright is installed. Letter paper, no
// margins beyond the document's own, backgrounds on — the fixtures use ruled
// table headers and a print without backgrounds loses them.

import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node test/browser/topdf.mjs <file.html> [...]");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
for (const f of files) {
  const abs = resolve(f);
  const out = abs.replace(/\.html$/i, ".pdf");
  if (abs === out) { console.warn(`! skipping ${f} — not .html`); continue; }
  await page.goto(pathToFileURL(abs).href, { waitUntil: "networkidle" });
  await page.pdf({ path: out, format: "Letter", printBackground: true });
  console.log(`  ${out.split("/").slice(-2).join("/")}`);
}
await browser.close();
