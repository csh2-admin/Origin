import { useCallback, useEffect, useState } from "react";
import { deleteMemo, getEngineers, getMemos, updateMemo } from "../api/client";
import type { MemoEntry } from "../types";

const ACTIVITY_TYPES = [
  "Action Item",
  "Qualitative Observation",
  "System Maintenance",
  "Performance - Quantitative",
  "Hypothesis",
  "Other",
];

const SEVERITIES = ["Critical", "High", "Medium", "Low", "None"];

function severityClass(s: string | null) {
  if (!s) return "";
  return `sev-${s.toLowerCase()}`;
}

export function WeeboRecords() {
  const [memos, setMemos] = useState<MemoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [engineers, setEngineers] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editing, setEditing] = useState<MemoEntry | null>(null);
  const [saving, setSaving] = useState(false);

  // Filters
  const [fEngineer, setFEngineer] = useState("");
  const [fActivity, setFActivity] = useState("");
  const [fSeverity, setFSeverity] = useState("");
  const [fSearch, setFSearch] = useState("");
  const [fDateFrom, setFDateFrom] = useState("");
  const [fDateTo, setFDateTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters: Record<string, string> = {};
      if (fEngineer) filters.engineer = fEngineer;
      if (fActivity) filters.activity_type = fActivity;
      if (fSeverity) filters.severity = fSeverity;
      if (fSearch) filters.search = fSearch;
      if (fDateFrom) filters.date_from = fDateFrom;
      if (fDateTo) filters.date_to = fDateTo;
      const data = await getMemos(filters);
      setMemos(data);
    } catch { /* auth handled elsewhere */ }
    setLoading(false);
  }, [fEngineer, fActivity, fSeverity, fSearch, fDateFrom, fDateTo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    getEngineers().then(setEngineers).catch(() => {});
  }, []);

  function toggleExpand(id: number) {
    if (expanded === id) {
      setExpanded(null);
      setEditing(null);
    } else {
      setExpanded(id);
      setEditing(null);
    }
  }

  function startEdit(memo: MemoEntry) {
    setEditing({ ...memo });
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await updateMemo(editing.id, editing as unknown as Record<string, unknown>);
      setMemos((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditing(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    }
    setSaving(false);
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this record permanently?")) return;
    try {
      await deleteMemo(id);
      setMemos((prev) => prev.filter((m) => m.id !== id));
      setExpanded(null);
      setEditing(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function editField(field: keyof MemoEntry, value: string | boolean | number | null) {
    if (!editing) return;
    setEditing({ ...editing, [field]: value });
  }

  return (
    <div className="weebo-records">
      <h2>Records</h2>

      {/* Filter bar */}
      <div className="wr-filters">
        <select value={fEngineer} onChange={(e) => setFEngineer(e.target.value)}>
          <option value="">All Engineers</option>
          {engineers.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
        <select value={fActivity} onChange={(e) => setFActivity(e.target.value)}>
          <option value="">All Activities</option>
          {ACTIVITY_TYPES.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select value={fSeverity} onChange={(e) => setFSeverity(e.target.value)}>
          <option value="">All Severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search..."
          value={fSearch}
          onChange={(e) => setFSearch(e.target.value)}
        />
        <input type="date" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} title="From" />
        <input type="date" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} title="To" />
      </div>

      {/* Results count */}
      <div className="wr-count">
        {loading ? "Loading..." : `${memos.length} record${memos.length !== 1 ? "s" : ""}`}
      </div>

      {/* Records list */}
      <div className="wr-list">
        {memos.map((m) => (
          <div key={m.id} className={`wr-row${expanded === m.id ? " expanded" : ""}`}>
            <div className="wr-row-header" onClick={() => toggleExpand(m.id)}>
              <span className={`wr-sev ${severityClass(m.severity)}`}>{m.severity || "—"}</span>
              <span className="wr-date">{new Date(m.logged_at).toLocaleDateString()}</span>
              <span className="wr-engineer">{m.engineer}</span>
              <span className="wr-activity">{m.activity_type || "—"}</span>
              <span className="wr-summary">{m.summary || "—"}</span>
              <span className="wr-chevron">{expanded === m.id ? "▲" : "▼"}</span>
            </div>

            {expanded === m.id && !editing && (
              <div className="wr-detail">
                <div className="wr-detail-grid">
                  <Detail label="Summary" value={m.summary} />
                  <Detail label="System Performance" value={m.system_performance} />
                  <Detail label="Maintenance Done" value={m.maintenance_done} />
                  <Detail label="Issues Found" value={m.issues_found} />
                  <Detail label="Action Items" value={m.action_items} />
                  <Detail label="Components Affected" value={m.components_affected} />
                  <Detail label="Duration (hrs)" value={m.duration_hours != null ? String(m.duration_hours) : null} />
                  <Detail label="Additional Notes" value={m.additional_notes} />
                  {m.raw_transcript && <Detail label="Transcript" value={m.raw_transcript} full />}
                </div>
                <div className="wr-detail-actions">
                  <button className="btn btn-primary" style={{ width: "auto" }} onClick={() => startEdit(m)}>Edit</button>
                  <button className="btn btn-danger" style={{ width: "auto" }} onClick={() => handleDelete(m.id)}>Delete</button>
                </div>
              </div>
            )}

            {expanded === m.id && editing && (
              <div className="wr-detail wr-edit-form">
                <div className="wr-edit-grid">
                  <EditField label="Engineer" value={editing.engineer} onChange={(v) => editField("engineer", v)} />
                  <div className="wr-edit-field">
                    <label>Activity Type</label>
                    <select value={editing.activity_type || ""} onChange={(e) => editField("activity_type", e.target.value)}>
                      <option value="">—</option>
                      {ACTIVITY_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div className="wr-edit-field">
                    <label>Severity</label>
                    <select value={editing.severity || ""} onChange={(e) => editField("severity", e.target.value)}>
                      <option value="">—</option>
                      {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <EditField label="Duration (hrs)" value={editing.duration_hours != null ? String(editing.duration_hours) : ""} onChange={(v) => editField("duration_hours", v ? parseFloat(v) : null)} />
                  <EditArea label="Summary" value={editing.summary || ""} onChange={(v) => editField("summary", v)} />
                  <EditArea label="System Performance" value={editing.system_performance || ""} onChange={(v) => editField("system_performance", v)} />
                  <EditArea label="Maintenance Done" value={editing.maintenance_done || ""} onChange={(v) => editField("maintenance_done", v)} />
                  <EditArea label="Issues Found" value={editing.issues_found || ""} onChange={(v) => editField("issues_found", v)} />
                  <EditArea label="Action Items" value={editing.action_items || ""} onChange={(v) => editField("action_items", v)} />
                  <EditField label="Components Affected" value={editing.components_affected || ""} onChange={(v) => editField("components_affected", v)} />
                  <EditArea label="Additional Notes" value={editing.additional_notes || ""} onChange={(v) => editField("additional_notes", v)} />
                  <EditArea label="Transcript" value={editing.raw_transcript || ""} onChange={(v) => editField("raw_transcript", v)} />
                </div>
                <div className="wr-detail-actions">
                  <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleSave} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button className="btn btn-secondary" style={{ width: "auto" }} onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {!loading && memos.length === 0 && (
          <div className="wr-empty">No records found.</div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value, full }: { label: string; value: string | null; full?: boolean }) {
  if (!value) return null;
  return (
    <div className={`wr-detail-item${full ? " full" : ""}`}>
      <div className="wr-detail-label">{label}</div>
      <div className="wr-detail-value">{value}</div>
    </div>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="wr-edit-field">
      <label>{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function EditArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="wr-edit-field full">
      <label>{label}</label>
      <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
