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
//   method "pdf" | "html" | "text" — text is authoritative, images empty
//   method "image"                 — text is "", the model reads `images`

import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const MIN_CHARS_PER_PAGE = 200; // below this average, the PDF has no useful text layer

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

async function extractFromPdf(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  const previews = []; // rendered pages: shown in the review pane, and sent when there is no text layer
  let totalChars = 0;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str).join(" ");
    pages.push({ page, text });
    totalChars += text.length;
    previews.push((await renderPageToDataUrl(page)).toDataURL("image/jpeg", 0.85));
  }

  if (totalChars / pdf.numPages >= MIN_CHARS_PER_PAGE) {
    return { text: pages.map((p) => p.text).join("\n\n"), images: [], method: "pdf", confidence: 100, previews };
  }
  // Scanned: no text worth having. Send the pages themselves.
  return { text: "", images: previews, method: "image", confidence: null, previews };
}

async function extractFromImage(file) {
  const bitmap = await createImageBitmap(file);
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
  throw new Error(`Unsupported file type: ${file.type || file.name}. Use PDF, photo, HTML, or text.`);
}
