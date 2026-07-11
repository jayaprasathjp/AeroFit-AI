import { useEffect, useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure the pdf.js worker (served from the local package via Vite).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const FILE_URL = "/mock_747_amm.pdf";

/**
 * Right-side manual viewer.
 *
 * Props:
 *   pageNumber: number — the page to display. When this changes (because the
 *                        chat panel received a new API response), the viewer
 *                        jumps to that page automatically.
 *   highlightText: string — text keywords to highlight on the page.
 */
export default function PdfViewer({ pageNumber, highlightText }) {
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Jump to the cited page whenever the prop changes.
  useEffect(() => {
    if (typeof pageNumber === "number" && pageNumber >= 1) {
      setCurrentPage(pageNumber);
    }
  }, [pageNumber]);

  const onDocumentLoadSuccess = ({ numPages: total }) => {
    setNumPages(total);
    // Clamp the current page in case the cited page exceeds the document.
    setCurrentPage((prev) => Math.min(Math.max(prev, 1), total));
  };

  const goPrev = () => setCurrentPage((p) => Math.max(1, p - 1));
  const goNext = () =>
    setCurrentPage((p) => Math.min(numPages || p, p + 1));

  const textRenderer = useCallback(
    (textItem) => {
      if (!highlightText) return textItem.str;
      
      // Extract words from highlightText that are longer than 4 chars or uppercase
      const words = highlightText
        .split(/\s+/)
        .map(w => w.replace(/[^a-zA-Z0-9-]/g, ''))
        .filter(w => w.length > 4 || (w.length > 1 && w === w.toUpperCase()));
        
      if (words.length === 0) return textItem.str;

      // Build a regex to match any of these words (case-insensitive)
      const pattern = new RegExp(`(${words.join("|")})`, "gi");
      
      const splitText = textItem.str.split(pattern);
      if (splitText.length <= 1) return textItem.str;

      return splitText.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="bg-yellow-300 text-transparent">
            {part}
          </mark>
        ) : (
          part
        )
      );
    },
    [highlightText]
  );

  return (
    <div className="flex h-full flex-col bg-slate-800">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2 text-slate-100">
        <span className="text-sm font-medium">mock_747_amm.pdf</span>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={goPrev}
            disabled={currentPage <= 1}
            className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {currentPage}
            {numPages ? ` / ${numPages}` : ""}
          </span>
          <button
            onClick={goNext}
            disabled={numPages != null && currentPage >= numPages}
            className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="flex justify-center">
          <Document
            file={FILE_URL}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <p className="mt-8 text-center text-slate-300">Loading manual…</p>
            }
            error={
              <p className="mt-8 text-center text-red-300">
                Failed to load PDF. Ensure mock_747_amm.pdf is in /public.
              </p>
            }
          >
            <Page
              pageNumber={currentPage}
              customTextRenderer={textRenderer}
              renderTextLayer
              renderAnnotationLayer
              width={640}
            />
          </Document>
        </div>
      </div>
    </div>
  );
}
