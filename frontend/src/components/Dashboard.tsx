import { useCallback, useEffect, useState } from "react";
import { getAllUsage, getDashboard } from "../api/client";
import type { DashboardData, PositionLimit } from "../types";

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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [d, u] = await Promise.all([getDashboard(), getAllUsage()]);
      setData(d);
      setUsage(u);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return null;
  if (!data) return <p>Failed to load dashboard.</p>;

  const alerts = data.limits
    .map((l) => ({ ...l, pct: healthPct(l, usage) }))
    .filter((l) => l.pct != null && l.pct >= 70)
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));

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

        {/* Part health alerts card */}
        <div className="dash-card">
          <div className="dash-card-header">
            Part Health
            <button
              className="btn btn-secondary"
              style={{ width: "auto", fontSize: "0.7rem", padding: "0.2rem 0.5rem", marginLeft: "auto" }}
              onClick={() => onNavigate("usage-limits")}
            >
              Manage Limits
            </button>
          </div>
          <div className="dash-card-body">
            {alerts.length === 0 ? (
              <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                {data.limits.length === 0 ? "No usage limits configured." : "All parts within limits."}
              </p>
            ) : (
              <div className="health-list">
                {alerts.map((a) => (
                  <div key={a.position} className="health-row">
                    <div className="health-info">
                      <strong>{a.display_name}</strong>
                      <span className="health-detail">
                        {a.limit_type === "cycles"
                          ? `${fmtNum(usage[a.position]?.est_cycles)} / ${fmtNum(a.limit_value)} cycles`
                          : `${fmtNum(usage[a.position]?.runtime_hours, 1)} / ${fmtNum(a.limit_value, 1)} hrs`}
                      </span>
                    </div>
                    <div className="health-bar-track">
                      <div
                        className="health-bar-fill"
                        style={{ width: `${Math.min(a.pct!, 100)}%`, background: healthColor(a.pct!) }}
                      />
                    </div>
                    <span className="health-pct" style={{ color: healthColor(a.pct!) }}>
                      {a.pct!.toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

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
