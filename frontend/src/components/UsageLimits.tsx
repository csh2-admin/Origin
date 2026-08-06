import { useCallback, useEffect, useState } from "react";
import { deletePositionLimit, getAllUsage, getPositionLimits, getState, upsertPositionLimit } from "../api/client";
import type { PositionLimit, PositionState } from "../types";

interface UsageMap {
  [position: string]: { est_cycles: number; runtime_hours: number };
}

function fmtNum(val: number | null | undefined, decimals = 0): string {
  if (val == null) return "—";
  return val.toFixed(decimals);
}

function healthColor(pct: number): string {
  if (pct >= 90) return "var(--red-600)";
  if (pct >= 70) return "#d97706";
  return "var(--green-600)";
}

export function UsageLimits() {
  const [limits, setLimits] = useState<PositionLimit[]>([]);
  const [positions, setPositions] = useState<PositionState[]>([]);
  const [usage, setUsage] = useState<UsageMap>({});
  const [loading, setLoading] = useState(true);

  // Form state
  const [editPosition, setEditPosition] = useState("");
  const [editType, setEditType] = useState<"cycles" | "hours">("cycles");
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, p, u] = await Promise.all([getPositionLimits(), getState(), getAllUsage()]);
      setLimits(l);
      setPositions(p);
      setUsage(u);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    if (!editPosition || !editValue) return;
    setSaving(true);
    try {
      await upsertPositionLimit(editPosition, editType, parseFloat(editValue));
      setEditPosition("");
      setEditValue("");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save");
    }
    setSaving(false);
  }

  async function handleDelete(position: string) {
    if (!confirm("Remove this usage limit?")) return;
    try {
      await deletePositionLimit(position);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  if (loading) return null;

  const configuredPositions = new Set(limits.map((l) => l.position));
  const availablePositions = positions.filter((p) => !configuredPositions.has(p.position));

  return (
    <div className="usage-limits">
      <h2>Part Usage Limits</h2>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1rem" }}>
        Set cycle or hour limits for each position. Parts approaching their limit will appear as alerts on the Dashboard.
      </p>

      {/* Add / edit form */}
      <div className="limits-form" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "1.5rem" }}>
        <div className="field" style={{ minWidth: 180 }}>
          <label>Position</label>
          <select value={editPosition} onChange={(e) => setEditPosition(e.target.value)}>
            <option value="">— Select —</option>
            {availablePositions.map((p) => (
              <option key={p.position} value={p.position}>{p.display_name}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ minWidth: 100 }}>
          <label>Limit Type</label>
          <select value={editType} onChange={(e) => setEditType(e.target.value as "cycles" | "hours")}>
            <option value="cycles">Cycles</option>
            <option value="hours">Hours</option>
          </select>
        </div>
        <div className="field" style={{ minWidth: 120 }}>
          <label>Limit Value</label>
          <input
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="e.g. 50000"
            min="1"
          />
        </div>
        <button
          className="btn btn-primary"
          style={{ width: "auto", height: "fit-content" }}
          onClick={handleSave}
          disabled={saving || !editPosition || !editValue}
        >
          {saving ? "Saving..." : "Add Limit"}
        </button>
      </div>

      {/* Limits table */}
      {limits.length === 0 ? (
        <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No limits configured yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Position</th>
                <th>Limit Type</th>
                <th>Limit</th>
                <th>Current Usage</th>
                <th>% Used</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {limits.map((l) => {
                const u = usage[l.position];
                const current = l.limit_type === "cycles" ? u?.est_cycles : u?.runtime_hours;
                const pct = current && l.limit_value > 0 ? (current / l.limit_value) * 100 : null;
                return (
                  <tr key={l.position}>
                    <td><strong>{l.display_name}</strong></td>
                    <td style={{ textTransform: "capitalize" }}>{l.limit_type}</td>
                    <td>{l.limit_type === "cycles" ? fmtNum(l.limit_value) : fmtNum(l.limit_value, 1)}</td>
                    <td>
                      {l.limit_type === "cycles"
                        ? fmtNum(current, 0)
                        : fmtNum(current, 1)}
                      {l.limit_type === "hours" && current != null ? " hrs" : ""}
                    </td>
                    <td>
                      {pct != null ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <div className="health-bar-track" style={{ width: 80 }}>
                            <div
                              className="health-bar-fill"
                              style={{ width: `${Math.min(pct, 100)}%`, background: healthColor(pct) }}
                            />
                          </div>
                          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: healthColor(pct) }}>
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      ) : "—"}
                    </td>
                    <td>
                      <button className="btn-revert" onClick={() => handleDelete(l.position)}>Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
