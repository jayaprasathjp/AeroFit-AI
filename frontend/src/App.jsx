import { useState } from "react";
import ChatPanel from "./components/ChatPanel.jsx";
import PdfViewer from "./components/PdfViewer.jsx";

/**
 * Full-viewport application shell.
 *
 *   Top:   UPS-branded application bar.
 *   Left  (≈46%): chat interface (ChatPanel)
 *   Right (≈54%): manual viewer  (PdfViewer)
 *
 * The page number and highlight text flow up from ChatPanel into this
 * shared state, then down into PdfViewer so it jumps to the cited page.
 */
export default function App() {
  const [pageNumber, setPageNumber] = useState(1);
  const [highlightText, setHighlightText] = useState("");
  const [pdfFile, setPdfFile] = useState("amm.pdf");
  const [pdfCollapsed, setPdfCollapsed] = useState(false);

  const handleReferenceFound = (page, text, file) => {
    setPageNumber(page);
    setHighlightText(text);
    if (file) setPdfFile(file);
    // Auto-reveal the viewer when a citation is opened.
    setPdfCollapsed(false);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-ups-brown-50">
      {/* ── UPS-branded top bar ─────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between bg-ups-brown-800 px-5 py-2.5 shadow-lg">
        <div className="flex items-center gap-3">
          {/* Shield mark */}
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-ups-gold shadow-md">
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6 text-ups-brown-800"
              fill="currentColor"
            >
              <path d="M12 2L4 5v6c0 5 3.4 8.6 8 11 4.6-2.4 8-6 8-11V5l-8-3zm0 2.2l6 2.25v4.55c0 3.9-2.5 6.9-6 8.85-3.5-1.95-6-4.95-6-8.85V6.45L12 4.2z" />
              <path d="M9 11.5l2 2 4-4.2 1.4 1.35L11 16.3l-3.4-3.45L9 11.5z" />
            </svg>
          </div>
          <div className="leading-tight">
            <h1 className="text-base font-extrabold tracking-tight text-white">
              AeroFit <span className="text-ups-gold">Resolver</span>
            </h1>
            <p className="text-[11px] font-medium text-ups-brown-200">
              Boeing 747-8F · Approved Parts Intelligence
            </p>
          </div>
        </div>

        <div className="hidden items-center gap-2 sm:flex">
          <span className="flex items-center gap-1.5 rounded-full bg-ups-brown-700 px-3 py-1 text-[11px] font-semibold text-ups-brown-100">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            Live inventory
          </span>
          <span className="rounded-full border border-ups-gold/40 bg-ups-gold/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-ups-gold">
            AMM · IPC
          </span>
        </div>
      </header>

      {/* ── Split workspace ─────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <div
          className={`flex flex-col border-r border-ups-brown-200 transition-[width] duration-300 ease-in-out ${
            pdfCollapsed ? "w-full" : "w-[46%] min-w-[380px]"
          }`}
        >
          <ChatPanel onReferenceFound={handleReferenceFound} />
        </div>

        {pdfCollapsed ? (
          // Slim reopen tab when the viewer is hidden.
          <button
            type="button"
            onClick={() => setPdfCollapsed(false)}
            title="Show manual viewer"
            className="group flex w-9 shrink-0 flex-col items-center justify-center gap-2 border-l border-ups-brown-700 bg-ups-brown-800 text-ups-brown-100 transition hover:bg-ups-brown-700"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-ups-gold" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span
              className="text-[11px] font-bold uppercase tracking-widest"
              style={{ writingMode: "vertical-rl" }}
            >
              Manual
            </span>
          </button>
        ) : (
          <div className="w-[54%] flex-1">
            <PdfViewer
              pageNumber={pageNumber}
              highlightText={highlightText}
              pdfFile={pdfFile}
              onCollapse={() => setPdfCollapsed(true)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
