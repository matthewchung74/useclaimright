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

async function extractFromPdf(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  let totalChars = 0;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str).join(" ");
    pages.push({ page, text });
    totalChars += text.length;
  }

  if (totalChars / pdf.numPages >= MIN_CHARS_PER_PAGE) {
    return { text: pages.map((p) => p.text).join("\n\n"), method: "pdf", confidence: 100 };
  }

  // No usable text layer — render each page and OCR it.
  let ocrText = "";
  let confSum = 0;
  for (const { page } of pages) {
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const { text, confidence } = await ocrCanvas(canvas);
    ocrText += text + "\n\n";
    confSum += confidence;
  }
  return { text: ocrText, method: "ocr", confidence: confSum / pdf.numPages };
}

async function extractFromImage(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  const { text, confidence } = await ocrCanvas(canvas);
  return { text, method: "ocr", confidence };
}

export async function extractText(file) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return extractFromPdf(file);
  }
  if (file.type.startsWith("image/")) {
    return extractFromImage(file);
  }
  throw new Error(`Unsupported file type: ${file.type || file.name}`);
}
