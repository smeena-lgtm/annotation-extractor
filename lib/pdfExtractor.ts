/**
 * PDF Annotation Extractor — Client-side extraction using pdf.js + Tesseract.js
 *
 * Extracts handwritten ink annotations, sticky notes, highlights, freetext,
 * underlines, strikeouts from PDF files and outputs structured Markdown.
 */

import * as pdfjsLib from "pdfjs-dist";
import Tesseract from "tesseract.js";

// ─── Types ──────────────────────────────────────────────────

export interface Annotation {
  pageNumber: number;
  type: string;
  content: string;
  author: string;
  color: string;
  ocrText: string;
  confidence: number;
  rect: number[] | null;
}

export interface ExtractionResult {
  filename: string;
  totalPages: number;
  annotations: Annotation[];
  extractionTime: string;
  ocrEngine: string;
}

export type ProgressCallback = (message: string, percent: number) => void;

// ─── Annotation Type Labels ─────────────────────────────────

const ANNOT_TYPE_MAP: Record<number, string> = {
  1: "Text (Sticky Note)",
  2: "Link",
  3: "FreeText",
  4: "Line",
  5: "Square",
  6: "Circle",
  7: "Polygon",
  8: "Polyline",
  9: "Highlight",
  10: "Underline",
  11: "Squiggly",
  12: "Strikeout",
  13: "Stamp",
  14: "Caret",
  15: "Ink (Handwritten)",
  16: "Popup",
  17: "FileAttachment",
  18: "Sound",
  19: "Movie",
  20: "Widget",
  26: "Redact",
};

// ─── Color Helpers ──────────────────────────────────────────

