import { useCallback, useEffect, useState, useRef } from "react";
import { getActions, updateAction, getDailyLog, updateFieldNote, deleteFieldNote, getReplies, createReply } from "../api/client";
import type { Reply } from "../api/client";
import type { ActionItem } from "../types";
import type { DailyLog as DailyLogData } from "../types";
import { Lightbox } from "./Lightbox";

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CATEGORIES = ["Action Item", "Assembly Note", "Logistics", "Maintenance", "Performance", "Other"] as const;
const TEAM_MEMBERS = ["jimmyli", "edwardyoun", "anthonyku", "pjcallahan", "tomtodaro"] as const;
type Category = typeof CATEGORIES[number];

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dayLabel(d: Date): string {
  return SHORT_DAYS[d.getDay()];
}

function statusColor(status: string): string {
  if (status === "Complete") return "var(--green-600)";
  if (status === "In Progress") return "var(--accent)";
  return "var(--text-secondary)";
}

function todayDate(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/* ── Daily-log helpers (prefixed dl* to avoid conflicts) ── */

function dlFmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

function dlFmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

function dlDuration(start: string, end: string | null): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function parsePhotos(audioUrl: string | null): string[] {
  if (!audioUrl) return [];
  try {
    const parsed = JSON.parse(audioUrl);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* not JSON, treat as single URL */ }
  return [audioUrl];
}

function parseTags(activityType: string | null): string[] {
  if (!activityType || activityType === "Unprocessed") return [];
  return activityType.split(",").map((t) => t.trim()).filter(Boolean);
}

function toggleTag(current: string | null, tag: string): string {
  const tags = parseTags(current);
  const idx = tags.indexOf(tag);
  if (idx >= 0) tags.splice(idx, 1);
  else tags.push(tag);
  return tags.length === 0 ? "Unprocessed" : tags.join(",");
}

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    "Action Item": "var(--red-600)",
    "Assembly Note": "#b8860b",
    "Logistics": "#6a5acd",
    "Maintenance": "var(--accent)",
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
                  <span className="reply-time">{dlFmtTime(r.created_at)}</span>
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

/* ── Test cards (localStorage) ── */

interface TestCard {
  id: string;
  title: string;
  date: string;
}

const STORAGE_KEY = "origin-test-cards";

function loadTestCards(): TestCard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveTestCards(cards: TestCard[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cards)); } catch { /* ignore */ }
}

/* ── Main component ── */

