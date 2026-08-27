import { useEffect, useState, useRef } from "react";
import { getActions } from "../api/client";
import type { ActionItem } from "../types";

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

export function WeekLookAhead() {
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

  useEffect(() => {
    setLoading(true);
    getActions()
      .then(setActions)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { saveTestCards(testCards); }, [testCards]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    return { label: dayLabel(d), date: fmtDate(d), dateObj: d };
  });

  const today = fmtDate(todayDate());
  const openActions = actions.filter((a) => a.status !== "Complete");
  const noDueDate = openActions.filter((a) => !a.due_date);

  const isToday = fmtDate(startDate) === today;

  function shiftDays(n: number) {
    setStartDate(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + n));
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

  return (
    <div className="week-look-ahead">
      <h2>One Week Look Ahead</h2>

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
            {!isToday && (
              <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.7rem", padding: "0.15rem 0.5rem" }} onClick={() => setStartDate(todayDate())}>Today</button>
            )}
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
                  return (
                    <div key={day.date} className={`week-day${isTodayCol ? " week-day-today" : ""}`}>
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
                              <button className="week-test-btn" onClick={() => { setEditingCard(card); setEditTitle(card.title); }} title="Edit">✎</button>
                              <button className="week-test-btn" onClick={() => deleteTestCard(card.id)} title="Delete">✕</button>
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
    </div>
  );
}
