import { useEffect, useState } from "react";
import { getFeedback, resolveFeedback } from "../api/client";

interface FeedbackItem {
  id: number;
  category: string;
  message: string;
  submitted_by: string;
  created_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  bug: "Bug Report",
  feature: "Feature Request",
  general: "General",
};

const CATEGORY_FILTERS = [
  { value: "", label: "All" },
  { value: "bug", label: "Bugs" },
  { value: "feature", label: "Features" },
  { value: "general", label: "General" },
];

export function DevTodo() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    getFeedback(filter || undefined)
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load feedback"))
      .finally(() => setLoading(false));
  }, [filter]);

  async function handleResolve(id: number) {
    setResolving(id);
    try {
      await resolveFeedback(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve");
    }
    setResolving(null);
  }

  const counts = {
    bug: items.filter((i) => i.category === "bug").length,
    feature: items.filter((i) => i.category === "feature").length,
    general: items.filter((i) => i.category === "general").length,
  };

  return (
    <div className="dev-todo-page">
      <div className="dev-todo-header">
        <h2>Developer To-Do</h2>
        <p>User-submitted feedback: bug reports, feature requests, and general comments.</p>
      </div>

      {!filter && !loading && (
        <div className="dev-todo-summary">
          <div className="dev-todo-stat bug">
            <span className="dev-todo-stat-count">{counts.bug}</span>
            <span className="dev-todo-stat-label">Bugs</span>
          </div>
          <div className="dev-todo-stat feature">
            <span className="dev-todo-stat-count">{counts.feature}</span>
            <span className="dev-todo-stat-label">Features</span>
          </div>
          <div className="dev-todo-stat general">
            <span className="dev-todo-stat-count">{counts.general}</span>
            <span className="dev-todo-stat-label">General</span>
          </div>
        </div>
      )}

      <div className="dev-todo-filters">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.value}
            className={`dev-todo-filter${filter === f.value ? " active" : ""}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="asm-error">{error}</div>}

      {loading ? (
        <p style={{ padding: "1rem", color: "var(--text-secondary)" }}>Loading...</p>
      ) : items.length === 0 ? (
        <p style={{ padding: "1rem", color: "var(--text-secondary)" }}>No feedback submitted yet.</p>
      ) : (
        <div className="dev-todo-list">
          {items.map((item) => (
            <div key={item.id} className="dev-todo-card">
              <div className="dev-todo-card-header">
                <span className={`dev-todo-badge ${item.category}`}>
                  {CATEGORY_LABELS[item.category] ?? item.category}
                </span>
                <span className="dev-todo-meta">
                  {item.submitted_by} &middot; {new Date(item.created_at).toLocaleString()}
                </span>
              </div>
              <p className="dev-todo-message">{item.message}</p>
              <div className="dev-todo-card-actions">
                <button
                  className="btn btn-secondary dev-todo-resolve"
                  onClick={() => handleResolve(item.id)}
                  disabled={resolving === item.id}
                >
                  {resolving === item.id ? "Resolving..." : "Resolve"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
