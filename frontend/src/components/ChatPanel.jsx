import { useState } from "react";
import axios from "axios";
import DecisionCard from "./DecisionCard.jsx";

// Base URL of the backend API. In production set VITE_API_URL to the deployed
// backend Cloud Run URL (e.g. https://aerofit-backend-xxxx.a.run.app).
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const API_URL = `${API_BASE}/api/search`;

// Build the PDF highlight string for a message: prefer the exact part numbers
// from the decision (precise), else fall back to the retrieved snippet.
function highlightFor(msg) {
  const partNumbers = [];
  if (msg.decision) {
    if (msg.decision.primary_part) partNumbers.push(msg.decision.primary_part);
    (msg.decision.alternates || []).forEach(
      (a) => a.part_number && partNumbers.push(a.part_number)
    );
  }
  return partNumbers.length ? partNumbers.join(" ") : msg.snippet || "";
}

/**
 * Left-side chat interface.
 *
 * Props:
 *   onReferenceFound(page: number, query: string) — lifts the cited page number
 *                                and query up to <App/> so the PDF viewer can
 *                                jump to it and highlight text.
 */
export default function ChatPanel({ onReferenceFound }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [docFilter, setDocFilter] = useState("ALL"); // ALL | AMM | IPC

  const handleSubmit = async (event) => {
    event.preventDefault();
    const query = input.trim();
    if (!query || loading) return;

    // Show the user's message immediately.
    setMessages((prev) => [...prev, { role: "user", text: query }]);
    setInput("");
    setLoading(true);

    try {
      const payload = { query };
      if (docFilter !== "ALL") payload.doc_type = docFilter;
      const { data } = await axios.post(API_URL, payload);
      const assistantMsg = {
        role: "assistant",
        text: data.answer,
        page: data.page,
        file: data.file || "amm.pdf",
        docType: data.doc_type || "",
        found: data.found !== false,
        sources: data.sources || [],
        citations: data.citations || [],
        snippet: data.snippet || "",
        decision: data.decision || null,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (assistantMsg.found && typeof data.page === "number" && onReferenceFound) {
        onReferenceFound(
          data.page,
          highlightFor(assistantMsg) || query,
          assistantMsg.file
        );
      }
    } catch (error) {
      const detail =
        error?.response?.data?.detail || error.message || "Request failed.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Error: ${detail}`, isError: true },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">
              AeroFit Resolver
            </h1>
            <p className="text-xs text-slate-500">
              Boeing 747-8F maintenance manual assistant
            </p>
          </div>
          {/* Scope search to a single document type */}
          <div className="flex overflow-hidden rounded-md border border-slate-300 text-xs">
            {[
              { key: "ALL", label: "All" },
              { key: "AMM", label: "AMM" },
              { key: "IPC", label: "IPC" },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setDocFilter(opt.key)}
                className={`px-2.5 py-1 font-medium transition ${
                  docFilter === opt.key
                    ? "bg-blue-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-slate-400">
            Ask about approved alternate parts, procedures, or specifications.
          </p>
        )}

        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : msg.isError
                  ? "bg-red-100 text-red-800"
                  : "bg-slate-100 text-slate-800"
              }`}
            >
              {msg.text}
              {msg.role === "assistant" && !msg.found && (
                <div className="mt-2 inline-block rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                  🔍 Not found in AMM / IPC
                </div>
              )}
              {msg.role === "assistant" && msg.decision && (
                <DecisionCard
                  decision={msg.decision}
                  sources={msg.sources}
                  citations={msg.citations}
                  onSourceClick={(page, file) =>
                    onReferenceFound &&
                    onReferenceFound(page, highlightFor(msg), file || msg.file)
                  }
                />
              )}
              {msg.role === "assistant" &&
                msg.found &&
                !msg.decision &&
                msg.page != null && (
                  <div className="mt-1 text-xs font-medium text-slate-500">
                    Source: {msg.docType ? `${msg.docType} ` : ""}page {msg.page}
                  </div>
                )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-500">
              Searching the manual…
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex gap-2 border-t border-slate-200 p-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. What is the approved alternate for part 65B..."
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
