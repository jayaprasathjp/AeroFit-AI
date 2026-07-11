import { useState } from "react";
import axios from "axios";

// Base URL of the backend API. In production set VITE_API_URL to the deployed
// backend Cloud Run URL (e.g. https://aerofit-backend-xxxx.a.run.app).
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const API_URL = `${API_BASE}/api/search`;

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

  const handleSubmit = async (event) => {
    event.preventDefault();
    const query = input.trim();
    if (!query || loading) return;

    // Show the user's message immediately.
    setMessages((prev) => [...prev, { role: "user", text: query }]);
    setInput("");
    setLoading(true);

    try {
      const { data } = await axios.post(API_URL, { query });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.answer, page: data.page },
      ]);
      if (typeof data.page === "number" && onReferenceFound) {
        onReferenceFound(data.page, data.snippet || query);
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
        <h1 className="text-lg font-semibold text-slate-800">
          AeroFit Resolver
        </h1>
        <p className="text-xs text-slate-500">
          Boeing 747-8F maintenance manual assistant
        </p>
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
              {msg.role === "assistant" && msg.page != null && (
                <div className="mt-1 text-xs font-medium text-slate-500">
                  Source: page {msg.page}
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
