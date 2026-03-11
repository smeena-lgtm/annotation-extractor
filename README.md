# Annotation Extractor

Extract handwritten & digital annotations from PDF files into structured Markdown — entirely in the browser.

## Features

- **Ink (Handwritten)** — pen/stylus strokes OCR'd via Tesseract.js
- **Sticky Notes & Comments** — full text extraction
- **Highlights, Underlines, Strikeouts** — captures annotated text
- **FreeText Annotations** — typed annotations on PDFs
- **Privacy-first** — all processing happens client-side, no uploads

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/annotation-extractor)

```bash
npm install
npm run dev
```

## Tech Stack

- Next.js 14 (App Router)
- pdf.js (Mozilla) — PDF parsing
- Tesseract.js — browser-side OCR
- TypeScript
