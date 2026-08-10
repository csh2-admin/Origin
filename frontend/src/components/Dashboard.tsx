import { useCallback, useEffect, useState } from "react";
import { getActions, getAllUsage, getDashboard } from "../api/client";
import type { ActionItem, DashboardData, PositionLimit } from "../types";

interface Props {
  onNavigate: (page: string) => void;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtNum(val: number | null | undefined, decimals = 0): string {
  if (val == null) return "—";
  return val.toFixed(decimals);
}

interface UsageMap {
  [position: string]: { est_cycles: number; runtime_hours: number };
}

function healthPct(limit: PositionLimit, usage: UsageMap): number | null {
  const u = usage[limit.position];
  if (!u) return null;
  const current = limit.limit_type === "cycles" ? u.est_cycles : u.runtime_hours;
  if (!current || limit.limit_value <= 0) return null;
  return (current / limit.limit_value) * 100;
}

function healthColor(pct: number): string {
  if (pct >= 90) return "var(--red-600)";
  if (pct >= 70) return "#d97706";
  return "var(--green-600)";
}

export function Dashboard({ onNavigate }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [usage, setUsage] = useState<UsageMap>({});
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await getDashboard();
      setData(d);
    } catch { /* ignore */ }
    setLoading(false);
    // Usage and actions load independently — don't block the dashboard render
    getAllUsage().then((u) => setUsage(u)).catch(() => {});
    getActions()
      .then((a) => setActions(a.filter((item) => item.status !== "Complete")))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return null;
  if (!data) return <p>Failed to load dashboard.</p>;

  // Build a list of all positions with usage, merging in limits where configured
  const allPositions = Object.entries(usage).map(([position, u]) => {
    const limit = data.limits.find((l) => l.position === position);
    const pct = limit ? healthPct(limit, usage) : null;
    return {
      position,
      display_name: limit?.display_name ?? position.replace(/_/g, " "),
      est_cycles: u.est_cycles,
      runtime_hours: u.runtime_hours,
      limit,
      pct,
    };
  }).sort((a, b) => {
    // Parts over limit first (highest %), then parts with limits, then the rest
    if (a.pct != null && b.pct != null) return b.pct - a.pct;
    if (a.pct != null) return -1;
    if (b.pct != null) return 1;
    return a.display_name.localeCompare(b.display_name);
  });

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

        {/* Part health card */}
        <div className="dash-card">
          <div className="dash-card-header">Part Health</div>
          <div className="dash-card-body">
            {allPositions.length === 0 ? (
              <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No usage data available.</p>
            ) : (
              <div className="health-list">
                {allPositions.map((a) => (
                  <div key={a.position} className="health-row">
                    <div className="health-info">
                      <strong>{a.display_name}</strong>
                      <span className="health-detail">
                        {a.limit ? (
                          a.limit.limit_type === "cycles"
                            ? `${fmtNum(a.est_cycles)} / ${fmtNum(a.limit.limit_value)} cycles`
                            : `${fmtNum(a.runtime_hours, 1)} / ${fmtNum(a.limit.limit_value, 1)} hrs`
                        ) : (
                          `${fmtNum(a.est_cycles)} cycles · ${fmtNum(a.runtime_hours, 1)} hrs`
                        )}
                      </span>
                    </div>
                    {a.pct != null ? (
                      <>
                        <div className="health-bar-track">
                          <div
                            className="health-bar-fill"
                            style={{ width: `${Math.min(a.pct, 100)}%`, background: healthColor(a.pct) }}
                          />
                        </div>
                        <span className="health-pct" style={{ color: healthColor(a.pct) }}>
                          {a.pct.toFixed(0)}%
                        </span>
                      </>
                    ) : (
                      <span className="health-no-limit">No limit set</span>
                    )}
                  </div>
                ))}
              </div>
            )}
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
          {data.recent_changes.length === 0 ? (
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
                  {data.recent_changes.map((c) => (
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
