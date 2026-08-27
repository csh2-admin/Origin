import { useCallback, useEffect, useState } from "react";
import { getDailyLog, updateFieldNote, deleteFieldNote, getReplies, createReply } from "../api/client";
import type { Reply } from "../api/client";
import type { DailyLog as DailyLogData } from "../types";
import { Lightbox } from "./Lightbox";

const CATEGORIES = ["Action Item", "Assembly Note", "Logistics", "System Maintenance", "Performance", "Other"] as const;
const TEAM_MEMBERS = ["jimmyli", "edwardyoun", "anthonyku", "pjcallahan", "tomtodaro"] as const;
type Category = typeof CATEGORIES[number];

function parsePhotos(audioUrl: string | null): string[] {
  if (!audioUrl) return [];
  try {
    const parsed = JSON.parse(audioUrl);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* not JSON, treat as single URL */ }
  return [audioUrl];
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

function duration(start: string, end: string | null): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    "Action Item": "var(--red-600)",
    "Assembly Note": "#b8860b",
    "Logistics": "#6a5acd",
    "System Maintenance": "var(--accent)",
    "Performance": "var(--green-600)",
    "Other": "var(--text-secondary)",
    "Unprocessed": "var(--text-secondary)",
  };
  const color = colors[category] || "var(--text-secondary)";
  return (
    <span className="fn-category-badge" style={{ borderColor: color, color }}>
      {category}
    </span>
  );
}