function rgbToHex(color: any): string {
  if (!color) return "";
  const r = Math.round((color[0] ?? 0) * 255);
  const g = Math.round((color[1] ?? 0) * 255);
  const b = Math.round((color[2] ?? 0) * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ─── Render a region of a PDF page to an image ──────────────

async function renderPageRegion(
  page: any,
  rect: number[],
  scale: number = 3.0
): Promise<HTMLCanvasElement | null> {
  try {
    const viewport = page.getViewport({ scale });
    const [x0, y0, x1, y1] = rect;

    // PDF coords are bottom-up, canvas is top-down
    const padding = 10 * scale;
    const canvasX = x0 * scale - padding;
    const canvasY = y0 * scale - padding;
    const width = (x1 - x0) * scale + padding * 2;
    const height = (y1 - y0) * scale + padding * 2;

    if (width < 5 || height < 5) return null;

    // Render full page then crop
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = viewport.width;
    fullCanvas.height = viewport.height;
    const ctx = fullCanvas.getContext("2d")!;

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Crop to the annotation region
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.max(width, 1);
    cropCanvas.height = Math.max(height, 1);
    const cropCtx = cropCanvas.getContext("2d")!;

    // White background
    cropCtx.fillStyle = "#ffffff";
    cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

    cropCtx.drawImage(
      fullCanvas,
      Math.max(canvasX, 0),
      Math.max(canvasY, 0),
      width,
      height,
      0,
      0,
      width,
      height
    );

    return cropCanvas;
  } catch {
    return null;
  }
}

// ─── OCR with Tesseract.js ──────────────────────────────────

async function ocrImage(
  canvas: HTMLCanvasElement
): Promise<{ text: string; confidence: number }> {
  try {
    const result = await Tesseract.recognize(canvas, "eng", {
      logger: () => {},
    });

    const text = result.data.text.trim();
    const confidence = result.data.confidence / 100;
    return { text, confidence: Math.round(confidence * 100) / 100 };
  } catch {
    return { text: "", confidence: 0 };
  }
}

// ─── Main Extraction Function ───────────────────────────────

export async function extractAnnotations(
  file: File,
  onProgress: ProgressCallback
): Promise<ExtractionResult> {
  // Initialize pdf.js worker
  if (typeof window !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;
  }

  onProgress("Reading PDF file...", 5);

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;

  onProgress(`Loaded ${totalPages} page(s)`, 10);

  const annotations: Annotation[] = [];
  const startTime = new Date();

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const pct = 10 + Math.floor(80 * (pageNum / totalPages));
    onProgress(`Processing page ${pageNum}/${totalPages}...`, pct);

    const page = await pdf.getPage(pageNum);
    const pageAnnotations = await page.getAnnotations();

    for (const annot of pageAnnotations) {
      const typeNum = annot.annotationType;

      // Skip popups and widgets (form fields)
      if (typeNum === 16 || typeNum === 20) continue;

      const typeName = ANNOT_TYPE_MAP[typeNum] || `Unknown (${typeNum})`;
      const content = annot.contents || annot.alternativeText || "";
      const author = annot.titleObj?.str || annot.title || "";
      const color = annot.color ? rgbToHex(annot.color) : "";
      const rect = annot.rect || null;

      let ocrText = "";
      let confidence = 0;

      // For ink (handwritten) annotations, render & OCR
      if (typeNum === 15 && rect) {
        onProgress(`OCR on ink annotation (page ${pageNum})...`, pct);
        const canvas = await renderPageRegion(page, rect);
        if (canvas) {
          const ocrResult = await ocrImage(canvas);
          ocrText = ocrResult.text;
          confidence = ocrResult.confidence;
        }
      }

      // For FreeText without embedded content, OCR the region
      if (typeNum === 3 && !content.trim() && rect) {
        const canvas = await renderPageRegion(page, rect);
        if (canvas) {
          const ocrResult = await ocrImage(canvas);
          ocrText = ocrResult.text;
          confidence = ocrResult.confidence;
        }
      }

      annotations.push({
        pageNumber: pageNum,
        type: typeName,
        content,
        author,
        color,
        ocrText,
        confidence,
        rect,
      });
    }
  }

  onProgress("Generating output...", 95);

  return {
    filename: file.name,
    totalPages,
    annotations,
    extractionTime: startTime.toISOString(),
    ocrEngine: "Tesseract.js (Browser)",
  };
}

// ─── Markdown Formatter ─────────────────────────────────────

export function formatAsMarkdown(result: ExtractionResult): string {
  const lines: string[] = [];

  const now = new Date(result.extractionTime);
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  lines.push(`# Annotation Extraction: ${result.filename}`);
  lines.push("");
  lines.push(`**Extracted:** ${dateStr}  `);
  lines.push(`**Total Pages:** ${result.totalPages}  `);
  lines.push(`**Annotations Found:** ${result.annotations.length}  `);
  lines.push(`**OCR Engine:** ${result.ocrEngine}  `);
  lines.push("");
  lines.push("---");
  lines.push("");

  if (result.annotations.length === 0) {
    lines.push("*No annotations found in this PDF.*");
    return lines.join("\n");
  }

  // Summary table
  lines.push("## Summary");
  lines.push("");
  const counts: Record<string, number> = {};
  result.annotations.forEach((a) => {
    counts[a.type] = (counts[a.type] || 0) + 1;
  });
  lines.push("| Annotation Type | Count |");
  lines.push("|----------------|-------|");
  Object.entries(counts)
    .sort()
    .forEach(([type, count]) => {
      lines.push(`| ${type} | ${count} |`);
    });
  lines.push("");
  lines.push("---");
  lines.push("");

  // Group by page
  const pages: Record<number, Annotation[]> = {};
  result.annotations.forEach((a) => {
    (pages[a.pageNumber] = pages[a.pageNumber] || []).push(a);
  });

  Object.keys(pages)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((pageNum) => {
      const pageAnns = pages[pageNum];
      lines.push(`## Page ${pageNum}`);
      lines.push("");

      pageAnns.forEach((ann, i) => {
        lines.push(`### ${ann.type} #${i + 1}`);
        lines.push("");

        const meta: string[] = [];
        if (ann.author) meta.push(`**Author:** ${ann.author}`);
        if (ann.color) meta.push(`**Color:** \`${ann.color}\``);
        if (ann.confidence > 0)
          meta.push(`**OCR Confidence:** ${Math.round(ann.confidence * 100)}%`);
        if (meta.length) {
          lines.push(meta.join(" | "));
          lines.push("");
        }

        let hasContent = false;

        if (ann.ocrText) {
          lines.push("**Recognized Handwriting:**");
          lines.push("");
          lines.push(`> ${ann.ocrText}`);
          lines.push("");
          hasContent = true;
        }

        if (ann.content) {
          const label = ann.type.includes("Sticky") ? "Note" : "Content";
          lines.push(`**${label}:**`);
          lines.push("");
          ann.content.split("\n").forEach((line) => {
            if (line.trim()) lines.push(`> ${line.trim()}`);
          });
          lines.push("");
          hasContent = true;
        }

        if (!hasContent) {
          lines.push("*(No text content extracted)*");
          lines.push("");
        }

        lines.push("---");
        lines.push("");
      });
    });

  lines.push("---");
  lines.push(
    "*Generated by Handwritten PDF Annotation Extractor — [annotation-extractor.vercel.app](https://annotation-extractor.vercel.app)*"
  );

  return lines.join("\n");
}
