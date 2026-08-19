import { useCallback, useEffect, useState } from "react";
import { createAction, deleteAction, getActions, getEngineers, updateAction } from "../api/client";
import type { ActionItem } from "../types";

const STATUSES = ["Not Started", "In Progress", "Complete"] as const;
const TEAM_MEMBERS = ["jimmyli", "edwardyoun", "anthonyku", "pjcallahan", "tomtodaro"] as const;

export function WeeboActions() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [engineers, setEngineers] = useState<string[]>([]);
  const [fEngineer, setFEngineer] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fSearch, setFSearch] = useState("");
  const [editing, setEditing] = useState<ActionItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ action_text: "", responsible: "", due_date: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const filters: Record<string, string> = {};
    if (fEngineer) filters.engineer = fEngineer;
    if (fStatus) filters.status = fStatus;
    if (fSearch) filters.search = fSearch;
    try {
      const data = await getActions(filters);
      setItems(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [fEngineer, fStatus, fSearch]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getEngineers().then(setEngineers).catch(() => {}); }, []);

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      await updateAction(editing.id, {
        status: editing.status,
        responsible: editing.responsible,
        due_date: editing.due_date || null,
        notes: editing.notes,
        action_text: editing.action_text,
      });
      setEditing(null);
      load();
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this action item?")) return;
    await deleteAction(id);
    load();
  }

  async function handleAdd() {
    if (!newItem.action_text.trim()) return;
    setSaving(true);
    try {
      await createAction({
        ...newItem,
        engineer: newItem.responsible || "",
        status: "Not Started",
      });
      setNewItem({ action_text: "", responsible: "", due_date: "", notes: "" });
      setShowAdd(false);
      load();
    } catch { /* ignore */ }
    setSaving(false);
  }

  const grouped = {
    "In Progress": items.filter((i) => i.status === "In Progress"),
    "Not Started": items.filter((i) => i.status === "Not Started"),
    "Complete": items.filter((i) => i.status === "Complete"),
  };

  const counts = {
    total: items.length,
    notStarted: grouped["Not Started"].length,
    inProgress: grouped["In Progress"].length,
    complete: grouped["Complete"].length,
  };

  return (
    <div className="weebo-actions">
      <div className="wa-header">
        <h2>Action Items</h2>
        <button className="btn btn-primary" style={{ width: "auto" }} onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "+ New Action"}
        </button>
      </div>

      {showAdd && (
        <div className="wa-add-form">
          <div className="wa-add-grid">
            <div className="wne-form-field full">
              <label>Action</label>
              <textarea rows={2} value={newItem.action_text}
                onChange={(e) => setNewItem({ ...newItem, action_text: e.target.value })}
                placeholder="Describe the action item..." />
            </div>
            <div className="wne-form-field">
              <label>Responsible</label>
              <select value={newItem.responsible}
                onChange={(e) => setNewItem({ ...newItem, responsible: e.target.value })}>
                <option value="">Select...</option>
                {TEAM_MEMBERS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="wne-form-field">
              <label>Due Date</label>
              <input type="date" value={newItem.due_date}
                onChange={(e) => setNewItem({ ...newItem, due_date: e.target.value })} />
            </div>
            <div className="wne-form-field full">
              <label>Notes</label>
              <textarea rows={2} value={newItem.notes}
                onChange={(e) => setNewItem({ ...newItem, notes: e.target.value })} />
            </div>
          </div>
          <div className="wne-actions">
            <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleAdd} disabled={saving || !newItem.action_text.trim()}>
              {saving ? "Saving..." : "Add Action"}
            </button>
          </div>
        </div>
      )}

      <div className="wa-summary">
        <span className="wa-pill">{counts.total} Total</span>
        <span className="wa-pill not-started">{counts.notStarted} Not Started</span>
        <span className="wa-pill in-progress">{counts.inProgress} In Progress</span>
        <span className="wa-pill complete">{counts.complete} Complete</span>
      </div>

      <div className="wr-filters">
        <select value={fEngineer} onChange={(e) => setFEngineer(e.target.value)}>
          <option value="">All Engineers</option>
          {engineers.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="text" placeholder="Search..." value={fSearch}
          onChange={(e) => setFSearch(e.target.value)} />
      </div>

      {loading ? (
        <p style={{ padding: "1rem", color: "var(--gray-500)" }}>Loading...</p>
      ) : items.length === 0 ? (
        <p style={{ padding: "1rem", color: "var(--gray-500)" }}>No action items found.</p>
      ) : (
        Object.entries(grouped).map(([status, group]) =>
          group.length > 0 && (
            <div key={status} className="wa-group">
              <h3 className="wa-group-title">{status} ({group.length})</h3>
              {group.map((item) => (
                <div key={item.id} className="wa-item">
                  {editing?.id === item.id ? (
                    <div className="wa-edit-form">
                      <div className="wne-form-field full">
                        <label>Action</label>
                        <textarea rows={2} value={editing.action_text}
                          onChange={(e) => setEditing({ ...editing, action_text: e.target.value })} />
                      </div>
                      <div className="wne-form-field">
                        <label>Status</label>
                        <select value={editing.status}
                          onChange={(e) => setEditing({ ...editing, status: e.target.value as ActionItem["status"] })}>
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="wne-form-field">
                        <label>Responsible</label>
                        <select value={editing.responsible || ""}
                          onChange={(e) => setEditing({ ...editing, responsible: e.target.value })}>
                          <option value="">Select...</option>
                          {TEAM_MEMBERS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div className="wne-form-field">
                        <label>Due Date</label>
                        <input type="date" value={editing.due_date || ""}
                          onChange={(e) => setEditing({ ...editing, due_date: e.target.value })} />
                      </div>
                      <div className="wne-form-field full">
                        <label>Notes</label>
                        <textarea rows={2} value={editing.notes || ""}
                          onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
                      </div>
                      <div className="wne-actions">
                        <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleSave} disabled={saving}>
                          {saving ? "Saving..." : "Save"}
                        </button>
                        <button className="btn btn-secondary" style={{ width: "auto" }} onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="wa-item-row">
                      <div className="wa-item-text">{item.action_text}</div>
                      <div className="wa-item-meta">
                        {item.responsible && <span>Responsible: {item.responsible}</span>}
                        {item.due_date && <span>Due: {new Date(item.due_date).toLocaleDateString()}</span>}
                        <span>Created: {new Date(item.created_at).toLocaleDateString()}</span>
                      </div>
                      {item.notes && <div className="wa-item-notes">{item.notes}</div>}
                      <div className="wa-item-actions">
                        <button className="btn btn-secondary" style={{ width: "auto", padding: "0.25rem 0.75rem", fontSize: "0.8rem" }}
                          onClick={() => setEditing({ ...item })}>Edit</button>
                        <button className="btn btn-secondary" style={{ width: "auto", padding: "0.25rem 0.75rem", fontSize: "0.8rem", color: "var(--red-600)" }}
                          onClick={() => handleDelete(item.id)}>Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )
      )}
    </div>
  );
}
