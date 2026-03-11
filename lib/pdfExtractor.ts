/**
 * PDF Annotation Extractor — Client-side extraction using pdf.js + Tesseract.js
 *
 * Supports TWO extraction modes:
 *   1. Standard: reads PDF annotation objects (sticky notes, highlights, ink, etc.)
 *   2. Visual (fallback): detects flattened/embedded ink strokes via content-stream
 *      analysis — handles PDFs where annotations were burned into page content
 *      (common with iPad apps, GoodNotes, PDF Expert exports, etc.)
 *
 * Visual mode produces cropped images of each annotation region alongside
 * best-effort OCR for text-like regions.
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
  /** Base-64 data URL of the cropped annotation region (visual mode) */
  imageDataUrl: string;
  /** Classification: "text", "mark", "circle", "line" */
  shape: string;
}

export interface ExtractionResult {
  filename: string;
  totalPages: number;
  annotations: Annotation[];
  extractionTime: string;
  ocrEngine: string;
  /** true when fallback visual detection was used for at least one page */
  usedVisualDetection: boolean;
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
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function rgb255ToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ─── Annotation color classifier (0-255 RGB) ───────────────

interface ColorClass {
  name: string;
  hex: string;
}

function classifyAnnotationColor(
  r: number,
  g: number,
  b: number
): ColorClass | null {
  if (r > 160 && g < 90 && b < 90 && r - Math.max(g, b) > 70)
    return { name: "red", hex: rgb255ToHex(r, g, b) };

  if (g > 120 && r < 100 && b < 110 && g - Math.max(r, b) > 40)
    return { name: "green", hex: rgb255ToHex(r, g, b) };

  if (b > 150 && r < 100 && g < 120 && b - r > 70)
    return { name: "blue", hex: rgb255ToHex(r, g, b) };

  if (r > 180 && g > 80 && g < 170 && b < 70 && r - b > 120)
    return { name: "orange", hex: rgb255ToHex(r, g, b) };

  if (r > 160 && b > 100 && g < 80 && r + b - g * 2 > 200)
    return { name: "magenta", hex: rgb255ToHex(r, g, b) };

  return null;
}

// ─── Shape classification ───────────────────────────────────

function classifyShape(
  cluster: AnnotationCluster
): "text" | "mark" | "circle" | "line" {
  const w = cluster.maxX - cluster.minX;
  const h = cluster.maxY - cluster.minY;
  const aspect = w / Math.max(h, 1);
  const area = w * h;

  // Very small = mark (checkmark, tick, dot)
  if (area < 3000 && cluster.strokeCount < 6) return "mark";

  // Roughly square with moderate strokes = circle/shape
  if (aspect > 0.6 && aspect < 1.6 && cluster.strokeCount < 8 && area < 15000)
    return "circle";

  // Very narrow = line/arrow
  if (aspect > 6 || aspect < 0.15) return "line";

  // Everything else = text (wide enough, enough strokes)
  return "text";
}

// ─── Stroke clustering ─────────────────────────────────────

interface StrokeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  color: ColorClass;
}

interface AnnotationCluster {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  colorName: string;
  colorHex: string;
  strokeCount: number;
}

/**
 * Merge nearby strokes of the same color into clusters.
 * Larger padding = more aggressive merging (fewer, bigger regions).
 */
