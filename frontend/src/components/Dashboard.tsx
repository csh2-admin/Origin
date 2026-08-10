import { useEffect, useState } from "react";
import { getActions, getDashboard } from "../api/client";
import type { ActionItem, DashboardData } from "../types";

interface Props {
  onNavigate: (page: string) => void;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtNum(val: number | string | null | undefined, decimals = 0): string {
  if (val == null) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  return n.toFixed(decimals);
}

export function Dashboard({ onNavigate }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const d = await getDashboard();
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) setError("Could not load dashboard data.");
      }
      if (!cancelled) setLoading(false);

      getActions()
        .then((a) => { if (!cancelled) setActions(a.filter((item) => item.status !== "Complete")); })
        .catch(() => {});
    })();

    return () => { cancelled = true; };
  }, []);

  if (loading) return null;
  if (error || !data) return <p>{error || "Failed to load dashboard."}</p>;

  const limits = data.limits ?? [];
  const recentChanges = data.recent_changes ?? [];

  return (
    <div className="dashboard">
      <h2>Dashboard</h2>

      <div className="dash-grid">
        {/* Active test run card */}
        <div className="dash-card">
          <div className="dash-card-header">Active Test Run</div>
          {data.active_run ? (
            <div className="dash-card-body">
              <div className="dash-stat">
                <span className="dash-stat-value">{data.active_run.test_type === "simplex" ? "Simplex" : "Triplex"}</span>
                <span className="dash-stat-label">Type</span>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-value" style={{ textTransform: "capitalize" }}>{data.active_run.current_step}</span>
                <span className="dash-stat-label">Current Step</span>
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.5rem" }}>
                Started by {data.active_run.started_by} at {fmtTime(data.active_run.started_at)}
              </div>
              <button
                className="btn btn-primary"
                style={{ width: "auto", marginTop: "0.75rem", fontSize: "0.8rem" }}
                onClick={() => onNavigate("run-test")}
              >
                Go to Test Run
              </button>
            </div>
          ) : (
            <div className="dash-card-body">
              <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No test currently running.</p>
              <button
                className="btn btn-secondary"
                style={{ width: "auto", marginTop: "0.5rem", fontSize: "0.8rem" }}
                onClick={() => onNavigate("run-test")}
              >
                Start a Test
              </button>
            </div>
          )}
        </div>

        {/* Part limits card */}
        <div className="dash-card">
          <div className="dash-card-header">Part Limits</div>
          <div className="dash-card-body">
            {limits.length === 0 ? (
              <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No limits configured.</p>
            ) : (
              <div className="health-list">
                {limits.map((l) => (
                  <div key={l.position} className="health-row">
                    <div className="health-info">
                      <strong>{l.display_name}</strong>
                      <span className="health-detail">
                        {l.limit_type === "cycles"
                          ? `${fmtNum(l.limit_value)} cycle limit`
                          : `${fmtNum(l.limit_value, 1)} hour limit`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginTop: "0.5rem" }}>
              View real-time usage on individual parts in the Asset Model.
            </p>
          </div>
        </div>
      </div>

      {/* Open actions */}
      {actions.length > 0 && (
        <div className="dash-card" style={{ marginTop: "1rem" }}>
          <div className="dash-card-header">Open Actions ({actions.length})</div>
          <div className="dash-card-body">
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Responsible</th>
                    <th>Status</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((a) => {
                    const overdue = a.due_date && new Date(a.due_date) < new Date();
                    return (
                      <tr key={a.id}>
                        <td>{a.action_text}</td>
                        <td>{a.responsible || "—"}</td>
                        <td>{a.status}</td>
                        <td style={{ color: overdue ? "var(--red-600)" : undefined, fontWeight: overdue ? 600 : undefined }}>
                          {a.due_date ? new Date(a.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div className="dash-card" style={{ marginTop: "1rem" }}>
        <div className="dash-card-header">Recent Activity</div>
        <div className="dash-card-body">
          {recentChanges.length === 0 ? (
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No recent changes.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Position</th>
                    <th>Change</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {recentChanges.map((c) => (
                    <tr key={c.id}>
                      <td>{fmtTime(c.effective_time)}</td>
                      <td>{c.display_name}</td>
                      <td style={{ fontSize: "0.8rem" }}>
                        {c.removed_part_number && <span style={{ color: "var(--red-600)" }}>-{c.removed_part_number}</span>}
                        {c.removed_part_number && c.installed_part_number && " "}
                        {c.installed_part_number && <span style={{ color: "var(--green-600)" }}>+{c.installed_part_number}</span>}
                      </td>
                      <td>{c.changed_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
