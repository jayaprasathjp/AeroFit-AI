import { useState } from "react";
import ChatPanel from "./components/ChatPanel.jsx";
import PdfViewer from "./components/PdfViewer.jsx";

/**
 * Full-viewport split-screen layout.
 *   Left  (50%): chat interface (ChatPanel)
 *   Right (50%): manual viewer  (PdfViewer)
 *
 * The page number and highlight text flow up from ChatPanel into this
 * shared state, then down into PdfViewer so it jumps to the cited page.
 */
export default function App() {
  const [pageNumber, setPageNumber] = useState(1);
  const [highlightText, setHighlightText] = useState("");
  const [pdfFile, setPdfFile] = useState("amm.pdf");

  const handleReferenceFound = (page, text, file) => {
    setPageNumber(page);
    setHighlightText(text);
    if (file) setPdfFile(file);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100">
      <div className="flex w-1/2 flex-col border-r border-slate-300">
        <ChatPanel onReferenceFound={handleReferenceFound} />
      </div>
      <div className="w-1/2">
        <PdfViewer
          pageNumber={pageNumber}
          highlightText={highlightText}
          pdfFile={pdfFile}
        />
      </div>
    </div>
  );
}