function clusterStrokes(
  strokes: StrokeBounds[],
  padding: number = 20
): AnnotationCluster[] {
  if (strokes.length === 0) return [];

  let clusters: AnnotationCluster[] = strokes.map((s) => ({
    minX: s.minX - padding,
    minY: s.minY - padding,
    maxX: s.maxX + padding,
    maxY: s.maxY + padding,
    colorName: s.color.name,
    colorHex: s.color.hex,
    strokeCount: 1,
  }));

  let merged = true;
  while (merged) {
    merged = false;
    const next: AnnotationCluster[] = [];
    const used = new Set<number>();

    for (let i = 0; i < clusters.length; i++) {
      if (used.has(i)) continue;
      const cur = { ...clusters[i] };

      for (let j = i + 1; j < clusters.length; j++) {
        if (used.has(j)) continue;
        if (clusters[j].colorName !== cur.colorName) continue;

        if (
          cur.minX <= clusters[j].maxX &&
          cur.maxX >= clusters[j].minX &&
          cur.minY <= clusters[j].maxY &&
          cur.maxY >= clusters[j].minY
        ) {
          cur.minX = Math.min(cur.minX, clusters[j].minX);
          cur.minY = Math.min(cur.minY, clusters[j].minY);
          cur.maxX = Math.max(cur.maxX, clusters[j].maxX);
          cur.maxY = Math.max(cur.maxY, clusters[j].maxY);
          cur.strokeCount += clusters[j].strokeCount;
          used.add(j);
          merged = true;
        }
      }

      next.push(cur);
    }

    clusters = next;
  }

  // Filter noise: require at least 2 strokes OR meaningful area
  return clusters.filter((c) => {
    const area = (c.maxX - c.minX) * (c.maxY - c.minY);
    return c.strokeCount >= 2 || area > 400;
  });
}

// ─── Render helpers ─────────────────────────────────────────

/**
 * Render the full page once, return the canvas for reuse across multiple crops.
 */