export function WeekLookAhead({ engineer }: { engineer: string }) {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(todayDate);
  const [testCards, setTestCards] = useState<TestCard[]>(loadTestCards);
  const [addingDate, setAddingDate] = useState<string | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [editingCard, setEditingCard] = useState<TestCard | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const dragCard = useRef<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  /* ── Selected day / daily log state ── */
  const [selectedDate, setSelectedDate] = useState<string | null>(fmtDate(todayDate()));
  const [dlData, setDlData] = useState<DailyLogData | null>(null);
  const [dlLoading, setDlLoading] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [assigningNote, setAssigningNote] = useState<{ id: number; category: Category; currentType: string } | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [editingNote, setEditingNote] = useState<{ id: number; text: string; category: string; actionItem?: ActionItem | null; actionStatus: string; actionResponsible: string; actionDueDate: string; actionNotes: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [notesAsc, setNotesAsc] = useState(true);
  const [completingAction, setCompletingAction] = useState<ActionItem | null>(null);
  const [completeNote, setCompleteNote] = useState("");
  const [completeSaving, setCompleteSaving] = useState(false);

  async function handleCompleteAction() {
    if (!completingAction) return;
    setCompleteSaving(true);
    try {
      await updateAction(completingAction.id, {
        status: "Complete",
        notes: completeNote.trim() || completingAction.notes || "",
        completed_by: engineer,
      });
      setActions((prev) => prev.map((a) => a.id === completingAction.id ? { ...a, status: "Complete" as const, notes: completeNote.trim() || a.notes } : a));
    } catch { /* ignore */ }
    setCompleteSaving(false);
    setCompletingAction(null);
    setCompleteNote("");
  }

  useEffect(() => {
    setLoading(true);
    getActions()
      .then(setActions)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { saveTestCards(testCards); }, [testCards]);

  /* ── Load daily log when selectedDate changes ── */
  const loadDailyLog = useCallback(async () => {
    if (!selectedDate) return;
    setDlLoading(true);
    try {
      const d = await getDailyLog(selectedDate);
      setDlData(d);
    } catch { /* ignore */ }
    setDlLoading(false);
  }, [selectedDate]);

  useEffect(() => { loadDailyLog(); }, [loadDailyLog]);

  /* ── Daily log handlers ── */
  async function handleCategorize(noteId: number, category: Category, currentActivityType: string) {
    const currentTags = parseTags(currentActivityType);
    const isAdding = !currentTags.includes(category);
    if (isAdding && category === "Action Item") {
      setAssigningNote({ id: noteId, category, currentType: currentActivityType });
      setAssignTo("");
      return;
    }
    const newValue = toggleTag(currentActivityType, category);
    try {
      await updateFieldNote(noteId, { category: newValue });
      await loadDailyLog();
    } catch { /* ignore */ }
  }

  async function handleAssignSubmit() {
    if (!assigningNote) return;
    const newValue = toggleTag(assigningNote.currentType, assigningNote.category);
    try {
      await updateFieldNote(assigningNote.id, {
        category: newValue,
        responsible: assignTo.trim() || undefined,
      });
      await loadDailyLog();
    } catch { /* ignore */ }
    setAssigningNote(null);
    setAssignTo("");
  }

  async function openEditNote(n: { id: number; raw_transcript: string; activity_type: string }) {
    const base = { id: n.id, text: n.raw_transcript, category: n.activity_type || "Unprocessed", actionItem: null as ActionItem | null, actionStatus: "Not Started", actionResponsible: "", actionDueDate: "", actionNotes: "" };
    if (parseTags(n.activity_type).includes("Action Item")) {
      try {
        const items = await getActions({ memo_id: String(n.id) });
        if (items.length > 0) {
          const ai = items[0];
          base.actionItem = ai;
          base.actionStatus = ai.status;
          base.actionResponsible = ai.responsible || "";
          base.actionDueDate = ai.due_date || "";
          base.actionNotes = ai.notes || "";
        }
      } catch { /* ignore */ }
    }
    setEditingNote(base);
  }

  async function handleEditSave() {
    if (!editingNote || !editingNote.text.trim()) return;
    try {
      await updateFieldNote(editingNote.id, { note: editingNote.text, category: editingNote.category, responsible: parseTags(editingNote.category).includes("Action Item") ? (editingNote.actionResponsible || undefined) : undefined });
      if (parseTags(editingNote.category).includes("Action Item") && editingNote.actionItem) {
        await updateAction(editingNote.actionItem.id, {
          action_text: editingNote.text,
          status: editingNote.actionStatus,
          responsible: editingNote.actionResponsible || null,
          due_date: editingNote.actionDueDate || null,
          notes: editingNote.actionNotes || null,
        });
      }
      await loadDailyLog();
    } catch { /* ignore */ }
    setEditingNote(null);
  }

  async function handleDelete(noteId: number) {
    try {
      await deleteFieldNote(noteId);
      await loadDailyLog();
    } catch { /* ignore */ }
    setConfirmDeleteId(null);
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    return { label: dayLabel(d), date: fmtDate(d), dateObj: d };
  });

  const today = fmtDate(todayDate());
  const openActions = actions.filter((a) => a.status !== "Complete");
  const noDueDate = openActions.filter((a) => !a.due_date);


  function shiftDays(n: number) {
    setStartDate(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + n));
  }

  function handleDayClick(date: string) {
    setSelectedDate((prev) => (prev === date ? null : date));
  }

  function addTestCard(date: string) {
    if (!addTitle.trim()) return;
    const card: TestCard = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: addTitle.trim(), date };
    setTestCards((prev) => [...prev, card]);
    setAddTitle("");
    setAddingDate(null);
  }

  function deleteTestCard(id: string) {
    setTestCards((prev) => prev.filter((c) => c.id !== id));
  }

  function saveEditCard() {
    if (!editingCard || !editTitle.trim()) return;
    setTestCards((prev) => prev.map((c) => c.id === editingCard.id ? { ...c, title: editTitle.trim() } : c));
    setEditingCard(null);
    setEditTitle("");
  }

  function handleDragStart(cardId: string) {
    dragCard.current = cardId;
  }

  function handleDragOver(e: React.DragEvent, date: string) {
    e.preventDefault();
    setDragOverDate(date);
  }

  function handleDragLeave() {
    setDragOverDate(null);
  }

  function handleDrop(date: string) {
    if (dragCard.current) {
      setTestCards((prev) => prev.map((c) => c.id === dragCard.current ? { ...c, date } : c));
      dragCard.current = null;
    }
    setDragOverDate(null);
  }

  const dlFieldNotes = dlData?.field_notes.filter((n) => n.source_file === "Field Note" || n.source_file === "Voice Note") ?? [];

  return (
    <div className="week-look-ahead">
      <h2>1-Week Look Ahead</h2>

      {/* Action Items */}
      <div className="dash-card" style={{ marginBottom: "1.25rem" }}>
        <div className="dash-card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Action Items</span>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.7rem", padding: "0.15rem 0.5rem" }} onClick={() => shiftDays(-7)}>&larr;</button>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", minWidth: "150px", textAlign: "center" }}>
              {fmtShort(days[0].dateObj)} — {fmtShort(days[6].dateObj)}
            </span>
            <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.7rem", padding: "0.15rem 0.5rem" }} onClick={() => shiftDays(7)}>&rarr;</button>
            <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.7rem", padding: "0.15rem 0.5rem" }} onClick={() => { setStartDate(todayDate()); setSelectedDate(fmtDate(todayDate())); }}>Today</button>
          </div>
        </div>
        <div className="dash-card-body">
          {loading ? (
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Loading...</p>
          ) : (
            <>
              <div className="week-calendar">
                {days.map((day) => {
                  const dayActions = openActions.filter((a) => a.due_date === day.date);
                  const isTodayCol = day.date === today;
                  const isSelected = day.date === selectedDate;
                  return (
                    <div
                      key={day.date}
                      className={`week-day${isTodayCol ? " week-day-today" : ""}${isSelected ? " week-day-selected" : ""}`}
                      onClick={() => handleDayClick(day.date)}
                      style={{ cursor: "pointer" }}
                    >
                      <div className="week-day-header">
                        <span className="week-day-label">{day.label}</span>
                        <span className="week-day-date">{fmtShort(day.dateObj)}</span>
                      </div>
                      <div className="week-day-body">
                        {dayActions.length === 0 ? (
                          <p className="week-day-empty">—</p>
                        ) : (
                          dayActions.map((a) => (
                            <div key={a.id} className="week-action-item">
                              <span className="week-action-text">{a.action_text}</span>
                              <div className="week-action-meta">
                                {a.responsible && <span className="week-action-owner">{a.responsible}</span>}
                                <span style={{ color: statusColor(a.status), fontSize: "0.68rem" }}>{a.status}</span>
                              </div>
                              <button
                                className="fn-sort-btn"
                                style={{ fontSize: "0.65rem", padding: "0.15rem 0.4rem", marginTop: "0.2rem" }}
                                onClick={(e) => { e.stopPropagation(); setCompletingAction(a); setCompleteNote(a.notes || ""); }}
                              >
                                Complete
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {noDueDate.length > 0 && (
                <div style={{ marginTop: "0.75rem" }}>
                  <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>No due date ({noDueDate.length})</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {noDueDate.map((a) => (
                      <div key={a.id} className="week-action-item" style={{ flex: "0 0 auto", maxWidth: "250px" }}>
                        <span className="week-action-text">{a.action_text}</span>
                        {a.responsible && <span className="week-action-owner">{a.responsible}</span>}
                        <button
                          className="fn-sort-btn"
                          style={{ fontSize: "0.65rem", padding: "0.15rem 0.4rem", marginTop: "0.2rem" }}
                          onClick={() => { setCompletingAction(a); setCompleteNote(a.notes || ""); }}
                        >
                          Complete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tests to Run */}
      <div className="dash-card" style={{ marginBottom: "1.25rem" }}>
        <div className="dash-card-header">Tests to Run</div>
        <div className="dash-card-body">
          <div className="week-calendar">
            {days.map((day) => {
              const dayCards = testCards.filter((c) => c.date === day.date);
              const isTodayCol = day.date === today;
              const isDragOver = dragOverDate === day.date;
              return (
                <div
                  key={day.date}
                  className={`week-day${isTodayCol ? " week-day-today" : ""}${isDragOver ? " week-day-dragover" : ""}`}
                  onDragOver={(e) => handleDragOver(e, day.date)}
                  onDragLeave={handleDragLeave}
                  onDrop={() => handleDrop(day.date)}
                >
                  <div className="week-day-header">
                    <span className="week-day-label">{day.label}</span>
                    <span className="week-day-date">{fmtShort(day.dateObj)}</span>
                  </div>
                  <div className="week-day-body">
                    {dayCards.map((card) => (
                      <div
                        key={card.id}
                        className="week-test-card"
                        draggable
                        onDragStart={() => handleDragStart(card.id)}
                      >
                        {editingCard?.id === card.id ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") saveEditCard(); if (e.key === "Escape") setEditingCard(null); }}
                              className="week-test-input"
                              autoFocus
                            />
                            <div style={{ display: "flex", gap: "0.25rem" }}>
                              <button className="btn btn-primary" style={{ width: "auto", fontSize: "0.65rem", padding: "0.1rem 0.35rem" }} onClick={saveEditCard}>Save</button>
                              <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.65rem", padding: "0.1rem 0.35rem" }} onClick={() => setEditingCard(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span className="week-test-text">{card.title}</span>
                            <div className="week-test-actions">
                              <button className="week-test-btn" onClick={() => { setEditingCard(card); setEditTitle(card.title); }} title="Edit">&#x270E;</button>
                              <button className="week-test-btn" onClick={() => deleteTestCard(card.id)} title="Delete">&#x2715;</button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                    {addingDate === day.date ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        <input
                          type="text"
                          placeholder="Test name..."
                          value={addTitle}
                          onChange={(e) => setAddTitle(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") addTestCard(day.date); if (e.key === "Escape") setAddingDate(null); }}
                          className="week-test-input"
                          autoFocus
                        />
                        <div style={{ display: "flex", gap: "0.25rem" }}>
                          <button className="btn btn-primary" style={{ width: "auto", fontSize: "0.65rem", padding: "0.1rem 0.35rem" }} onClick={() => addTestCard(day.date)}>Add</button>
                          <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.65rem", padding: "0.1rem 0.35rem" }} onClick={() => setAddingDate(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="week-add-test-btn"
                        onClick={() => { setAddingDate(day.date); setAddTitle(""); }}
                      >
                        + Add Test
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {editingCard && null}

      {/* Daily Log — inline detail for selected day */}
      {selectedDate && (
        <div className="dash-card" style={{ marginBottom: "1.25rem" }}>
          <div className="dash-card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Daily Log — {dlFmtDate(selectedDate + "T12:00:00")}</span>
            <button
              className="btn btn-secondary"
              style={{ width: "auto", fontSize: "0.85rem", padding: "0.1rem 0.5rem", lineHeight: 1 }}
              onClick={() => setSelectedDate(null)}
              title="Close"
            >&times;</button>
          </div>
          <div className="dash-card-body">
            {dlLoading ? (
              <p style={{ color: "var(--text-secondary)" }}>Loading...</p>
            ) : !dlData ? (
              <p style={{ color: "var(--text-secondary)" }}>Failed to load daily log.</p>
            ) : (
              <>
                {/* Test Runs */}
                <div className="dash-card" style={{ marginBottom: "1.25rem" }}>
                  <div className="dash-card-header">Test Runs ({dlData.test_runs.length})</div>
                  <div className="dash-card-body">
                    {dlData.test_runs.length === 0 ? (
                      <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No test runs this day.</p>
                    ) : (
                      <div className="daily-log-runs">
                        {dlData.test_runs.map((r) => (
                          <div key={r.id} className="daily-log-run-card">
                            <div className="daily-log-run-header">
                              <strong>{r.test_name || `Run #${r.id}`}</strong>
                              <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                {r.test_type === "simplex" ? "Simplex" : "Triplex"}
                              </span>
                            </div>
                            <div className="daily-log-run-meta">
                              <span>Started by {r.started_by} at {dlFmtTime(r.started_at)}</span>
                              {r.completed_at ? (
                                <span className="status-badge completed" style={{ fontSize: "0.75rem" }}>Completed — {dlDuration(r.started_at, r.completed_at)}</span>
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

                {/* Field Notes */}
                <div className="dash-card" style={{ marginBottom: "1.25rem" }}>
                  <div className="dash-card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Field Notes ({dlFieldNotes.length})</span>
                    <button
                      className="btn btn-secondary"
                      style={{ width: "auto", fontSize: "0.7rem", padding: "0.15rem 0.5rem" }}
                      onClick={() => setNotesAsc((v) => !v)}
                      title={notesAsc ? "Oldest first" : "Newest first"}
                    >
                      {notesAsc ? "Oldest ↑" : "Newest ↓"}
                    </button>
                  </div>
                  <div className="dash-card-body">
                    {dlFieldNotes.length === 0 ? (
                      <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No field notes this day.</p>
                    ) : (
                      <div className="field-notes-log">
                        {[...dlFieldNotes].sort((a, b) => notesAsc
                          ? new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime()
                          : new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime()
                        ).map((n) => (
                          <div key={n.id} className="field-notes-entry">
                            <div className="field-notes-entry-header">
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <strong>{n.engineer}</strong>
                                {parseTags(n.activity_type).map((tag) => (
                                  <CategoryBadge key={tag} category={tag} />
                                ))}
                              </div>
                              <span className="field-notes-entry-time">{dlFmtTime(n.logged_at)}</span>
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
                                  className={`fn-sort-btn${parseTags(n.activity_type).includes(cat) ? " active" : ""}`}
                                  style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem" }}
                                  onClick={() => handleCategorize(n.id, cat, n.activity_type || "Unprocessed")}
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
                              <button className="btn btn-secondary fn-edit-btn" onClick={() => openEditNote(n)}>Edit</button>
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

                {/* Change Events */}
                {dlData.change_events.length > 0 && (
                  <div className="dash-card" style={{ marginBottom: "1.25rem" }}>
                    <div className="dash-card-header">Configuration Changes ({dlData.change_events.length})</div>
                    <div className="dash-card-body">
                      <div className="field-notes-log">
                        {dlData.change_events.map((ce) => (
                          <div key={ce.id} className="field-notes-entry">
                            <div className="field-notes-entry-header">
                              <strong>{ce.display_name}</strong>
                              <span className="field-notes-entry-time">{dlFmtTime(ce.effective_time)}</span>
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
              </>
            )}
          </div>
        </div>
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
                    className={`fn-category-option${parseTags(editingNote.category).includes(c) ? " active" : ""}`}
                    onClick={() => setEditingNote({ ...editingNote, category: toggleTag(editingNote.category, c) })}
                  >
                    {c}
                  </button>
                ))}
              </div>
              {parseTags(editingNote.category).includes("Action Item") && (
                <div style={{ background: "var(--surface-alt)", borderRadius: "var(--radius)", padding: "0.75rem", marginTop: "0.5rem" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Action Item Details</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <div>
                      <label className="fn-modal-label" style={{ marginBottom: "0.2rem" }}>Status</label>
                      <select value={editingNote.actionStatus} onChange={(e) => setEditingNote({ ...editingNote, actionStatus: e.target.value })}
                        style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}>
                        <option value="Not Started">Not Started</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Complete">Complete</option>
                      </select>
                    </div>
                    <div>
                      <label className="fn-modal-label" style={{ marginBottom: "0.2rem" }}>Responsible</label>
                      <select value={editingNote.actionResponsible} onChange={(e) => setEditingNote({ ...editingNote, actionResponsible: e.target.value })}
                        style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}>
                        <option value="">Select...</option>
                        {TEAM_MEMBERS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="fn-modal-label" style={{ marginBottom: "0.2rem" }}>Due Date</label>
                      <input type="date" value={editingNote.actionDueDate} onChange={(e) => setEditingNote({ ...editingNote, actionDueDate: e.target.value })}
                        style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }} />
                    </div>
                  </div>
                  <div style={{ marginTop: "0.5rem" }}>
                    <label className="fn-modal-label" style={{ marginBottom: "0.2rem" }}>Notes</label>
                    <textarea rows={2} value={editingNote.actionNotes} onChange={(e) => setEditingNote({ ...editingNote, actionNotes: e.target.value })}
                      className="field-notes-textarea" placeholder="Action item notes..." />
                  </div>
                </div>
              )}
            </div>
            <div className="fn-modal-footer">
              <button className="btn btn-primary" onClick={handleEditSave} disabled={!editingNote.text.trim()}>Save</button>
              <button className="btn btn-secondary" onClick={() => setEditingNote(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {completingAction && (
        <div className="fn-modal-overlay" onClick={() => { setCompletingAction(null); setCompleteNote(""); }}>
          <div className="fn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fn-modal-header">
              <h3>Complete Action Item</h3>
              <button className="fn-modal-close" onClick={() => { setCompletingAction(null); setCompleteNote(""); }}>&times;</button>
            </div>
            <div className="fn-modal-body">
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>{completingAction.action_text}</p>
              <label className="fn-modal-label">Note (optional)</label>
              <textarea
                rows={3}
                value={completeNote}
                onChange={(e) => setCompleteNote(e.target.value)}
                className="field-notes-textarea"
                placeholder="Add a completion note..."
              />
            </div>
            <div className="fn-modal-footer">
              <button className="btn btn-primary" onClick={handleCompleteAction} disabled={completeSaving}>
                {completeSaving ? "Saving..." : "Mark Complete"}
              </button>
              <button className="btn btn-secondary" onClick={() => { setCompletingAction(null); setCompleteNote(""); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
