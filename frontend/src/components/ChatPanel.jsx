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

  const submitQuery = async (rawQuery) => {
    const query = (rawQuery ?? input).trim();
    if (!query || loading) return;

    // Show the user's message immediately.
    setMessages((prev) => [...prev, { role: "user", text: query }]);
    setInput("");
    setLoading(true);

    try {
      const payload = { query };
      if (docFilter !== "ALL") payload.doc_type = docFilter;
      // Send recent turns (excluding errors) so follow-ups keep context.
      payload.history = messages
        .filter((m) => !m.isError && m.text)
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.text }));
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

  const handleSubmit = (event) => {
    event.preventDefault();
    submitQuery();
  };

  const SUGGESTIONS = [
    "Approved alternate for part 65B90312-5",
    "Torque spec for the wing spar fasteners",
    "Is revision C of the fuel pump still active?",
  ];

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-white to-ups-brown-50">
      {/* Toolbar: document scope filter */}
      <div className="flex items-center justify-between gap-2 border-b border-ups-brown-100 bg-white/80 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 text-ups-brown-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z"
            />
          </svg>
          <span className="text-xs font-semibold uppercase tracking-wide text-ups-brown-500">
            Search scope
          </span>
        </div>
        {/* Scope search to a single document type */}
        <div className="flex overflow-hidden rounded-lg border border-ups-brown-200 bg-white p-0.5 text-xs">
          {[
            { key: "ALL", label: "All" },
            { key: "AMM", label: "AMM" },
            { key: "IPC", label: "IPC" },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setDocFilter(opt.key)}
              className={`rounded-md px-3 py-1 font-semibold transition ${
                docFilter === opt.key
                  ? "bg-ups-brown-800 text-white shadow-sm"
                  : "bg-transparent text-ups-brown-500 hover:bg-ups-brown-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
        {messages.length === 0 && (
          <div className="mx-auto mt-8 max-w-sm text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-ups-gold/15 text-ups-gold-600">
              <svg
                viewBox="0 0 24 24"
                className="h-7 w-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 10h8M8 14h5M21 12a9 9 0 11-3.6-7.2L21 3v6h-6"
                />
              </svg>
            </div>
            <h2 className="text-sm font-bold text-ups-brown-800">
              Ask about approved parts &amp; procedures
            </h2>
            <p className="mt-1 text-xs text-ups-brown-400">
              Grounded in the Boeing 747-8F AMM &amp; IPC with live AMAP
              inventory.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submitQuery(s)}
                  className="group flex items-center gap-2 rounded-xl border border-ups-brown-100 bg-white px-3 py-2 text-left text-xs font-medium text-ups-brown-600 shadow-sm transition hover:border-ups-gold hover:shadow-card"
                >
                  <span className="text-ups-gold-600 transition group-hover:translate-x-0.5">
                    ➤
                  </span>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex animate-fade-in-up ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
                msg.role === "user"
                  ? "rounded-br-sm bg-ups-brown-800 text-white"
                  : msg.isError
                  ? "rounded-bl-sm border border-red-200 bg-red-50 text-red-800"
                  : "rounded-bl-sm border border-ups-brown-100 bg-white text-ups-brown-800"
              }`}
            >
              {msg.text}
              {msg.role === "assistant" && !msg.found && (
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-ups-brown-100 px-2 py-0.5 text-[10px] font-semibold text-ups-brown-500">
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
                  <div className="mt-1.5 flex items-center gap-1 text-xs font-medium text-ups-brown-400">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-ups-gold" />
                    Source: {msg.docType ? `${msg.docType} ` : ""}page {msg.page}
                  </div>
                )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex animate-fade-in-up justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-ups-brown-100 bg-white px-4 py-3 text-sm text-ups-brown-500 shadow-sm">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce-dot rounded-full bg-ups-gold [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce-dot rounded-full bg-ups-gold [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce-dot rounded-full bg-ups-gold [animation-delay:300ms]" />
              </span>
              Searching the manual…
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-ups-brown-100 bg-white/90 p-3 backdrop-blur"
      >
        <div className="flex items-center gap-2 rounded-xl border border-ups-brown-200 bg-white px-2 py-1 shadow-sm transition focus-within:border-ups-gold focus-within:shadow-glow">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. Approved alternate for part 65B90312-5…"
            className="flex-1 bg-transparent px-2 py-2 text-sm text-ups-brown-800 placeholder:text-ups-brown-300 focus:outline-none"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-ups-gold text-ups-brown-800 shadow-sm transition hover:bg-ups-gold-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-ups-brown-800/40 border-t-ups-brown-800" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
              </svg>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
