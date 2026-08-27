import { useEffect, useState } from "react";
import { getActions } from "../api/client";
import type { ActionItem } from "../types";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return mon;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusColor(status: string): string {
  if (status === "Complete") return "var(--green-600)";
  if (status === "In Progress") return "var(--accent)";
  return "var(--text-secondary)";
}

export function WeekLookAhead() {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));

  useEffect(() => {
    setLoading(true);
    getActions()
      .then(setActions)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const weekDays = DAY_LABELS.map((label, i) => {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    return { label, date: fmtDate(d), dateObj: d };
  });

  const today = fmtDate(new Date());

  const openActions = actions.filter((a) => a.status !== "Complete");
  const noDueDate = openActions.filter((a) => !a.due_date);

  function prevWeek() {
    setWeekStart(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 7));
  }
  function nextWeek() {
    setWeekStart(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7));
  }
  function thisWeek() {
    setWeekStart(startOfWeek(new Date()));
  }

  const isCurrentWeek = fmtDate(weekStart) === fmtDate(startOfWeek(new Date()));

  return (
    <div className="week-look-ahead">
      <h2>One Week Look Ahead</h2>

      {/* Action Items Calendar */}
      <div className="dash-card" style={{ marginBottom: "1.25rem" }}>
        <div className="dash-card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Action Items</span>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.7rem", padding: "0.15rem 0.5rem" }} onClick={prevWeek}>&larr;</button>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", minWidth: "140px", textAlign: "center" }}>
              {fmtShort(weekDays[0].dateObj)} — {fmtShort(weekDays[6].dateObj)}
            </span>
            <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.7rem", padding: "0.15rem 0.5rem" }} onClick={nextWeek}>&rarr;</button>
            {!isCurrentWeek && (
              <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.7rem", padding: "0.15rem 0.5rem" }} onClick={thisWeek}>Today</button>
            )}
          </div>
        </div>
        <div className="dash-card-body">
          {loading ? (
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>Loading...</p>
          ) : (
            <>
              <div className="week-calendar">
                {weekDays.map((day) => {
                  const dayActions = openActions.filter((a) => a.due_date === day.date);
                  const isToday = day.date === today;
                  return (
                    <div key={day.date} className={`week-day${isToday ? " week-day-today" : ""}`}>
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
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No tests scheduled yet.</p>
        </div>
      </div>
    </div>
  );
}
