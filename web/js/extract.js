import { findPlanSections, selectSchedulePages, pagesOf } from "./sections.js";

// Getting a document ready to audit.
//
// A digital PDF carries its own text layer, so we read it directly: free,
// instant, and exact. A scan or a photo carries nothing, and this used to fall
// back to tesseract.js — a ~20MB download that produced mangled text on
// anything worse than a clean scanner output, and then fed that mangled text
// to both the audit AND the checks meant to protect it.
//
// Those pages now go to the model as images. It reads a page far better than
// tesseract does, and returns its transcription with the findings, which gives
// back everything the extracted text was needed for.
//
// Returns { text, images, method, confidence, previews }:
//   method "image"                — PDFs and photos: text is "", the model reads `images`
//   method "html" | "text"        — nothing to render, so the text IS the document

import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";


async function renderPageToDataUrl(page, scale = 1.5) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  // intent "print" skips requestAnimationFrame pacing — display-intent renders
  // freeze indefinitely in hidden tabs (Chrome pauses rAF), stalling extraction
  // for anyone who switches tabs during "Reading your documents…".
  await page.render({ canvasContext: canvas.getContext("2d"), viewport, intent: "print" }).promise;
  return canvas;
}

// Every PDF goes to the model as PAGES, never as an extracted text layer.
//
// Measured 2026-08-27 on two documents, both ways: the image path reproduced
// every figure exactly — a $822.15 audit down to its three findings, and a
// 5-page SBC's plan year, deductible and OOP max — while costing 1.32x on the
// multi-page one and LESS multiple as pages grow (1.44x on one page, 1.20x on
// five; the fixed prompt overhead amortises). On the SBC it extracted MORE
// structure, 17 cost-share rows against 13, which is what you would expect when
// a table survives instead of being serialised into a line of numbers.
//
// What that buys, beyond a third of a cent: a text layer throws away column
// association, and an EOB is a table. It also removes the whole class of bug
// where a page looks perfect and its text layer is garbage — invisible until
// the audit comes back wrong.
// The server takes 20 pages; a Firebase callable takes 10MB, which at ~106KB a
// page runs out around 70. Neither was ever hit by a fixture, because every
// fixture is a 5-8 page SBC. A member's real plan booklet is 135 pages, and it
// failed with "please try again" — forever, since retrying sends it again.
const PAGE_BUDGET = 24;

async function extractFromPdf(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;

  // Narrow BEFORE rendering. Rendering 135 pages to canvas first and discarding
  // most of them is seconds of a frozen tab for nothing.
  let wanted = null, sections = null;
  if (pdf.numPages > PAGE_BUDGET) {
    const text = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      // Group by vertical position so a heading stays one line: findPlanSections
      // reads line shape, and a flat join makes every page a single line.
      const lines = new Map();
      for (const it of content.items) {
        const y = Math.round(it.transform?.[5] ?? 0);
        lines.set(y, (lines.get(y) || "") + (it.str || ""));
      }
      text.push([...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, l]) => l).join("\n"));
    }
    sections = findPlanSections(text);
    const picked = pagesOf(selectSchedulePages(sections, PAGE_BUDGET));
    if (picked.length) wanted = picked;
  }

  const pages = wanted ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  const previews = [];
  for (const n of pages) {
    previews.push((await renderPageToDataUrl(await pdf.getPage(n))).toDataURL("image/jpeg", 0.85));
  }
  return {
    text: "", images: previews, method: "image", confidence: null, previews,
    // What the review screen needs to tell the truth about what is being sent.
    // `narrowed` null means the whole document goes, as it always has.
    narrowed: wanted && { pages: wanted, total: pdf.numPages, sections },
  };
}

// Apple's camera default since iOS 11, and the likeliest thing someone
// photographing a bill will hand us. Browsers disagree about it in a way that
// matters: Chrome reports no MIME type at all (application/octet-stream), while
// others report image/heic and then fail to decode it. Both routes have to end
// at the same sentence, or the second one surfaces "The source image could not
// be decoded" — which tells a person nothing they can act on.
const HEIC_RE = /\.hei[cf]$/i;
const HEIC_MESSAGE =
  "iPhone photos in HEIC format can't be read by the browser. On your iPhone: " +
  "Settings → Camera → Formats → Most Compatible, then retake it. Or open the photo " +
  "on a Mac and File → Export as JPEG.";

async function extractFromImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    // Safari decodes HEIC and never lands here; the browsers that don't, do.
    if (HEIC_RE.test(file.name)) throw new Error(HEIC_MESSAGE);
    throw e;
  }
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  const previews = [canvas.toDataURL("image/jpeg", 0.85)];
  return { text: "", images: previews, method: "image", confidence: null, previews };
}

function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style").forEach((el) => el.remove());
  // innerText preserves visual line breaks reasonably well.
  return doc.body.innerText.replace(/\n{3,}/g, "\n\n").trim();
}

export async function extractText(file) {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return extractFromPdf(file);
  }
  if (file.type.startsWith("image/")) {
    return extractFromImage(file);
  }
  if (file.type === "text/html" || name.endsWith(".html") || name.endsWith(".htm")) {
    return { text: htmlToText(await file.text()), images: [], method: "html", confidence: 100, previews: [] };
  }
  if (file.type === "text/plain" || name.endsWith(".txt")) {
    return { text: await file.text(), images: [], method: "text", confidence: 100, previews: [] };
  }
  // The Chrome route: no MIME type at all, so it never reached the image branch.
  if (HEIC_RE.test(name)) throw new Error(HEIC_MESSAGE);
  throw new Error(`Unsupported file type: ${file.type || file.name}. Use PDF, photo, HTML, or text.`);
}
