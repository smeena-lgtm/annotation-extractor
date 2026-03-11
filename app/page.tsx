"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";

const ExtractorApp = dynamic(() => import("@/components/ExtractorApp"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#0a0a0f",
        color: "#6b6b80",
        fontSize: 14,
      }}
    >
      Loading...
    </div>
  ),
});

export default function Page() {
  return <ExtractorApp />;
}
