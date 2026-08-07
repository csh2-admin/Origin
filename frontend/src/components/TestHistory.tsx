import { useCallback, useEffect, useRef, useState } from "react";
import { getTestReport, getTestRunHistory } from "../api/client";
import type { TestReport, TestRun } from "../types";

const PHASE_LABELS: Record<string, string> = {
  seal_installation: "Seal Installation",
  pump_assembly: "Pump Assembly",
  pump_installation: "Pump Installation",
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
    if (selectedId === run.id) {
      setSelectedId(null);
      setReport(null);
      return;
    }
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
        @media print { body { padding: 0; } }
      </style>
    </head><body>${printRef.current.innerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => { w.print(); w.close(); }, 300);
  }

  if (loading) return null;

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
                  className={`${!h.completed_at ? "active-row" : ""}${selectedId === h.id ? " selected-row" : ""}`}
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

      {/* Report detail */}
      {selectedId && (
        <div className="test-report" style={{ marginTop: "1.5rem" }}>
          {reportLoading ? (
            <p style={{ color: "var(--text-secondary)" }}>Loading report...</p>
          ) : report ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h3>Test Report — Run #{report.run.id}</h3>
                <button className="btn btn-secondary" style={{ width: "auto", fontSize: "0.8rem" }} onClick={handlePrint}>
                  Download PDF
                </button>
              </div>

              <div ref={printRef}>
                <h1>Test Report — Run #{report.run.id}</h1>
                <div className="meta">
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

                {/* Checklist state (startup/shutdown notes) */}
                {report.run.checklist_state && (() => {
                  try {
                    const state = typeof report.run.checklist_state === "string"
                      ? JSON.parse(report.run.checklist_state)
                      : report.run.checklist_state;
                    const keys = Object.keys(state);
                    if (keys.length === 0) return null;
                    const startupDone = keys.filter((k) => k.startsWith("startup_") && state[k]).length;
                    const shutdownDone = keys.filter((k) => k.startsWith("shutdown_") && state[k]).length;
                    return (
                      <>
                        <h2>Checklist Summary</h2>
                        <p style={{ fontSize: "0.85rem" }}>
                          Startup: {startupDone} items checked | Shutdown: {shutdownDone} items checked
                        </p>
                      </>
                    );
                  } catch { return null; }
                })()}

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
              </div>
            </>
          ) : (
            <p style={{ color: "var(--text-secondary)" }}>Failed to load report.</p>
          )}
        </div>
      )}
    </div>
  );
}
