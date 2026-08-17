import { useCallback, useEffect, useRef, useState } from "react";
import { getTestReport, getTestRunHistory } from "../api/client";
import type { TestReport, TestRun } from "../types";

const PHASE_LABELS: Record<string, string> = {
  seal_installation: "Seal Installation",
  pump_assembly: "Pump Assembly",
  pump_installation: "Pump Installation",
  startup_procedure: "Startup Procedure",
  shutdown_procedure: "Shut-Down Procedure",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric",
  });
}

function duration(start: string, end: string | null): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function stepLabel(step: string): string {
  const labels: Record<string, string> = {
    build: "Build", assembly: "Verify", startup: "Startup",
    test: "Test", shutdown: "Shutdown", complete: "Complete",
  };
  return labels[step] ?? step;
}

function severityBadge(severity: string | null): string {
  if (!severity) return "";
  const colors: Record<string, string> = {
    critical: "var(--red-600)", high: "#d97706",
    medium: "var(--blue-500)", low: "var(--green-600)",
  };
  return colors[severity] ?? "var(--text-secondary)";
}

function timelineEventTime(evt: { effective_time?: string; taken_at?: string; logged_at?: string; created_at?: string }): string {
  return evt.effective_time || evt.taken_at || evt.logged_at || evt.created_at || "";
}