function ReplyThread({ noteId, engineer, replyCount }: { noteId: number; engineer: string; replyCount: number }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    try { setReplies(await getReplies(noteId)); } catch { /* ignore */ }
    setLoading(false);
  }

  function toggle() { if (!open) load(); setOpen(!open); }

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    try {
      const r = await createReply(noteId, text.trim(), engineer);
      setReplies((prev) => [...prev, r]);
      setText("");
    } catch { /* ignore */ }
    setSending(false);
  }

  return (
    <div className="reply-thread">
      <button className="reply-toggle" onClick={toggle}>
        {open ? "Hide replies" : replyCount > 0 ? `${replyCount} ${replyCount === 1 ? "reply" : "replies"}` : "Reply"}
      </button>
      {open && (
        <div className="reply-list">
          {loading ? (
            <p className="reply-empty">Loading...</p>
          ) : replies.length === 0 ? (
            <p className="reply-empty">No replies yet.</p>
          ) : (
            replies.map((r) => (
              <div key={r.id} className="reply-item">
                <div className="reply-header">
                  <strong>{r.author}</strong>
                  <span className="reply-time">{fmtTime(r.created_at)}</span>
                </div>
                <p className="reply-text">{r.reply_text}</p>
              </div>
            ))
          )}
          <div className="reply-input-row">
            <input type="text" className="reply-input" placeholder="Write a reply..." value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button className="btn btn-primary reply-send" onClick={send} disabled={sending || !text.trim()}>
              {sending ? "..." : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DailyLog({ engineer }: { engineer: string }) {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState<DailyLogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [assigningNote, setAssigningNote] = useState<{ id: number; category: Category } | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [editingNote, setEditingNote] = useState<{ id: number; text: string; category: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getDailyLog(date);
      setData(d);
    } catch { /* ignore */ }
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  async function handleCategorize(noteId: number, category: Category) {
    if (category === "Action Item") {
      setAssigningNote({ id: noteId, category });
      setAssignTo("");
      return;
    }
    try {
      await updateFieldNote(noteId, { category });
      await load();
    } catch { /* ignore */ }
  }

  async function handleAssignSubmit() {
    if (!assigningNote) return;
    try {
      await updateFieldNote(assigningNote.id, {
        category: assigningNote.category,
        responsible: assignTo.trim() || undefined,
      });
      await load();
    } catch { /* ignore */ }
    setAssigningNote(null);
    setAssignTo("");
  }

  async function handleEditSave() {
    if (!editingNote || !editingNote.text.trim()) return;
    try {
      await updateFieldNote(editingNote.id, { note: editingNote.text, category: editingNote.category });
      await load();
    } catch { /* ignore */ }
    setEditingNote(null);
  }

  async function handleDelete(noteId: number) {
    try {
      await deleteFieldNote(noteId);
      await load();
    } catch { /* ignore */ }
    setConfirmDeleteId(null);
  }

  const fieldNotes = data?.field_notes.filter((n) => n.source_file === "Field Note" || n.source_file === "Voice Note") ?? [];
  const weeboMemos = data?.field_notes.filter((n) => n.source_file !== "Field Note" && n.source_file !== "Voice Note") ?? [];

  return (
    <div className="daily-log">
      <div className="daily-log-header">
        <h2>Daily Log</h2>
        <div className="daily-log-date-picker">
          <button className="btn btn-secondary" style={{ width: "auto", padding: "0.3rem 0.6rem" }} onClick={() => {
            const [y, m, day] = date.split("-").map(Number);
            const d = new Date(y, m - 1, day - 1);
            setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
          }}>&larr;</button>
          <input
            type="date"
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: "0.3rem 0.5rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
          />
          <button className="btn btn-secondary" style={{ width: "auto", padding: "0.3rem 0.6rem" }} onClick={() => {
            const [y, m, day] = date.split("-").map(Number);
            const d = new Date(y, m - 1, day + 1);
            const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            if (next <= todayStr()) setDate(next);
          }}>&rarr;</button>
          {date !== todayStr() && (
            <button className="btn btn-secondary" style={{ width: "auto", padding: "0.3rem 0.6rem", fontSize: "0.75rem" }} onClick={() => setDate(todayStr())}>
              Today
            </button>
          )}
        </div>
      </div>

      <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        {fmtDate(date + "T12:00:00")}
      </p>

      {loading ? (
        <p style={{ color: "var(--text-secondary)" }}>Loading...</p>
      ) : !data ? (
        <p style={{ color: "var(--text-secondary)" }}>Failed to load daily log.</p>
      ) : (
        <>
          {/* Test Runs */}
          <div className="dash-card" style={{ marginBottom: "1.25rem" }}>
            <div className="dash-card-header">Test Runs ({data.test_runs.length})</div>
            <div className="dash-card-body">
              {data.test_runs.length === 0 ? (
                <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No test runs this day.</p>
              ) : (
                <div className="daily-log-runs">
                  {data.test_runs.map((r) => (
                    <div key={r.id} className="daily-log-run-card">
                      <div className="daily-log-run-header">
                        <strong>{r.test_name || `Run #${r.id}`}</strong>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                          {r.test_type === "simplex" ? "Simplex" : "Triplex"}
                        </span>
                      </div>
                      <div className="daily-log-run-meta">
                        <span>Started by {r.started_by} at {fmtTime(r.started_at)}</span>
                        {r.completed_at ? (
                          <span className="status-badge completed" style={{ fontSize: "0.75rem" }}>Completed — {duration(r.started_at, r.completed_at)}</span>
                        ) : (
                          <span className="status-badge in-progress" style={{ fontSize: "0.75rem" }}>In Progress — Step: {r.current_step}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Field Notes — tagging / daily review */}
          <div className="dash-card" style={{ marginBottom: "1.25rem" }}>
            <div className="dash-card-header">Field Notes ({fieldNotes.length})</div>
            <div className="dash-card-body">
              {fieldNotes.length === 0 ? (
                <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No field notes this day.</p>
              ) : (
                <div className="field-notes-log">
                  {fieldNotes.map((n) => (
                    <div key={n.id} className="field-notes-entry">
                      <div className="field-notes-entry-header">
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <strong>{n.engineer}</strong>
                          {n.activity_type && n.activity_type !== "Unprocessed" && (
                            <CategoryBadge category={n.activity_type} />
                          )}
                        </div>
                        <span className="field-notes-entry-time">{fmtTime(n.logged_at)}</span>
                      </div>
                      <p className="field-notes-entry-text">{n.raw_transcript}</p>
                      {n.audio_url && (
                        <div className="field-notes-photo-grid">
                          {parsePhotos(n.audio_url).map((url, i) => (
                            <img key={i} src={url} alt={`Photo ${i + 1}`} className="field-notes-entry-photo" onClick={() => setLightboxSrc(url)} />
                          ))}
                        </div>
                      )}
                      {/* Category sort buttons */}
                      <div className="fn-sort-buttons" style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
                        {CATEGORIES.map((cat) => (
                          <button
                            key={cat}
                            className={`btn btn-secondary fn-sort-btn${n.activity_type === cat ? " active" : ""}`}
                            style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem" }}
                            onClick={() => handleCategorize(n.id, cat)}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                      {/* Assign-to dropdown for Action Items */}
                      {assigningNote?.id === n.id && (
                        <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.4rem", alignItems: "center" }}>
                          <select
                            value={assignTo}
                            onChange={(e) => setAssignTo(e.target.value)}
                            style={{ padding: "0.25rem 0.4rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "0.8rem" }}
                          >
                            <option value="">Assign to...</option>
                            {TEAM_MEMBERS.map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                          <button className="btn btn-primary" style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }} onClick={handleAssignSubmit}>Save</button>
                          <button className="btn btn-secondary" style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }} onClick={() => setAssigningNote(null)}>Cancel</button>
                        </div>
                      )}
                      {/* Edit / Delete */}
                      <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.4rem" }}>
                        <button className="btn btn-secondary fn-edit-btn" onClick={() => setEditingNote({ id: n.id, text: n.raw_transcript, category: n.activity_type || "Unprocessed" })}>Edit</button>
                        {confirmDeleteId === n.id ? (
                          <>
                            <button className="btn btn-secondary fn-edit-btn" style={{ color: "var(--red-600)" }} onClick={() => handleDelete(n.id)}>Confirm Delete</button>
                            <button className="btn btn-secondary fn-edit-btn" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                          </>
                        ) : (
                          <button className="btn btn-secondary fn-edit-btn" onClick={() => setConfirmDeleteId(n.id)}>Delete</button>
                        )}
                      </div>
                      <ReplyThread noteId={n.id} engineer={engineer} replyCount={n.reply_count ?? 0} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Weebo Memos */}
          {weeboMemos.length > 0 && (
            <div className="dash-card" style={{ marginBottom: "1.25rem" }}>
              <div className="dash-card-header">Weebo Entries ({weeboMemos.length})</div>
              <div className="dash-card-body">
                <div className="field-notes-log">
                  {weeboMemos.map((m) => (
                    <div key={m.id} className="field-notes-entry">
                      <div className="field-notes-entry-header">
                        <strong>{m.engineer}</strong>
                        <span className="field-notes-entry-time">{fmtTime(m.logged_at)}</span>
                      </div>
                      <p className="field-notes-entry-text">{m.summary || m.raw_transcript}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Change Events */}
          {data.change_events.length > 0 && (
            <div className="dash-card" style={{ marginBottom: "1.25rem" }}>
              <div className="dash-card-header">Configuration Changes ({data.change_events.length})</div>
              <div className="dash-card-body">
                <div className="field-notes-log">
                  {data.change_events.map((ce) => (
                    <div key={ce.id} className="field-notes-entry">
                      <div className="field-notes-entry-header">
                        <strong>{ce.display_name}</strong>
                        <span className="field-notes-entry-time">{fmtTime(ce.effective_time)}</span>
                      </div>
                      <p className="field-notes-entry-text">
                        {ce.removed_part_number && <>Removed: {ce.removed_part_number}{ce.removed_part_serial ? ` (S/N: ${ce.removed_part_serial})` : ""}<br /></>}
                        {ce.installed_part_number && <>Installed: {ce.installed_part_number}{ce.installed_part_serial ? ` (S/N: ${ce.installed_part_serial})` : ""}</>}
                        {ce.note && <><br />{ce.note}</>}
                      </p>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>by {ce.changed_by}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Asset Configuration */}
          <div className="dash-card" style={{ marginBottom: "1.25rem" }}>
            <div className="dash-card-header">Asset Model Configuration</div>
            <div className="dash-card-body">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Position</th>
                    <th>Part Number</th>
                    <th>Serial</th>
                    <th>Revision</th>
                  </tr>
                </thead>
                <tbody>
                  {data.asset_config.map((a) => (
                    <tr key={a.position}>
                      <td>{a.display_name}</td>
                      <td>{a.part_number || "—"}</td>
                      <td>{a.part_serial || "—"}</td>
                      <td>{a.part_revision || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      {editingNote && (
        <div className="fn-modal-overlay" onClick={() => setEditingNote(null)}>
          <div className="fn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fn-modal-header">
              <h3>Edit Note</h3>
              <button className="fn-modal-close" onClick={() => setEditingNote(null)}>&times;</button>
            </div>
            <div className="fn-modal-body">
              <label className="fn-modal-label">Note</label>
              <textarea
                rows={5}
                value={editingNote.text}
                onChange={(e) => setEditingNote({ ...editingNote, text: e.target.value })}
                className="field-notes-textarea"
              />
              <label className="fn-modal-label">Category</label>
              <div className="fn-category-picker">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    className={`fn-category-option${editingNote.category === c ? " active" : ""}`}
                    onClick={() => setEditingNote({ ...editingNote, category: c })}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="fn-modal-footer">
              <button className="btn btn-primary" onClick={handleEditSave} disabled={!editingNote.text.trim()}>Save</button>
              <button className="btn btn-secondary" onClick={() => setEditingNote(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
