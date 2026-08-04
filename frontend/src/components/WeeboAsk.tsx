import { useState } from "react";
import { askWeebo } from "../api/client";
import type { AskResponse } from "../types";

interface Message {
  role: "user" | "assistant";
  content: string;
  sql?: string;
  rowCount?: number;
  results?: Record<string, unknown>[];
}

export function WeeboAsk() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedSql, setExpandedSql] = useState<number | null>(null);
  const [expandedResults, setExpandedResults] = useState<number | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    const userMsg: Message = { role: "user", content: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const data: AskResponse = await askWeebo(question);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          sql: data.sql,
          rowCount: data.row_count,
          results: data.results,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Something went wrong"}` },
      ]);
    }
    setLoading(false);
  }

  return (
    <div className="weebo-ask">
      <h2>Ask Weebo</h2>
      <p className="wa-subtitle">Ask questions about your data in plain English.</p>

      <div className="wask-chat">
        {messages.length === 0 && !loading && (
          <div className="wask-empty">
            <p>Try asking:</p>
            <div className="wask-suggestions">
              {[
                "When did we last replace the piston?",
                "Show me all critical memos from the last month",
                "What action items are still open?",
                "How many test runs have we completed?",
              ].map((q) => (
                <button key={q} className="wask-suggestion" onClick={() => { setInput(q); }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`wask-msg wask-${msg.role}`}>
            <div className="wask-msg-label">{msg.role === "user" ? "You" : "Weebo"}</div>
            <div className="wask-msg-content">{msg.content}</div>
            {msg.sql && (
              <div className="wask-meta">
                <button className="wask-toggle" onClick={() => setExpandedSql(expandedSql === i ? null : i)}>
                  {expandedSql === i ? "Hide SQL" : "Show SQL"}
                </button>
                {msg.rowCount != null && <span className="wask-row-count">{msg.rowCount} rows</span>}
                {msg.results && msg.results.length > 0 && (
                  <button className="wask-toggle" onClick={() => setExpandedResults(expandedResults === i ? null : i)}>
                    {expandedResults === i ? "Hide Data" : "Show Data"}
                  </button>
                )}
              </div>
            )}
            {expandedSql === i && msg.sql && (
              <pre className="wask-sql">{msg.sql}</pre>
            )}
            {expandedResults === i && msg.results && msg.results.length > 0 && (
              <div className="wask-results-wrap">
                <table className="wask-results">
                  <thead>
                    <tr>
                      {Object.keys(msg.results[0]).map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {msg.results.map((row, ri) => (
                      <tr key={ri}>
                        {Object.values(row).map((val, ci) => (
                          <td key={ci}>{val == null ? "" : String(val)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="wask-msg wask-assistant">
            <div className="wask-msg-label">Weebo</div>
            <div className="wask-msg-content wask-thinking">Thinking...</div>
          </div>
        )}
      </div>

      <form className="wask-input-bar" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about your data..."
          disabled={loading}
        />
        <button type="submit" className="btn btn-primary" style={{ width: "auto" }} disabled={loading || !input.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