function TimelineIcon({ type }: { type: string }) {
  const style: React.CSSProperties = {
    width: 28, height: 28, borderRadius: "50%", display: "flex",
    alignItems: "center", justifyContent: "center", fontSize: "0.8rem",
    fontWeight: 600, flexShrink: 0,
  };
  switch (type) {
    case "photo":
      return <div style={{ ...style, background: "color-mix(in srgb, var(--green-600) 15%, transparent)", color: "var(--green-600)" }}>&#x1F4F7;</div>;
    case "memo":
      return <div style={{ ...style, background: "color-mix(in srgb, var(--blue-500) 15%, transparent)", color: "var(--blue-500)" }}>&#x1F4DD;</div>;
    case "field_note":
      return <div style={{ ...style, background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>&#x1F4CB;</div>;
    case "action":
      return <div style={{ ...style, background: "color-mix(in srgb, #d97706 15%, transparent)", color: "#d97706" }}>&#x26A0;</div>;
    default:
      return <div style={{ ...style, background: "var(--surface-alt)", color: "var(--text-secondary)" }}>&#x2022;</div>;
  }
}

function timelineDescription(evt: { event_type: string; display_name?: string; installed_part_number?: string; removed_part_number?: string; changed_by?: string; note?: string; caption?: string; photo_type?: string; uploaded_by?: string; engineer?: string; summary?: string; severity?: string; action_text?: string; responsible?: string; status?: string; activity_type?: string; raw_transcript?: string }): { title: string; detail: string } {
  switch (evt.event_type) {
    case "photo":
      return {
        title: `Photo — ${evt.display_name || "Unknown"}`,
        detail: `${evt.photo_type || "Photo"} uploaded${evt.uploaded_by ? ` by ${evt.uploaded_by}` : ""}${evt.caption ? ` — ${evt.caption}` : ""}`,
      };
    case "memo":
      return {
        title: `Memo${evt.engineer ? ` — ${evt.engineer}` : ""}`,
        detail: evt.summary || "No summary",
      };
    case "field_note":
      return {
        title: `Field Note${evt.engineer ? ` — ${evt.engineer}` : ""}${evt.activity_type && evt.activity_type !== "Unprocessed" && evt.activity_type !== "Qualitative Observation" ? ` [${evt.activity_type}]` : ""}`,
        detail: evt.raw_transcript || evt.summary || "No content",
      };
    case "action":
      return {
        title: "Action Item Created",
        detail: `${evt.action_text || ""}${evt.responsible ? ` (assigned to ${evt.responsible})` : ""}`,
      };
    default:
      return { title: "Event", detail: "" };
  }
}

export function TestHistory() {
  const [history, setHistory] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [report, setReport] = useState<TestReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const h = await getTestRunHistory();
      setHistory(h);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSelect(run: TestRun) {
    setSelectedId(run.id);
    setReportLoading(true);
    try {
      const r = await getTestReport(run.id);
      setReport(r);
    } catch {
      setReport(null);
    }
    setReportLoading(false);
  }

  function handleBack() {
    setSelectedId(null);
    setReport(null);
  }

  function handlePrint() {
    if (!printRef.current || !report) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head>
      <title>Test Report #${report.run.id}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 2rem; color: #333; }
        h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
        h2 { font-size: 1.1rem; margin-top: 1.5rem; margin-bottom: 0.5rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
        table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 1rem; }
        th, td { border: 1px solid #ddd; padding: 0.35rem 0.5rem; text-align: left; }
        th { background: #f5f5f5; }
        .meta { font-size: 0.85rem; color: #666; margin-bottom: 1rem; }
        .note-item { margin-bottom: 0.5rem; font-size: 0.85rem; }
        .severity { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.75rem; font-weight: 600; color: white; }
        .severity-critical { background: #dc2626; }
        .severity-high { background: #d97706; }
        .severity-medium { background: #3b82f6; }
        .severity-low { background: #16a34a; }
        .timeline-item { display: flex; gap: 0.75rem; margin-bottom: 0.75rem; font-size: 0.85rem; }
        .timeline-dot { width: 10px; height: 10px; border-radius: 50%; background: #666; margin-top: 0.3rem; flex-shrink: 0; }
        @media print { body { padding: 0; } }
      </style>
    </head><body>${printRef.current.innerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => { w.print(); w.close(); }, 300);
  }

  // Loading state
  if (loading) return (
    <div className="test-history">
      <h2>Test Run History</h2>
      <p style={{ color: "var(--text-secondary)" }}>Loading history...</p>
    </div>
  );

  // Report detail view (full page)
  if (selectedId && !reportLoading && report) return (
    <div className="test-history">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.8rem" }} onClick={handleBack}>
          &larr; Back to History
        </button>
        <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.8rem" }} onClick={handlePrint}>
          Download PDF
        </button>
      </div>

      <div ref={printRef}>
        <h1>Test Report — Run #{report.run.id}</h1>
        <div className="meta" style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
          <strong>{report.run.test_type === "simplex" ? "Simplex" : "Triplex"}</strong> test run
          &nbsp;| Started by {report.run.started_by} on {fmtDate(report.run.started_at)}
          {report.run.completed_at && <>&nbsp;| Completed {fmtDate(report.run.completed_at)}</>}
          &nbsp;| Duration: {duration(report.run.started_at, report.run.completed_at)}
        </div>

        {/* Asset snapshot */}
        <h2>Asset Configuration</h2>
        {report.asset_snapshot.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Position</th>
                <th>Part Number</th>
                <th>Revision</th>
                <th>Serial</th>
              </tr>
            </thead>
            <tbody>
              {report.asset_snapshot.map((a) => (
                <tr key={a.position}>
                  <td>{a.display_name}</td>
                  <td>{a.part_number || "—"}</td>
                  <td>{a.part_revision || "—"}</td>
                  <td>{a.part_serial || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            No asset snapshot recorded for this test run.
          </p>
        )}

        {/* Test notes */}
        {report.run.notes && (
          <>
            <h2>Test Notes</h2>
            <p style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>{report.run.notes}</p>
          </>
        )}

        {/* Assembly notes */}
        {report.assembly_notes.length > 0 && (
          <>
            <h2>Assembly Notes</h2>
            {report.assembly_notes.map((n, i) => (
              <div key={i} className="note-item">
                <strong>{PHASE_LABELS[n.sub_page] ?? n.sub_page}</strong> — Step {n.step_order}: {n.action}
                <div style={{ marginLeft: "1rem", color: "var(--text-secondary)", fontSize: "0.82rem" }}>{n.notes}</div>
              </div>
            ))}
          </>
        )}

        {/* Startup / Shutdown procedure steps */}
        {report.procedure_steps?.length > 0 && (() => {
          const grouped: Record<string, typeof report.procedure_steps> = {};
          for (const s of report.procedure_steps) {
            const key = s.sub_page;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(s);
          }
          return Object.entries(grouped).map(([subPage, steps]) => (
            <div key={subPage}>
              <h2>{PHASE_LABELS[subPage] ?? subPage}</h2>
              <table className="data-table" style={{ fontSize: "0.82rem" }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((s, i) => (
                    <tr key={i}>
                      <td>{s.step_order}</td>
                      <td>{s.action}</td>
                      <td style={{ color: s.checked_at ? "var(--green-600)" : "var(--text-secondary)" }}>
                        {s.checked_at ? "Done" : "—"}
                        {s.torque_actual && ` (${s.torque_actual}${s.torque_spec ? ` / ${s.torque_spec}` : ""})`}
                      </td>
                      <td style={{ color: "var(--text-secondary)" }}>{s.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ));
        })()}

        {/* Checklist state (startup/shutdown) */}
        {report.run.checklist_state && (() => {
          try {
            const state = typeof report.run.checklist_state === "string"
              ? JSON.parse(report.run.checklist_state)
              : report.run.checklist_state;
            const keys = Object.keys(state);
            if (keys.length === 0) return null;
            const itemKeys = keys.filter((k) => !k.endsWith("_notes"));
            const startupKeys = itemKeys.filter((k) => k.startsWith("startup_"));
            const shutdownKeys = itemKeys.filter((k) => k.startsWith("shutdown_"));
            const renderSection = (title: string, sKeys: string[]) => {
              if (sKeys.length === 0) return null;
              const noItems = sKeys.filter((k) => state[k] === "no");
              const yesCount = sKeys.filter((k) => state[k] === "yes").length;
              const oldBool = sKeys.filter((k) => state[k] === true).length;
              return (
                <div style={{ marginBottom: "0.75rem" }}>
                  <strong>{title}:</strong>{" "}
                  {oldBool > 0
                    ? <span>{oldBool} items checked (legacy format)</span>
                    : <span>{yesCount} Yes, {noItems.length} No out of {sKeys.length} items</span>
                  }
                  {noItems.length > 0 && (
                    <ul style={{ margin: "0.25rem 0 0 1.25rem", fontSize: "0.82rem" }}>
                      {noItems.map((k) => (
                        <li key={k}>
                          Item {parseInt(k.split("_").pop()!) + 1}: No
                          {state[`${k}_notes`] ? ` — ${state[`${k}_notes`]}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            };
            return (
              <>
                <h2>Checklist Summary</h2>
                <div style={{ fontSize: "0.85rem" }}>
                  {renderSection("Startup", startupKeys)}
                  {renderSection("Shutdown", shutdownKeys)}
                </div>
              </>
            );
          } catch { return null; }
        })()}

        {/* Open actions */}
        {report.actions?.length > 0 && (
          <>
            <h2>Open Actions</h2>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Responsible</th>
                  <th>Status</th>
                  <th>Due Date</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {report.actions.map((a) => (
                  <tr key={a.id}>
                    <td>{a.action_text}</td>
                    <td>{a.responsible || "—"}</td>
                    <td>{a.status || "open"}</td>
                    <td>{a.due_date ? fmtDate(a.due_date) : "—"}</td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{a.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Weebo memos from that day */}
        {report.memos.length > 0 && (
          <>
            <h2>Activity Log — {fmtDate(report.run.started_at)}</h2>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Engineer</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>Summary</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {report.memos.map((m) => (
                  <tr key={m.id}>
                    <td>{fmtTime(m.logged_at)}</td>
                    <td>{m.engineer}</td>
                    <td>{m.activity_type || "—"}</td>
                    <td>
                      {m.severity ? (
                        <span
                          className={`severity severity-${m.severity}`}
                          style={{ background: severityBadge(m.severity), color: "#fff", padding: "0.1rem 0.4rem", borderRadius: 3, fontSize: "0.75rem" }}
                        >
                          {m.severity}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={{ maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis" }}>{m.summary || "—"}</td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{m.issues_found || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Test Timeline */}
        {report.timeline?.length > 0 && (
          <>
            <h2>Test Timeline</h2>
            <div style={{ position: "relative", paddingLeft: "1rem" }}>
              <div style={{ position: "absolute", left: "0.85rem", top: 0, bottom: 0, width: 2, background: "var(--border)" }} />
              {report.timeline.map((evt, i) => {
                const ts = timelineEventTime(evt);
                const { title, detail } = timelineDescription(evt);
                return (
                  <div key={i} style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", position: "relative" }}>
                    <TimelineIcon type={evt.event_type} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
                        <strong style={{ fontSize: "0.85rem" }}>{title}</strong>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", flexShrink: 0 }}>{ts ? fmtTime(ts) : ""}</span>
                      </div>
                      <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: "0.15rem" }}>{detail}</div>
                      {evt.event_type === "field_note" && evt.audio_url && (
                        <img
                          src={evt.audio_url}
                          alt="Field note photo"
                          style={{ maxWidth: 200, maxHeight: 140, objectFit: "contain", borderRadius: "var(--radius)", border: "1px solid var(--border)", marginTop: "0.35rem", cursor: "pointer" }}
                          onClick={() => window.open(evt.audio_url, "_blank")}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );

  // Report loading state
  if (selectedId && reportLoading) return (
    <div className="test-history">
      <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.8rem", marginBottom: "1rem" }} onClick={handleBack}>
        &larr; Back to History
      </button>
      <p style={{ color: "var(--text-secondary)" }}>Loading report...</p>
    </div>
  );

  // Report failed to load
  if (selectedId && !reportLoading && !report) return (
    <div className="test-history">
      <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.8rem", marginBottom: "1rem" }} onClick={handleBack}>
        &larr; Back to History
      </button>
      <p style={{ color: "var(--text-secondary)" }}>Failed to load report.</p>
    </div>
  );

  // History list view
  return (
    <div className="test-history">
      <h2>Test Run History</h2>

      {history.length === 0 ? (
        <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>No test runs recorded yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Run #</th>
                <th>Type</th>
                <th>Started</th>
                <th>Started By</th>
                <th>Status</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr
                  key={h.id}
                  className={!h.completed_at ? "active-row" : ""}
                  onClick={() => handleSelect(h)}
                  style={{ cursor: "pointer" }}
                >
                  <td>{h.id}</td>
                  <td>{h.test_type === "simplex" ? "Simplex" : "Triplex"}</td>
                  <td>{fmtTime(h.started_at)}</td>
                  <td>{h.started_by}</td>
                  <td>
                    {h.completed_at ? (
                      <span className="status-badge completed">Completed</span>
                    ) : (
                      <span className="status-badge in-progress">In Progress — {stepLabel(h.current_step)}</span>
                    )}
                  </td>
                  <td>{duration(h.started_at, h.completed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
