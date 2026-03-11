import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Annotation Extractor — Handwritten PDF to Markdown",
  description:
    "Extract handwritten ink annotations, sticky notes, highlights, and more from PDF files. Powered by Tesseract.js OCR.",
  openGraph: {
    title: "Annotation Extractor",
    description: "Extract handwritten PDF annotations to structured Markdown",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
