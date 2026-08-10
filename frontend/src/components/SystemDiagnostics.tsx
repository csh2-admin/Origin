import { useEffect, useState } from "react";
import { getAllUsage, getPositionLimits } from "../api/client";
import type { PositionLimit } from "../types";

interface UsageEntry {
  est_cycles: number;
  runtime_hours: number;
}

function fmtNum(val: number | string | null | undefined, decimals = 0): string {
  if (val == null) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  return n.toFixed(decimals);
}

function healthColor(pct: number): string {
  if (pct >= 90) return "var(--red-600)";
  if (pct >= 70) return "#d97706";
  return "var(--green-600)";
}

export function SystemDiagnostics() {
  const [usage, setUsage] = useState<Record<string, UsageEntry> | null>(null);
  const [limits, setLimits] = useState<PositionLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [u, l] = await Promise.all([getAllUsage(), getPositionLimits()]);
        if (!cancelled) {
          setUsage(u);
          setLimits(l);
        }
      } catch {
        if (!cancelled) setError("Failed to load usage data. This query can take a while — please try again.");
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  const allPositions = usage
    ? Object.entries(usage).map(([position, u]) => {
        const limit = limits.find((l) => l.position === position);
        const limitVal = limit ? (typeof limit.limit_value === "string" ? parseFloat(limit.limit_value) : limit.limit_value) : null;
        let pct: number | null = null;
        if (limit && limitVal && limitVal > 0) {
          const current = limit.limit_type === "cycles" ? u.est_cycles : u.runtime_hours;
          if (current) pct = (current / limitVal) * 100;
        }
        return {
          position,
          display_name: limit?.display_name ?? position.replace(/_/g, " "),
          est_cycles: u.est_cycles,
          runtime_hours: u.runtime_hours,
          limit,
          limitVal,
          pct,
        };
      }).sort((a, b) => {
        if (a.pct != null && b.pct != null) return b.pct - a.pct;
        if (a.pct != null) return -1;
        if (b.pct != null) return 1;
        return a.display_name.localeCompare(b.display_name);
      })
    : [];

  return (
    <div className="dashboard">
      <h2>System Diagnostics</h2>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1rem" }}>
        Real-time cycle counts and runtime hours for all installed components.
      </p>

      {loading ? (
        <p style={{ color: "var(--text-secondary)" }}>Loading usage data — this may take a moment...</p>
      ) : error ? (
        <p style={{ color: "var(--red-600)" }}>{error}</p>
      ) : allPositions.length === 0 ? (
        <p style={{ color: "var(--text-secondary)" }}>No usage data available.</p>
      ) : (
        <div className="dash-card">
          <div className="dash-card-header">Part Health</div>
          <div className="dash-card-body">
            <div className="health-list">
              {allPositions.map((a) => (
                <div key={a.position} className="health-row">
                  <div className="health-info">
                    <strong>{a.display_name}</strong>
                    <span className="health-detail">
                      {fmtNum(a.est_cycles)} cycles · {fmtNum(a.runtime_hours, 1)} hrs
                      {a.limit && a.limitVal ? (
                        a.limit.limit_type === "cycles"
                          ? ` (limit: ${fmtNum(a.limitVal)} cycles)`
                          : ` (limit: ${fmtNum(a.limitVal, 1)} hrs)`
                      ) : null}
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
          </div>
        </div>
      )}
    </div>
  );
}
