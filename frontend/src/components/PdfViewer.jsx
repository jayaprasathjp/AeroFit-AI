import { useEffect, useState, useCallback, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure the pdf.js worker (served from the local package via Vite).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const BASE_WIDTH = 680;

// Small icon button used across the toolbar.
function ToolButton({ onClick, disabled, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="flex h-8 w-8 items-center justify-center rounded-md text-ups-brown-100 transition hover:bg-ups-brown-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/**
 * Right-side manual viewer.
 *
 * Props:
 *   pageNumber: number — the page to display. When this changes (because the
 *                        chat panel received a new API response), the viewer
 *                        jumps to that page automatically.
 *   highlightText: string — text keywords to highlight on the page.
 *   pdfFile: string — public PDF filename to display (e.g. "amm.pdf").
 */
export default function PdfViewer({ pageNumber, highlightText, pdfFile, onCollapse }) {
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [fitWidth, setFitWidth] = useState(false);
  const [pageInput, setPageInput] = useState("1");
  const [containerWidth, setContainerWidth] = useState(BASE_WIDTH);

  const scrollRef = useRef(null);

  const fileName = pdfFile || "amm.pdf";
  const fileUrl = `/${fileName}`;

  // Measure the scroll container so "fit width" can size the page.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Jump to the cited page whenever the prop changes.
  useEffect(() => {
    if (typeof pageNumber === "number" && pageNumber >= 1) {
      setCurrentPage(pageNumber);
    }
  }, [pageNumber]);

  // Keep the page-jump input in sync and scroll to top on page change.
  useEffect(() => {
    setPageInput(String(currentPage));
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [currentPage]);

  const onDocumentLoadSuccess = ({ numPages: total }) => {
    setNumPages(total);
    // Clamp the current page in case the cited page exceeds the document.
    setCurrentPage((prev) => Math.min(Math.max(prev, 1), total));
  };

  const goPrev = useCallback(
    () => setCurrentPage((p) => Math.max(1, p - 1)),
    []
  );
  const goNext = useCallback(
    () => setCurrentPage((p) => Math.min(numPages || p, p + 1)),
    [numPages]
  );

  const zoomIn = () =>
    setScale((s) => Math.min(MAX_SCALE, +(s + 0.25).toFixed(2)));
  const zoomOut = () =>
    setScale((s) => Math.max(MIN_SCALE, +(s - 0.25).toFixed(2)));
  const resetZoom = () => {
    setScale(1);
    setFitWidth(false);
  };
  const rotate = () => setRotation((r) => (r + 90) % 360);

  const commitPageInput = () => {
    const n = parseInt(pageInput, 10);
    if (!Number.isNaN(n) && n >= 1) {
      setCurrentPage(Math.min(n, numPages || n));
    } else {
      setPageInput(String(currentPage));
    }
  };

  // Arrow-key navigation when the viewer area is focused.
  const onKeyDown = (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    }
  };

  // Effective render width: fit-to-width uses the container, else base × zoom.
  const renderWidth = fitWidth
    ? Math.max(320, containerWidth - 48)
    : Math.round(BASE_WIDTH * scale);
  const zoomPct = fitWidth
    ? Math.round(((containerWidth - 48) / BASE_WIDTH) * 100)
    : Math.round(scale * 100);

  const textRenderer = useCallback(
      (textItem) => {
        const escapeHtml = (s) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        const safe = escapeHtml(textItem.str);
        if (!highlightText || !textItem.str.trim()) return safe;

        const snippet = highlightText;
        const snippetLower = snippet.toLowerCase().replace(/\s+/g, " ");
        const itemLower = textItem.str.toLowerCase().replace(/\s+/g, " ").trim();

        // 1. If the text item is completely contained within the snippet
        if (itemLower.length >= 4 && snippetLower.includes(itemLower)) {
          return `<mark style="background-color: rgba(250, 204, 21, 0.5); color: transparent;">${safe}</mark>`;
        }

        // 2. If snippet lines are contained within the text item
        const lines = snippet.split('\n').map((l) => l.trim()).filter((l) => l.length > 4);
        let matchRegex = null;

        if (lines.length > 0) {
          const escapedLines = lines.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
          matchRegex = new RegExp(`(${escapedLines.join("|")})`, "gi");
        } else if (snippet.trim().length > 4) {
          const escapedSnippet = snippet.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          matchRegex = new RegExp(`(${escapedSnippet})`, "gi");
        }

        if (matchRegex && matchRegex.test(textItem.str)) {
          matchRegex.lastIndex = 0; // reset after .test()
          return safe.replace(
            matchRegex,
            '<mark style="background-color: rgba(250, 204, 21, 0.5); color: transparent;">$1</mark>'
          );
        }

        // 3. Fallback: highlight significant words and 2-word phrases
        const words = snippet
          .split(/\s+/)
          .map((w) => w.replace(/[^a-zA-Z0-9-]/g, ""))
          .filter(Boolean);

        const phrases = [];
        for (let i = 0; i < words.length - 1; i++) {
          if (words[i].length > 2 && words[i + 1].length > 2) {
            phrases.push(`${words[i]} ${words[i + 1]}`);
          }
        }

        const isSignificant = (w) =>
          /\d/.test(w) ||
          w.includes("-") ||
          (w.length >= 3 && w === w.toUpperCase()) ||
          w.length > 6;

        const significantWords = words.filter((w) => w.length > 3 && isSignificant(w));
        const terms = [...new Set([...phrases, ...significantWords])].slice(0, 20);

        if (terms.length > 0) {
          terms.sort((a, b) => b.length - a.length);
          const escaped = terms.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
          const pattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");

          return safe.replace(
            pattern,
            '<mark style="background-color: rgba(250, 204, 21, 0.5); color: transparent;">$1</mark>'
          );
        }

        return safe;
      },
      [highlightText]
    );

  return (
    <div className="flex h-full flex-col bg-ups-brown-900">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ups-brown-700 bg-ups-brown-800 px-3 py-2">
        {/* File identity */}
        <div className="flex items-center gap-2">
          <span className="flex h-7 items-center gap-1.5 rounded-md bg-ups-gold px-2 text-[11px] font-bold uppercase tracking-wide text-ups-brown-800">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
              <path d="M6 2a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6H6zm7 1.5L18.5 9H13V3.5z" />
            </svg>
            {fileName.replace(/\.pdf$/i, "")}
          </span>
        </div>

        {/* Zoom + rotate controls */}
        <div className="flex items-center gap-0.5 rounded-lg bg-ups-brown-900/60 p-0.5">
          <ToolButton onClick={zoomOut} disabled={!fitWidth && scale <= MIN_SCALE} title="Zoom out">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M5 12h14" />
            </svg>
          </ToolButton>
          <button
            type="button"
            onClick={resetZoom}
            title="Reset zoom"
            className="min-w-[3rem] rounded px-1 text-center text-xs font-semibold text-ups-brown-100 transition hover:text-white"
          >
            {zoomPct}%
          </button>
          <ToolButton onClick={zoomIn} disabled={!fitWidth && scale >= MAX_SCALE} title="Zoom in">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
          </ToolButton>
          <span className="mx-0.5 h-5 w-px bg-ups-brown-700" />
          <ToolButton
            onClick={() => setFitWidth((f) => !f)}
            title={fitWidth ? "Actual size" : "Fit width"}
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-4 w-4 ${fitWidth ? "text-ups-gold" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9V5a2 2 0 012-2h4M15 3h4a2 2 0 012 2v4M21 15v4a2 2 0 01-2 2h-4M9 21H5a2 2 0 01-2-2v-4" />
            </svg>
          </ToolButton>
          <ToolButton onClick={rotate} title="Rotate 90°">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M20 9a8 8 0 00-14.9-2M4 15a8 8 0 0014.9 2" />
            </svg>
          </ToolButton>
        </div>

        {/* Page navigation */}
        <div className="flex items-center gap-1">
          <ToolButton onClick={goPrev} disabled={currentPage <= 1} title="Previous page">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </ToolButton>
          <div className="flex items-center gap-1 text-xs text-ups-brown-100">
            <input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={commitPageInput}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="w-10 rounded border border-ups-brown-700 bg-ups-brown-900 px-1 py-1 text-center font-semibold text-white focus:border-ups-gold focus:outline-none"
              aria-label="Page number"
            />
            <span className="text-ups-brown-300">/ {numPages || "…"}</span>
          </div>
          <ToolButton
            onClick={goNext}
            disabled={numPages != null && currentPage >= numPages}
            title="Next page"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </ToolButton>
          {onCollapse && (
            <>
              <span className="mx-0.5 h-5 w-px bg-ups-brown-700" />
              <ToolButton onClick={onCollapse} title="Hide manual viewer">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </ToolButton>
            </>
          )}
        </div>
      </div>

      {/* ── Page canvas ─────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative flex-1 overflow-auto bg-[radial-gradient(circle_at_center,#3D2418_0%,#26120D_100%)] p-6 outline-none"
      >
        {highlightText && (
          <div className="pointer-events-none sticky top-0 z-10 mx-auto mb-3 flex max-w-max items-center gap-1.5 rounded-full bg-ups-gold/95 px-3 py-1 text-[11px] font-semibold text-ups-brown-800 shadow-md">
            <span className="inline-block h-2 w-2 rounded-full bg-ups-brown-800" />
            Highlighting cited reference
          </div>
        )}
        <div className="flex justify-center">
          <Document
            file={fileUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className="mt-16 flex flex-col items-center gap-3 text-ups-brown-200">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-ups-gold/40 border-t-ups-gold" />
                <p className="text-sm">Loading manual…</p>
              </div>
            }
            error={
              <p className="mt-16 text-center text-sm text-red-300">
                Failed to load PDF. Ensure {fileName} is in /public.
              </p>
            }
          >
            <Page
              pageNumber={currentPage}
              customTextRenderer={textRenderer}
              renderTextLayer
              renderAnnotationLayer
              width={renderWidth}
              rotate={rotation}
            />
          </Document>
        </div>
      </div>
    </div>
  );
}
