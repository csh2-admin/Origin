import { useEffect, useState } from "react";
import { getTestLog, createTestLogEntry, updateTestLogEntry, deleteTestLogEntry } from "../api/client";
import type { TestLogEntry } from "../types";

const ET_OFFSET_SUMMER = -4;
const ET_OFFSET_WINTER = -5;

function isDST(d: Date): boolean {
  const jan = new Date(d.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(d.getFullYear(), 6, 1).getTimezoneOffset();
  return d.getTimezoneOffset() < Math.max(jan, jul);
}

function etOffsetHours(d: Date): number {
  return isDST(d) ? ET_OFFSET_SUMMER : ET_OFFSET_WINTER;
}

function localETtoUTC(dateStr: string, timeStr: string): string | null {
  if (!dateStr || !timeStr) return null;
  const local = new Date(`${dateStr}T${timeStr}`);
  if (isNaN(local.getTime())) return null;
  const offset = etOffsetHours(local);
  const utc = new Date(local.getTime() - offset * 3600_000);
  return utc.toISOString();
}

function utcToETDisplay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}

function utcDisplay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function utcToETInputs(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const date = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
  const time = `${String(et.getHours()).padStart(2, "0")}:${String(et.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

function fmtUpdated(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const inputStyle: React.CSSProperties = { width: "100%", padding: "0.4rem 0.6rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "0.85rem" };

export function TestLog({ engineer }: { engineer: string }) {
  const [activeTab, setActiveTab] = useState<"log" | "feed">("feed");
  const [entries, setEntries] = useState<TestLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // New entry form
  const [testId, setTestId] = useState("");
  const [testName, setTestName] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [summary, setSummary] = useState("");
  const [objective, setObjective] = useState("");
  const [knownIssues, setKnownIssues] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Edit modal
  const [editing, setEditing] = useState<TestLogEntry | null>(null);
  const [editTestName, setEditTestName] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editObjective, setEditObjective] = useState("");
  const [editKnownIssues, setEditKnownIssues] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedSearch, setFeedSearch] = useState("");

  async function load() {
    try { setEntries(await getTestLog()); } catch { /* */ }
  }

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const startUTC = localETtoUTC(startDate, startTime);
  const endUTC = endDate && endTime ? localETtoUTC(endDate, endTime) : null;

  async function handleSave() {
    if (!testId.trim() || !testName.trim() || !startUTC) return;
    setSaving(true); setError("");
    try {
      await createTestLogEntry({
        test_id: testId.trim(),
        test_name: testName.trim(),
        start_utc: startUTC,
        end_utc: endUTC,
        summary: summary.trim() || null,
        objective: objective.trim() || null,
        known_issues: knownIssues.trim() || null,
        operator: engineer,
      });
      setSaved(true);
      setTestId(""); setTestName(""); setStartDate(todayStr()); setStartTime(""); setEndDate(""); setEndTime("");
      setSummary(""); setObjective(""); setKnownIssues("");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
    setSaving(false);
  }

  function openEdit(e: TestLogEntry) {
    setEditing(e);
    setEditTestName(e.test_name);
    const s = utcToETInputs(e.start_utc);
    setEditStartDate(s.date); setEditStartTime(s.time);
    if (e.end_utc) {
      const en = utcToETInputs(e.end_utc);
      setEditEndDate(en.date); setEditEndTime(en.time);
    } else {
      setEditEndDate(""); setEditEndTime("");
    }
    setEditSummary(e.summary || "");
    setEditObjective(e.objective || "");
    setEditKnownIssues(e.known_issues || "");
  }

  async function handleEditSave() {
    if (!editing || !editTestName.trim()) return;
    const editStartUTC = localETtoUTC(editStartDate, editStartTime);
    if (!editStartUTC) return;
    const editEndUTC = editEndDate && editEndTime ? localETtoUTC(editEndDate, editEndTime) : null;
    setEditSaving(true);
    try {
      await updateTestLogEntry(editing.test_id, {
        test_name: editTestName.trim(),
        start_utc: editStartUTC,
        end_utc: editEndUTC,
        summary: editSummary.trim() || null,
        objective: editObjective.trim() || null,
        known_issues: editKnownIssues.trim() || null,
      });
      await load();
    } catch { /* */ }
    setEditSaving(false); setEditing(null);
  }

  async function handleDelete(testId: string) {
    try { await deleteTestLogEntry(testId); await load(); } catch { /* */ }
    setConfirmDeleteId(null);
  }

  const filtered = entries.filter((e) => {
    if (!feedSearch.trim()) return true;
    const q = feedSearch.trim().toLowerCase();
    return e.test_id.toLowerCase().includes(q) || e.test_name.toLowerCase().includes(q) ||
      (e.summary || "").toLowerCase().includes(q) || (e.objective || "").toLowerCase().includes(q) ||
      (e.operator || "").toLowerCase().includes(q);
  });

  return (
    <div className="field-notes-page">
      <h2>Test Log</h2>
      <div className="weebo-tabs" style={{ marginBottom: "1.25rem" }}>
        <button className={`weebo-tab${activeTab === "log" ? " active" : ""}`} onClick={() => setActiveTab("log")}>Log Test</button>
        <button className={`weebo-tab${activeTab === "feed" ? " active" : ""}`} onClick={() => setActiveTab("feed")}>Test Log Feed</button>
      </div>

      {activeTab === "log" ? (
        <>
          <p className="field-notes-subtitle">Log a test with time boundaries. Times are entered in Eastern Time and converted to UTC.</p>

          {error && <div className="wne-error">{error}</div>}
          {saved && <div className="field-notes-success">Test logged successfully.</div>}

          <div className="dash-card field-notes-input-card">
            <div className="dash-card-header">New Test Entry</div>
            <div className="dash-card-body">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label className="fn-modal-label">Test ID</label>
                  <input type="text" value={testId} onChange={(e) => { setTestId(e.target.value); setSaved(false); }}
                    placeholder="e.g. 2026-09-04_A" style={inputStyle} />
                </div>
                <div>
                  <label className="fn-modal-label">Test Name</label>
                  <input type="text" value={testName} onChange={(e) => { setTestName(e.target.value); setSaved(false); }}
                    placeholder="e.g. AOV step-down" style={inputStyle} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.75rem", marginTop: "0.75rem" }}>
                <div>
                  <label className="fn-modal-label">Start Date (ET)</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label className="fn-modal-label">Start Time (ET)</label>
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label className="fn-modal-label">End Date (ET)</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label className="fn-modal-label">End Time (ET)</label>
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inputStyle} />
                </div>
              </div>

              {startUTC && (
                <div style={{ marginTop: "0.5rem", padding: "0.5rem 0.75rem", background: "var(--surface-alt)", borderRadius: "var(--radius)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  <strong>UTC Preview:</strong> Start: {utcDisplay(startUTC)}{endUTC ? <> | End: {utcDisplay(endUTC)}</> : null}
                </div>
              )}

              <div style={{ marginTop: "0.75rem" }}>
                <label className="fn-modal-label">Objective</label>
                <textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)}
                  placeholder="What is this test trying to learn?" className="field-notes-textarea" />
              </div>

              <div style={{ marginTop: "0.5rem" }}>
                <label className="fn-modal-label">Summary</label>
                <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)}
                  placeholder="What happened? Free prose — no dropdowns." className="field-notes-textarea" />
              </div>

              <div style={{ marginTop: "0.5rem" }}>
                <label className="fn-modal-label">Known Issues</label>
                <textarea rows={2} value={knownIssues} onChange={(e) => setKnownIssues(e.target.value)}
                  placeholder="Data defects specific to this test, e.g. flow meter installed backwards..." className="field-notes-textarea" />
              </div>

              <div className="field-notes-actions">
                <button className="btn btn-primary field-notes-save-btn" onClick={handleSave}
                  disabled={saving || !testId.trim() || !testName.trim() || !startUTC}>
                  {saving ? "Saving..." : "Log Test"}
                </button>
                <button className="btn btn-secondary field-notes-discard-btn" onClick={() => {
                  setTestId(""); setTestName(""); setStartDate(todayStr()); setStartTime(""); setEndDate(""); setEndTime("");
                  setSummary(""); setObjective(""); setKnownIssues(""); setError(""); setSaved(false);
                }} disabled={saving}>Discard</button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <input type="text" placeholder="Search by ID, name, summary, or operator..." value={feedSearch} onChange={(e) => setFeedSearch(e.target.value)}
              style={{ width: "100%", maxWidth: "500px", ...inputStyle }} />
          </div>
          <div className="dash-card">
            <div className="dash-card-header">Test Log ({filtered.length})</div>
            <div className="dash-card-body">
              {loading ? (
                <p className="field-notes-empty">Loading...</p>
              ) : filtered.length === 0 ? (
                <p className="field-notes-empty">No test log entries found.</p>
              ) : (
                <div className="field-notes-log">
                  {filtered.map((e) => (
                    <div key={e.test_id} className="field-notes-entry">
                      <div className="field-notes-entry-header">
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <strong style={{ fontSize: "0.95rem" }}>{e.test_id}</strong>
                          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>{e.test_name}</span>
                          {!e.end_utc && (
                            <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.4rem", borderRadius: "var(--radius)", background: "var(--accent)", color: "#fff" }}>In Progress</span>
                          )}
                        </div>
                        {e.operator && <span className="field-notes-entry-time">{e.operator}</span>}
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", margin: "0.4rem 0", fontSize: "0.8rem" }}>
                        <div>
                          <span style={{ color: "var(--text-secondary)" }}>Start (ET): </span>
                          <span>{utcToETDisplay(e.start_utc)}</span>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-secondary)" }}>End (ET): </span>
                          <span>{e.end_utc ? utcToETDisplay(e.end_utc) : "—"}</span>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-secondary)" }}>Start (UTC): </span>
                          <span style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{utcDisplay(e.start_utc)}</span>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-secondary)" }}>End (UTC): </span>
                          <span style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{e.end_utc ? utcDisplay(e.end_utc) : "—"}</span>
                        </div>
                      </div>

                      {e.objective && (
                        <div style={{ marginTop: "0.3rem" }}>
                          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)" }}>Objective: </span>
                          <span style={{ fontSize: "0.85rem" }}>{e.objective}</span>
                        </div>
                      )}
                      {e.summary && <p className="field-notes-entry-text">{e.summary}</p>}
                      {e.known_issues && (
                        <div style={{ marginTop: "0.3rem", padding: "0.4rem 0.6rem", background: "var(--surface-alt)", borderRadius: "var(--radius)", fontSize: "0.8rem" }}>
                          <span style={{ fontWeight: 600, color: "var(--red-600)" }}>Known Issues: </span>{e.known_issues}
                        </div>
                      )}

                      <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.5rem", alignItems: "center" }}>
                        <button className="btn btn-secondary fn-edit-btn" onClick={() => openEdit(e)}>Edit</button>
                        {confirmDeleteId === e.test_id ? (
                          <>
                            <button className="btn btn-secondary fn-edit-btn" style={{ color: "var(--red-600)" }} onClick={() => handleDelete(e.test_id)}>Confirm Delete</button>
                            <button className="btn btn-secondary fn-edit-btn" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                          </>
                        ) : (
                          <button className="btn btn-secondary fn-edit-btn" onClick={() => setConfirmDeleteId(e.test_id)}>Delete</button>
                        )}
                        <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--text-secondary)" }}>Updated {fmtUpdated(e.updated_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {editing && (
        <div className="fn-modal-overlay" onClick={() => setEditing(null)}>
          <div className="fn-modal" style={{ maxWidth: "650px" }} onClick={(e) => e.stopPropagation()}>
            <div className="fn-modal-header">
              <h3>Edit Test — {editing.test_id}</h3>
              <button className="fn-modal-close" onClick={() => setEditing(null)}>&times;</button>
            </div>
            <div className="fn-modal-body">
              <label className="fn-modal-label">Test Name</label>
              <input type="text" value={editTestName} onChange={(e) => setEditTestName(e.target.value)} style={inputStyle} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.5rem", marginTop: "0.75rem" }}>
                <div>
                  <label className="fn-modal-label" style={{ marginBottom: "0.2rem" }}>Start Date (ET)</label>
                  <input type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label className="fn-modal-label" style={{ marginBottom: "0.2rem" }}>Start Time (ET)</label>
                  <input type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label className="fn-modal-label" style={{ marginBottom: "0.2rem" }}>End Date (ET)</label>
                  <input type="date" value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label className="fn-modal-label" style={{ marginBottom: "0.2rem" }}>End Time (ET)</label>
                  <input type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} style={inputStyle} />
                </div>
              </div>

              {editStartDate && editStartTime && (
                <div style={{ marginTop: "0.5rem", padding: "0.5rem 0.75rem", background: "var(--surface-alt)", borderRadius: "var(--radius)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  <strong>UTC Preview:</strong> Start: {utcDisplay(localETtoUTC(editStartDate, editStartTime))}
                  {editEndDate && editEndTime ? <> | End: {utcDisplay(localETtoUTC(editEndDate, editEndTime))}</> : null}
                </div>
              )}

              <div style={{ marginTop: "0.75rem" }}>
                <label className="fn-modal-label">Objective</label>
                <textarea rows={2} value={editObjective} onChange={(e) => setEditObjective(e.target.value)}
                  className="field-notes-textarea" placeholder="What is this test trying to learn?" />
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <label className="fn-modal-label">Summary</label>
                <textarea rows={3} value={editSummary} onChange={(e) => setEditSummary(e.target.value)}
                  className="field-notes-textarea" placeholder="What happened?" />
              </div>
              <div style={{ marginTop: "0.5rem" }}>
                <label className="fn-modal-label">Known Issues</label>
                <textarea rows={2} value={editKnownIssues} onChange={(e) => setEditKnownIssues(e.target.value)}
                  className="field-notes-textarea" placeholder="Data defects specific to this test..." />
              </div>
            </div>
            <div className="fn-modal-footer">
              <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleEditSave}
                disabled={editSaving || !editTestName.trim() || !editStartDate || !editStartTime}>
                {editSaving ? "Saving..." : "Save"}
              </button>
              <button className="btn btn-secondary" style={{ width: "auto" }} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
