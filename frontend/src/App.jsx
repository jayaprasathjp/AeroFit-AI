import { useState } from "react";
import ChatPanel from "./components/ChatPanel.jsx";
import PdfViewer from "./components/PdfViewer.jsx";

/**
 * Full-viewport split-screen layout.
 *   Left  (50%): chat interface (ChatPanel)
 *   Right (50%): manual viewer  (PdfViewer)
 *
 * The page number returned by the backend flows up from ChatPanel into this
 * shared state, then down into PdfViewer so it jumps to the cited page.
 */
export default function App() {
  const [pageNumber, setPageNumber] = useState(1);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100">
      <div className="flex w-1/2 flex-col border-r border-slate-300">
        <ChatPanel onPageChange={setPageNumber} />
      </div>
      <div className="w-1/2">
        <PdfViewer pageNumber={pageNumber} />
      </div>
    </div>
  );
}