async function renderFullPage(
  page: any,
  scale: number
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/**
 * Crop a region from a pre-rendered page canvas.
 * Cluster bounds are in PDF coords (origin bottom-left).
 */
function cropRegion(
  fullCanvas: HTMLCanvasElement,
  cluster: AnnotationCluster,
  pageHeightPdf: number,
  scale: number,
  extraPad: number = 12
): HTMLCanvasElement | null {
  const pad = extraPad * scale;
  const canvasLeft = Math.max(0, cluster.minX * scale - pad);
  const canvasTop = Math.max(
    0,
    (pageHeightPdf - cluster.maxY) * scale - pad
  );
  const width = (cluster.maxX - cluster.minX) * scale + pad * 2;
  const height = (cluster.maxY - cluster.minY) * scale + pad * 2;

  if (width < 8 || height < 8) return null;

  const cropW = Math.min(Math.ceil(width), fullCanvas.width - canvasLeft);
  const cropH = Math.min(Math.ceil(height), fullCanvas.height - canvasTop);
  if (cropW < 4 || cropH < 4) return null;

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const ctx = cropCanvas.getContext("2d")!;

  ctx.drawImage(
    fullCanvas,
    canvasLeft,
    canvasTop,
    cropW,
    cropH,
    0,
    0,
    cropW,
    cropH
  );

  return cropCanvas;
}

/**
 * Preprocess a cropped region for OCR:
 * extract annotation-colored pixels as dark text on white background.
 */
function preprocessForOCR(
  canvas: HTMLCanvasElement,
  colorName: string
): HTMLCanvasElement {
  const ocrCanvas = document.createElement("canvas");
  ocrCanvas.width = canvas.width;
  ocrCanvas.height = canvas.height;
  const ctx = ocrCanvas.getContext("2d")!;

  ctx.drawImage(canvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const cls = classifyAnnotationColor(r, g, b);

    if (cls && cls.name === colorName) {
      // Annotation pixel → dark
      data[i] = 30;
      data[i + 1] = 30;
      data[i + 2] = 30;
      data[i + 3] = 255;
    } else {
      // Background → white
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return ocrCanvas;
}

/** Convert canvas to PNG data URL */
function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

// ─── Render a region of a PDF page (for standard annotations) ──

async function renderPageRegion(
  page: any,
  rect: number[],
  scale: number = 3.0
): Promise<HTMLCanvasElement | null> {
  try {
    const viewport = page.getViewport({ scale });
    const [x0, y0, x1, y1] = rect;
    const pageHeight = page.getViewport({ scale: 1 }).height;

    const padding = 10 * scale;
    const canvasLeft = x0 * scale - padding;
    const canvasTop = (pageHeight - y1) * scale - padding;
    const width = (x1 - x0) * scale + padding * 2;
    const height = (y1 - y0) * scale + padding * 2;

    if (width < 5 || height < 5) return null;

    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = viewport.width;
    fullCanvas.height = viewport.height;
    const ctx = fullCanvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.max(Math.ceil(width), 1);
    cropCanvas.height = Math.max(Math.ceil(height), 1);
    const cropCtx = cropCanvas.getContext("2d")!;

    cropCtx.fillStyle = "#ffffff";
    cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

    cropCtx.drawImage(
      fullCanvas,
      Math.max(canvasLeft, 0),
      Math.max(canvasTop, 0),
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

// ─── Content-stream analysis for flattened annotations ──────

function computeBoundsFromCoords(
  coords: number[]
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!coords || coords.length < 4) return null;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (let j = 0; j < coords.length; j += 2) {
    const x = coords[j],
      y = coords[j + 1];
    if (!isFinite(x) || !isFinite(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  if (!isFinite(minX) || !isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Detect flattened ink annotations via content-stream analysis.
 * Returns annotation objects with cropped images + OCR for text regions.
 */
async function detectFlattenedAnnotations(
  page: any,
  pageNum: number,
  onProgress: ProgressCallback,
  pct: number
): Promise<Annotation[]> {
  const ops = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;

  let strokeColor: number[] = [0, 0, 0];
  let fillColor: number[] = [0, 0, 0];
  let lastPathCoords: number[] | null = null;

  const strokes: StrokeBounds[] = [];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = ops.fnArray[i];
    const args = ops.argsArray[i];

    switch (op) {
      case OPS.setStrokeRGBColor:
        strokeColor = [args[0], args[1], args[2]];
        break;
      case OPS.setFillRGBColor:
        fillColor = [args[0], args[1], args[2]];
        break;
      case OPS.constructPath:
        lastPathCoords = args[1];
        break;
      case OPS.stroke:
        if (lastPathCoords && lastPathCoords.length >= 4) {
          const cls = classifyAnnotationColor(
            strokeColor[0],
            strokeColor[1],
            strokeColor[2]
          );
          if (cls) {
            const bounds = computeBoundsFromCoords(lastPathCoords);
            if (bounds) strokes.push({ ...bounds, color: cls });
          }
        }
        lastPathCoords = null;
        break;
      case OPS.fill:
      case OPS.eoFill:
        if (lastPathCoords && lastPathCoords.length >= 4) {
          const cls = classifyAnnotationColor(
            fillColor[0],
            fillColor[1],
            fillColor[2]
          );
          if (cls) {
            const bounds = computeBoundsFromCoords(lastPathCoords);
            if (bounds) strokes.push({ ...bounds, color: cls });
          }
        }
        lastPathCoords = null;
        break;
      default:
        break;
    }
  }

  if (strokes.length === 0) return [];

  // Cluster strokes into annotation regions
  const clusters = clusterStrokes(strokes, 20);
  if (clusters.length === 0) return [];

  onProgress(
    `Page ${pageNum}: ${clusters.length} annotation(s) found — rendering...`,
    pct
  );

  // Render page once at 2x for visual crops
  const renderScale = 2.0;
  const pageHeightPdf = page.getViewport({ scale: 1 }).height;
  const fullCanvas = await renderFullPage(page, renderScale);

  // Also render at 3x for OCR (only if we have text-like regions)
  const hasTextRegion = clusters.some(
    (c) => classifyShape(c) === "text"
  );
  let ocrCanvas: HTMLCanvasElement | null = null;
  if (hasTextRegion) {
    ocrCanvas = await renderFullPage(page, 3.0);
  }

  const annotations: Annotation[] = [];

  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    const shape = classifyShape(cluster);

    // Crop the visual image from 2x render
    const visualCrop = cropRegion(
      fullCanvas,
      cluster,
      pageHeightPdf,
      renderScale,
      10
    );
    const imageDataUrl = visualCrop ? canvasToDataUrl(visualCrop) : "";

    let ocrText = "";
    let confidence = 0;

    // Only OCR text-like regions (skip marks, circles, lines)
    if (shape === "text" && ocrCanvas) {
      const ocrCrop = cropRegion(ocrCanvas, cluster, pageHeightPdf, 3.0, 8);
      if (ocrCrop) {
        const processed = preprocessForOCR(ocrCrop, cluster.colorName);
        const result = await ocrImage(processed);
        ocrText = result.text;
        confidence = result.confidence;
      }
    }

    // Build a readable type label
    let typeLabel = "";
    switch (shape) {
      case "text":
        typeLabel = `Handwritten Note (${cluster.colorName})`;
        break;
      case "mark":
        typeLabel = `Mark / Checkmark (${cluster.colorName})`;
        break;
      case "circle":
        typeLabel = `Circle / Shape (${cluster.colorName})`;
        break;
      case "line":
        typeLabel = `Line / Arrow (${cluster.colorName})`;
        break;
    }

    annotations.push({
      pageNumber: pageNum,
      type: typeLabel,
      content: "",
      author: "",
      color: cluster.colorHex,
      ocrText,
      confidence,
      rect: [cluster.minX, cluster.minY, cluster.maxX, cluster.maxY],
      imageDataUrl,
      shape,
    });
  }

  return annotations;
}

// ─── Main Extraction Function ───────────────────────────────

export async function extractAnnotations(
  file: File,
  onProgress: ProgressCallback
): Promise<ExtractionResult> {
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
  let usedVisualDetection = false;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const pct = 10 + Math.floor(80 * (pageNum / totalPages));
    onProgress(`Processing page ${pageNum}/${totalPages}...`, pct);

    const page = await pdf.getPage(pageNum);

    // ── 1. Standard annotation objects ──
    const pageAnnotations = await page.getAnnotations();
    let standardCount = 0;

    for (const annot of pageAnnotations) {
      const typeNum = annot.annotationType;
      if (typeNum === 16 || typeNum === 20) continue;

      standardCount++;
      const typeName = ANNOT_TYPE_MAP[typeNum] || `Unknown (${typeNum})`;
      const content = annot.contents || annot.alternativeText || "";
      const author = annot.titleObj?.str || annot.title || "";
      const color = annot.color ? rgbToHex(annot.color) : "";
      const rect = annot.rect || null;

      let ocrText = "";
      let confidence = 0;

      if (typeNum === 15 && rect) {
        onProgress(`OCR on ink annotation (page ${pageNum})...`, pct);
        const canvas = await renderPageRegion(page, rect);
        if (canvas) {
          const ocrResult = await ocrImage(canvas);
          ocrText = ocrResult.text;
          confidence = ocrResult.confidence;
        }
      }

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
        imageDataUrl: "",
        shape: typeNum === 15 ? "text" : "",
      });
    }

    // ── 2. Fallback: flattened/embedded annotations ──
    if (standardCount === 0) {
      const flatAnnotations = await detectFlattenedAnnotations(
        page,
        pageNum,
        onProgress,
        pct
      );

      if (flatAnnotations.length > 0) {
        usedVisualDetection = true;
        annotations.push(...flatAnnotations);
      }
    }
  }

  onProgress("Generating output...", 95);

  return {
    filename: file.name,
    totalPages,
    annotations,
    extractionTime: startTime.toISOString(),
    ocrEngine: "Tesseract.js (Browser)",
    usedVisualDetection,
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
  if (result.usedVisualDetection) {
    lines.push(
      `**Detection Mode:** Visual (embedded ink detected via content-stream analysis)  `
    );
  }
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
          meta.push(
            `**OCR Confidence:** ${Math.round(ann.confidence * 100)}%`
          );
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
          lines.push("*(Visual annotation — see image)*");
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
