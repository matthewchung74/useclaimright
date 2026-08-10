// Text extraction: pdf.js text layer for digital PDFs, tesseract.js OCR fallback
// for scans/photos. Returns { text, method: "pdf"|"ocr", confidence } where
// confidence is tesseract's mean word confidence (100 for digital PDFs).

import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const MIN_CHARS_PER_PAGE = 200; // below this average, the PDF has no useful text layer

let tesseractWorkerPromise = null;
async function getTesseract() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      const { createWorker } = await import(
        "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js"
      );
      return createWorker("eng");
    })();
  }
  return tesseractWorkerPromise;
}

async function ocrCanvas(canvas) {
  const worker = await getTesseract();
  const { data } = await worker.recognize(canvas);
  return { text: data.text, confidence: data.confidence };
}

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
  const previews = []; // rendered page images — shown locally, never transmitted
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
    return { text: pages.map((p) => p.text).join("\n\n"), method: "pdf", confidence: 100, previews };
  }

  // No usable text layer — render each page and OCR it.
  let ocrText = "";
  let confSum = 0;
  for (const { page } of pages) {
    const canvas = await renderPageToDataUrl(page, 2);
    const { text, confidence } = await ocrCanvas(canvas);
    ocrText += text + "\n\n";
    confSum += confidence;
  }
  return { text: ocrText, method: "ocr", confidence: confSum / pdf.numPages, previews };
}

async function extractFromImage(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  const previews = [canvas.toDataURL("image/jpeg", 0.85)];
  const { text, confidence } = await ocrCanvas(canvas);
  return { text, method: "ocr", confidence, previews };
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
    return { text: htmlToText(await file.text()), method: "html", confidence: 100, previews: [] };
  }
  if (file.type === "text/plain" || name.endsWith(".txt")) {
    return { text: await file.text(), method: "text", confidence: 100, previews: [] };
  }
  throw new Error(`Unsupported file type: ${file.type || file.name}. Use PDF, photo, HTML, or text.`);
}
