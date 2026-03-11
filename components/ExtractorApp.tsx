"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  extractAnnotations,
  formatAsMarkdown,
  type ExtractionResult,
  type ProgressCallback,
} from "@/lib/pdfExtractor";

// ─── Icons (inline SVG to avoid extra deps) ──────────────────

function UploadIcon() {
  return (
    <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ animation: "spin 1s linear infinite" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path strokeLinecap="round" d="M12 3a9 9 0 019 9" />
    </svg>
  );
}

// ─── Main App Component ──────────────────────────────────────

export default function ExtractorApp() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ message: "", percent: 0 });
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Drop Zone Handlers ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === "application/pdf") {
      setFile(droppedFile);
      setResult(null);
      setMarkdown("");
      setError("");
    } else {
      setError("Please drop a PDF file.");
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setResult(null);
      setMarkdown("");
      setError("");
    }
  }, []);

  // ── Extraction ──
  const handleExtract = useCallback(async () => {
    if (!file || processing) return;
    setProcessing(true);
    setError("");
    setProgress({ message: "Starting...", percent: 0 });

    try {
      const onProgress: ProgressCallback = (message, percent) => {
        setProgress({ message, percent });
      };

      const extractionResult = await extractAnnotations(file, onProgress);
      setResult(extractionResult);

      const md = formatAsMarkdown(extractionResult);
      setMarkdown(md);
      setProgress({ message: "Done!", percent: 100 });
    } catch (err: any) {
      setError(err.message || "Extraction failed");
      setProgress({ message: "Error", percent: 0 });
    } finally {
      setProcessing(false);
    }
  }, [file, processing]);

  // ── Download Markdown ──
  const handleDownload = useCallback(() => {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file?.name.replace(".pdf", "")}_annotations.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [markdown, file]);

  // ── Copy to Clipboard ──
  const handleCopy = useCallback(async () => {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [markdown]);

  // ── Reset ──
  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setMarkdown("");
    setError("");
    setProgress({ message: "", percent: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* ── Header ── */}
      <header style={{
        borderBottom: "1px solid var(--border)",
        padding: "20px 0",
      }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 24px" }}>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--text)",
            letterSpacing: "-0.02em",
          }}>
            <span style={{ color: "var(--accent)" }}>Annotation</span> Extractor
          </h1>
          <p style={{
            fontSize: 13,
            color: "var(--text-dim)",
            marginTop: 4,
          }}>
            Extract handwritten &amp; digital annotations from PDFs into Markdown
          </p>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px 80px" }}>

        {/* ── Drop Zone ── */}
        {!result && (
          <div className="fade-in">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 16,
                padding: "48px 24px",
                textAlign: "center",
                cursor: "pointer",
                background: dragging ? "rgba(91, 110, 245, 0.05)" : "var(--bg-card)",
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ color: dragging ? "var(--accent)" : "var(--text-dim)", marginBottom: 16 }}>
                <UploadIcon />
              </div>
              <p style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
                Drop your PDF here
              </p>
              <p style={{ fontSize: 13, color: "var(--text-dim)" }}>
                or click to browse — supports annotated PDFs with ink, highlights, notes
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileSelect}
                style={{ display: "none" }}
              />
            </div>

            {/* ── Selected File ── */}
            {file && (
              <div style={{
                marginTop: 16,
                padding: "14px 18px",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
              className="fade-in"
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "var(--accent)" }}><FileIcon /></span>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{file.name}</p>
                    <p style={{ fontSize: 12, color: "var(--text-dim)" }}>{formatFileSize(file.size)}</p>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleReset(); }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    fontSize: 18,
                    padding: "4px 8px",
                  }}
                >
                  ×
                </button>
              </div>
            )}

            {/* ── Error ── */}
            {error && (
              <div style={{
                marginTop: 12,
                padding: "12px 16px",
                background: "rgba(248, 113, 113, 0.08)",
                border: "1px solid rgba(248, 113, 113, 0.2)",
                borderRadius: 10,
                color: "var(--red)",
                fontSize: 13,
              }}
              className="fade-in"
              >
                {error}
              </div>
            )}

            {/* ── Extract Button ── */}
            {file && !processing && (
              <button
                onClick={handleExtract}
                className="fade-in"
                style={{
                  marginTop: 20,
                  width: "100%",
                  padding: "14px",
                  background: "var(--accent)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = "var(--accent-light)")}
                onMouseOut={(e) => (e.currentTarget.style.background = "var(--accent)")}
              >
                Extract Annotations
              </button>
            )}

            {/* ── Progress ── */}
            {processing && (
              <div style={{ marginTop: 20 }} className="fade-in">
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 10,
                }}>
                  <SpinnerIcon />
                  <span style={{ fontSize: 13, color: "var(--text-dim)" }}>
                    {progress.message}
                  </span>
                </div>
                <div style={{
                  height: 4,
                  background: "var(--bg-surface)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${progress.percent}%`,
                    background: "var(--accent)",
                    borderRadius: 2,
                    transition: "width 0.3s ease",
                  }} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Results ── */}
        {result && (
          <div className="fade-in">
            {/* Stats bar */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}>
              {(() => {
                const hasVisual = result.usedVisualDetection;
                const textCount = result.annotations.filter((a) => a.shape === "text" || a.type.includes("Handwritten")).length;
                const markCount = result.annotations.filter((a) => a.shape === "mark").length;
                const shapeCount = result.annotations.filter((a) => a.shape === "circle" || a.shape === "line").length;
                const pagesWithAnnotations = new Set(result.annotations.map((a) => a.pageNumber)).size;

                return [
                  { label: "Total Annotations", value: result.annotations.length },
                  { label: "Pages with Marks", value: `${pagesWithAnnotations} / ${result.totalPages}` },
                  { label: "Text Notes", value: textCount },
                  { label: "Marks & Shapes", value: markCount + shapeCount },
                  ...(hasVisual ? [{ label: "Detection", value: "Visual" }] : []),
                ];
              })().map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    padding: "14px 16px",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                  }}
                >
                  <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>
                    {stat.value}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
              <button
                onClick={handleDownload}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 20px",
                  background: "var(--accent)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <DownloadIcon /> Download .md
              </button>
              <button
                onClick={handleCopy}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 20px",
                  background: "var(--bg-surface)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? "Copied!" : "Copy Markdown"}
              </button>
              <button
                onClick={handleReset}
                style={{
                  marginLeft: "auto",
                  padding: "10px 20px",
                  background: "none",
                  color: "var(--text-dim)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                New File
              </button>
            </div>

            {/* ── Visual Annotation Cards (grouped by page) ── */}
            {result.usedVisualDetection && (() => {
              const pages: Record<number, typeof result.annotations> = {};
              result.annotations.forEach((a) => {
                (pages[a.pageNumber] = pages[a.pageNumber] || []).push(a);
              });

              return Object.keys(pages)
                .map(Number)
                .sort((a, b) => a - b)
                .map((pageNum) => (
                  <div key={pageNum} style={{ marginBottom: 24 }}>
                    <h3 style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: "var(--text)",
                      marginBottom: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}>
                      <span style={{
                        background: "var(--accent)",
                        color: "#fff",
                        borderRadius: 6,
                        padding: "2px 8px",
                        fontSize: 12,
                      }}>
                        Page {pageNum}
                      </span>
                      <span style={{ color: "var(--text-dim)", fontWeight: 400, fontSize: 12 }}>
                        {pages[pageNum].length} annotation{pages[pageNum].length !== 1 ? "s" : ""}
                      </span>
                    </h3>

                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                      gap: 12,
                    }}>
                      {pages[pageNum].map((ann, idx) => {
                        const colorDot = ann.color || "#888";
                        return (
                          <div
                            key={idx}
                            style={{
                              background: "var(--bg-card)",
                              border: "1px solid var(--border)",
                              borderRadius: 12,
                              overflow: "hidden",
                              borderLeft: `3px solid ${colorDot}`,
                            }}
                          >
                            {/* Image crop */}
                            {ann.imageDataUrl && (
                              <div style={{
                                background: "#111",
                                padding: 8,
                                display: "flex",
                                justifyContent: "center",
                                maxHeight: 180,
                                overflow: "hidden",
                              }}>
                                <img
                                  src={ann.imageDataUrl}
                                  alt={`Annotation on page ${pageNum}`}
                                  style={{
                                    maxWidth: "100%",
                                    maxHeight: 164,
                                    objectFit: "contain",
                                    borderRadius: 4,
                                  }}
                                />
                              </div>
                            )}

                            {/* Info section */}
                            <div style={{ padding: "10px 14px" }}>
                              <div style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: ann.ocrText ? 8 : 0,
                              }}>
                                <span style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: "var(--text-dim)",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.04em",
                                }}>
                                  {ann.type}
                                </span>
                                {ann.confidence > 0 && (
                                  <span style={{
                                    fontSize: 10,
                                    color: ann.confidence > 0.5 ? "var(--green)" : "var(--text-muted)",
                                  }}>
                                    {Math.round(ann.confidence * 100)}% conf
                                  </span>
                                )}
                              </div>

                              {ann.ocrText && (
                                <p style={{
                                  fontSize: 13,
                                  color: "var(--text)",
                                  lineHeight: 1.5,
                                  fontStyle: "italic",
                                  margin: 0,
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                }}>
                                  &ldquo;{ann.ocrText}&rdquo;
                                </p>
                              )}

                              {ann.content && (
                                <p style={{
                                  fontSize: 13,
                                  color: "var(--text)",
                                  lineHeight: 1.5,
                                  margin: 0,
                                }}>
                                  {ann.content}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ));
            })()}

            {/* ── Markdown Preview (collapsible) ── */}
            <details style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              overflow: "hidden",
              marginTop: result.usedVisualDetection ? 8 : 0,
            }}>
              <summary style={{
                padding: "12px 18px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "var(--text-dim)",
                userSelect: "none",
              }}>
                <FileIcon />
                {result.usedVisualDetection ? "Raw Markdown Output" : `${file?.name.replace(".pdf", "")}_annotations.md`}
              </summary>
              <pre style={{
                padding: "20px",
                fontSize: 13,
                lineHeight: 1.7,
                color: "var(--text)",
                fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
                overflowX: "auto",
                maxHeight: 600,
                whiteSpace: "pre-wrap",
                wordWrap: "break-word",
                borderTop: "1px solid var(--border)",
              }}>
                {markdown}
              </pre>
            </details>
          </div>
        )}

        {/* ── Footer Info ── */}
        {!result && !processing && (
          <div style={{
            marginTop: 40,
            padding: "24px",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>
              Supported Annotations
            </h3>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 8,
              fontSize: 13,
              color: "var(--text-dim)",
            }}>
              {[
                "Ink (pen / stylus handwriting)",
                "Flattened / embedded ink (iPad, GoodNotes, etc.)",
                "FreeText (typed annotations)",
                "Sticky Notes / Comments",
                "Highlights & Underlines",
                "Strikeouts & Stamps",
              ].map((item) => (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "var(--green)", fontSize: 10 }}>●</span> {item}
                </div>
              ))}
            </div>
            <p style={{
              marginTop: 16,
              fontSize: 12,
              color: "var(--text-muted)",
              lineHeight: 1.6,
            }}>
              All processing happens in your browser — no files are uploaded to any server.
              Handwritten ink annotations are OCR&apos;d using Tesseract.js running locally.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
