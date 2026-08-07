import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceTestRun,
  cancelTestRun,
  getActiveTestRun,
  getAssemblyRuns,
  getInstructions,
  getTestRunHistory,
  startTestRun,
  updateChecklist,
  updateNotes,
  verifyAssembly,
} from "../api/client";
import type { AssemblyInstruction, AssemblyRun, AssemblyVerification, TestRun } from "../types";

interface Props {
  onNavigate: (page: string) => void;
}

const STEPS = [
  { id: "build", label: "Build" },
  { id: "assembly", label: "Verify" },
  { id: "startup", label: "Startup" },
  { id: "test", label: "Test" },
  { id: "shutdown", label: "Shutdown" },
  { id: "complete", label: "Complete" },
];

const ASSEMBLY_PHASES = [
  { id: "seal_installation", label: "Seal Installation" },
  { id: "pump_assembly", label: "Pump Assembly" },
  { id: "pump_installation", label: "Pump Installation" },
];


function parseChecklist(run: TestRun): Record<string, string> {
  try {
    const raw = typeof run.checklist_state === "string"
      ? JSON.parse(run.checklist_state)
      : run.checklist_state;
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] = typeof v === "boolean" ? (v ? "yes" : "") : String(v ?? "");
    }
    return out;
  } catch {
    return {};
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function stepLabel(step: string): string {
  const s = STEPS.find((s) => s.id === step);
  return s ? s.label : step;
}

function duration(start: string, end: string | null): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function RunTest({ onNavigate }: Props) {
  const [run, setRun] = useState<TestRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<TestRun[]>([]);
  const [verification, setVerification] = useState<AssemblyVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, string>>({});
  const [advancing, setAdvancing] = useState(false);
  const [testType, setTestType] = useState<"simplex" | "triplex" | null>(null);
  const [notes, setNotes] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recentAssemblies, setRecentAssemblies] = useState<Record<string, AssemblyRun | null>>({});
  const [startupItems, setStartupItems] = useState<string[]>([]);
  const [shutdownItems, setShutdownItems] = useState<string[]>([]);

  const loadRun = useCallback(async () => {
    try {
      const r = await getActiveTestRun();
      setRun(r);
      if (r) {
        setChecklist(parseChecklist(r));
        setNotes(r.notes ?? "");
      }
    } catch { /* auth handled elsewhere */ }
    setLoading(false);
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const h = await getTestRunHistory();
      setHistory(h);
    } catch { /* ignore */ }
  }, []);

  const loadRecentAssemblies = useCallback(async () => {
    const results: Record<string, AssemblyRun | null> = {};
    for (const phase of ASSEMBLY_PHASES) {
      try {
        const runs = await getAssemblyRuns(phase.id);
        const latest = runs.length > 0 ? runs[0] : null;
        results[phase.id] = latest;
      } catch {
        results[phase.id] = null;
      }
    }
    setRecentAssemblies(results);
  }, []);

  useEffect(() => { loadRun(); loadHistory(); }, [loadRun, loadHistory]);

  useEffect(() => {
    getInstructions("startup_procedure").then((ins) =>
      setStartupItems(ins.map((i: AssemblyInstruction) => i.action))
    ).catch(() => {});
    getInstructions("shutdown_procedure").then((ins) =>
      setShutdownItems(ins.map((i: AssemblyInstruction) => i.action))
    ).catch(() => {});
  }, []);

  useEffect(() => {
    if (run?.current_step === "build") loadRecentAssemblies();
  }, [run?.current_step, loadRecentAssemblies]);

  async function handleStart() {
    if (!testType) return;
    setAdvancing(true);
    try {
      const r = await startTestRun(testType);
      setRun(r);
      setChecklist({});
      loadHistory();
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") throw err;
      alert(err instanceof Error ? err.message : "Failed to start");
    }
    setAdvancing(false);
  }

  async function handleCancel() {
    if (!run) return;
    if (!confirm("Cancel this test run? This cannot be undone.")) return;
    try {
      await cancelTestRun(run.id);
      setRun(null);
      setChecklist({});
      setVerification(null);
      setNotes("");
      setTestType(null);
      loadHistory();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to cancel");
    }
  }

  async function handleVerify() {
    setVerifying(true);
    try {
      const v = await verifyAssembly();
      setVerification(v);
    } catch {
      setVerification(null);
    }
    setVerifying(false);
  }

  async function handleAdvance() {
    if (!run) return;
    setAdvancing(true);
    try {
      const r = await advanceTestRun(run.id, checklist);
      setRun(r);
      setChecklist(parseChecklist(r));
      setVerification(null);
      if (r.completed_at) loadHistory();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to advance");
    }
    setAdvancing(false);
  }

  async function setItemValue(key: string, value: string) {
    if (!run) return;
    const next = { ...checklist, [key]: value };
    if (value === "yes") delete next[`${key}_notes`];
    setChecklist(next);
    try {
      await updateChecklist(run.id, next);
    } catch { /* best effort */ }
  }

  async function setItemNotes(key: string, value: string) {
    if (!run) return;
    const next = { ...checklist, [`${key}_notes`]: value };
    setChecklist(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await updateChecklist(run.id, next); } catch { /* best effort */ }
    }, 600);
  }

  function allAnswered(prefix: string, items: string[]) {
    return items.every((_, i) => {
      const v = checklist[`${prefix}_${i}`];
      if (v === "yes") return true;
      if (v === "no") return !!checklist[`${prefix}_${i}_notes`]?.trim();
      return false;
    });
  }

  function handleNotesChange(value: string) {
    setNotes(value);
    if (!run) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const runId = run.id;
    saveTimer.current = setTimeout(async () => {
      try { await updateNotes(runId, value); } catch { /* best effort */ }
    }, 800);
  }

  if (loading) return null;

  const stepIdx = run ? STEPS.findIndex((s) => s.id === run.current_step) : -1;
  const isTriplex = run?.test_type === "triplex";
  const activeInHistory = history.find((h) => !h.completed_at);

  return (
    <div className="run-test">
      {/* Stepper */}
      {run && (
        <div className="stepper">
          {STEPS.map((step, i) => (
            <div key={step.id} className={`stepper-step${i === stepIdx ? " active" : ""}${i < stepIdx ? " done" : ""}`}>
              <div className="stepper-dot">{i < stepIdx ? "✓" : i + 1}</div>
              <div className="stepper-label">{step.label}</div>
              {i < STEPS.length - 1 && <div className="stepper-line" />}
            </div>
          ))}
        </div>
      )}

      {/* Cancel button — visible on all active steps except complete */}
      {run && run.current_step !== "complete" && (
        <div style={{ textAlign: "right", maxWidth: 720, margin: "0 auto" }}>
          <button className="btn btn-danger" style={{ width: "auto", fontSize: "0.8rem" }} onClick={handleCancel}>
            Cancel Test Run
          </button>
        </div>
      )}

      {/* No active run — show start form */}
      {!run && (
        <div className="run-test-start">
          <h2>Run Test</h2>

          {activeInHistory && (
            <div className="active-run-banner">
              <div className="active-run-indicator" />
              <div>
                <strong>Test in progress</strong> — {activeInHistory.test_type === "simplex" ? "Simplex" : "Triplex"} run
                started by <strong>{activeInHistory.started_by}</strong> at {fmtTime(activeInHistory.started_at)}
                <span style={{ marginLeft: "0.5rem", opacity: 0.7 }}>
                  (Step: {stepLabel(activeInHistory.current_step)}, {duration(activeInHistory.started_at, null)} elapsed)
                </span>
              </div>
            </div>
          )}

          {!activeInHistory ? (
            <>
              <p>Select the test configuration and start a new test run.</p>
              <div className="test-type-select">
                <label className="test-type-option">
                  <input type="radio" name="testType" checked={testType === "simplex"} onChange={() => setTestType("simplex")} />
                  <div className="test-type-card">
                    <strong>Simplex</strong>
                    <span>Single pump head (Head 1 only)</span>
                  </div>
                </label>
                <label className="test-type-option">
                  <input type="radio" name="testType" checked={testType === "triplex"} onChange={() => setTestType("triplex")} />
                  <div className="test-type-card">
                    <strong>Triplex</strong>
                    <span>All 3 pump heads</span>
                  </div>
                </label>
              </div>
              {testType && (
                <button className="btn btn-primary" style={{ width: "auto", marginTop: "1rem" }} onClick={handleStart} disabled={advancing}>
                  {advancing ? "Starting..." : `Start ${testType === "simplex" ? "Simplex" : "Triplex"} Test Run`}
                </button>
              )}
            </>
          ) : (
            <p style={{ marginTop: "1rem", color: "var(--gray-500)" }}>
              A test run is currently in progress. Wait for it to complete or ask {activeInHistory.started_by} to finish it before starting a new one.
            </p>
          )}
        </div>
      )}

      {/* Step: Build */}
      {run?.current_step === "build" && (
        <div className="run-test-card">
          <h2>Step 1: Pump Assembly</h2>
          <p>
            {isTriplex
              ? "Complete the assembly procedures for all 3 pump heads, or skip if reusing the previous assembly."
              : "Complete the assembly procedures for Pump Head 1, or skip if reusing the previous assembly."}
          </p>

          <div className="build-phases">
            {ASSEMBLY_PHASES.map((phase) => {
              const recent = recentAssemblies[phase.id];
              const completed = recent?.completed_at;
              return (
                <div key={phase.id} className={`build-phase-row${completed ? " done" : ""}`}>
                  <div className="build-phase-status">
                    {completed ? "✓" : "○"}
                  </div>
                  <div className="build-phase-info">
                    <strong>{phase.label}</strong>
                    {completed ? (
                      <span className="build-phase-meta">
                        Completed by {recent.completed_by} — {fmtTime(recent.completed_at!)}
                      </span>
                    ) : recent ? (
                      <span className="build-phase-meta build-phase-pending">
                        In progress — started by {recent.started_by} at {fmtTime(recent.started_at)}
                      </span>
                    ) : (
                      <span className="build-phase-meta">Not started</span>
                    )}
                  </div>
                  <button
                    className="btn btn-secondary"
                    style={{ width: "auto", fontSize: "0.8rem" }}
                    onClick={() => onNavigate("assembly")}
                  >
                    {completed ? "View" : recent ? "Resume" : "Start"}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="build-actions">
            <button
              className="btn btn-primary"
              style={{ width: "auto" }}
              onClick={handleAdvance}
              disabled={advancing}
            >
              {advancing ? "..." : "Assembly Complete — Continue to Verification"}
            </button>
            <button
              className="btn btn-secondary"
              style={{ width: "auto" }}
              onClick={handleAdvance}
              disabled={advancing}
            >
              Skip — Reusing Previous Assembly
            </button>
          </div>
        </div>
      )}

      {/* Step: Verify (was "Assembly") */}
      {run?.current_step === "assembly" && (
        <div className="run-test-card">
          <h2>Step 2: Verify Asset Model</h2>
          <p>
            {isTriplex
              ? "Verify that all 3 pump heads have parts installed and the asset model is up to date."
              : "Verify that Pump Head 1 has parts installed and the asset model is up to date."}
          </p>

          {!verification && (
            <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleVerify} disabled={verifying}>
              {verifying ? "Checking..." : `Verify Asset Model — ${isTriplex ? "All Heads" : "Head 1"}`}
            </button>
          )}

          {verification && !verification.complete && (
            <div className="verify-result fail">
              <div className="verify-header">Asset model incomplete — {verification.installed}/{verification.total} positions configured</div>
              <div className="verify-missing">
                <strong>Missing parts:</strong>
                <ul>
                  {verification.missing.map((m) => (
                    <li key={m.name}>{m.display_name}</li>
                  ))}
                </ul>
              </div>
              <div className="verify-actions">
                <button className="btn btn-primary" style={{ width: "auto" }} onClick={() => onNavigate("asset-model")}>
                  Go to Asset Model
                </button>
                <button className="btn btn-secondary" style={{ width: "auto" }} onClick={handleVerify}>
                  Re-check
                </button>
              </div>
            </div>
          )}

          {verification?.complete && (
            <div className="verify-result pass">
              <div className="verify-header">
                All {verification.total} positions have parts installed
                {isTriplex ? " (all heads)" : " (Head 1)"}
              </div>
              <button className="btn btn-primary" style={{ width: "auto", marginTop: "1rem" }} onClick={handleAdvance} disabled={advancing}>
                {advancing ? "..." : "Continue to Startup"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step: Startup */}
      {run?.current_step === "startup" && (
        <div className="run-test-card">
          <h2>Step 3: Startup Procedure</h2>
          <p>Complete all items before proceeding to the test.</p>
          <div className="checklist-table">
            <div className="checklist-header">
              <span className="checklist-col-item">Item</span>
              <span className="checklist-col-yn">Yes</span>
              <span className="checklist-col-yn">No</span>
              <span className="checklist-col-notes">Notes</span>
            </div>
            {startupItems.map((item, i) => {
              const key = `startup_${i}`;
              const val = checklist[key] ?? "";
              return (
                <div key={key} className="checklist-row">
                  <span className="checklist-col-item">{item}</span>
                  <span className="checklist-col-yn">
                    <input type="radio" name={key} checked={val === "yes"} onChange={() => setItemValue(key, "yes")} />
                  </span>
                  <span className="checklist-col-yn">
                    <input type="radio" name={key} checked={val === "no"} onChange={() => setItemValue(key, "no")} />
                  </span>
                  <span className="checklist-col-notes">
                    {val === "no" ? (
                      <input
                        type="text"
                        className="checklist-note-input"
                        placeholder="Explain why..."
                        value={checklist[`${key}_notes`] ?? ""}
                        onChange={(e) => setItemNotes(key, e.target.value)}
                      />
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="run-test-notes">
            <label className="run-test-notes-label">Notes</label>
            <textarea
              className="run-test-notes-input"
              placeholder="Log any observations, anomalies, or setup notes here..."
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              rows={4}
            />
          </div>

          {allAnswered("startup", startupItems) && (
            <button className="btn btn-primary" style={{ width: "auto", marginTop: "1rem" }} onClick={handleAdvance} disabled={advancing}>
              {advancing ? "..." : "Startup Complete — Continue"}
            </button>
          )}
        </div>
      )}

      {/* Step: Test */}
      {run?.current_step === "test" && (
        <div className="run-test-card">
          <h2>Step 4: Run Test</h2>
          <p>Run the test and log results using the <button className="link-btn" onClick={() => onNavigate("weebo")}>Weebo</button> tab.</p>
          <div className="test-prompt">
            <p>Ready to proceed? Confirm the test is complete.</p>
            <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleAdvance} disabled={advancing}>
              {advancing ? "..." : "Test Complete — Continue to Shutdown"}
            </button>
          </div>
        </div>
      )}

      {/* Step: Shutdown */}
      {run?.current_step === "shutdown" && (
        <div className="run-test-card">
          <h2>Step 5: Shutdown Procedure</h2>
          <p>Complete all shutdown steps before finalizing.</p>
          <div className="checklist-table">
            <div className="checklist-header">
              <span className="checklist-col-item">Item</span>
              <span className="checklist-col-yn">Yes</span>
              <span className="checklist-col-yn">No</span>
              <span className="checklist-col-notes">Notes</span>
            </div>
            {shutdownItems.map((item, i) => {
              const key = `shutdown_${i}`;
              const val = checklist[key] ?? "";
              return (
                <div key={key} className="checklist-row">
                  <span className="checklist-col-item">{item}</span>
                  <span className="checklist-col-yn">
                    <input type="radio" name={key} checked={val === "yes"} onChange={() => setItemValue(key, "yes")} />
                  </span>
                  <span className="checklist-col-yn">
                    <input type="radio" name={key} checked={val === "no"} onChange={() => setItemValue(key, "no")} />
                  </span>
                  <span className="checklist-col-notes">
                    {val === "no" ? (
                      <input
                        type="text"
                        className="checklist-note-input"
                        placeholder="Explain why..."
                        value={checklist[`${key}_notes`] ?? ""}
                        onChange={(e) => setItemNotes(key, e.target.value)}
                      />
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
          {allAnswered("shutdown", shutdownItems) && (
            <button className="btn btn-primary" style={{ width: "auto", marginTop: "1rem" }} onClick={handleAdvance} disabled={advancing}>
              {advancing ? "..." : "Shutdown Complete — Finalize"}
            </button>
          )}
        </div>
      )}

      {/* Step: Complete */}
      {run?.current_step === "complete" && (
        <div className="run-test-card">
          <h2>Test Run Complete</h2>
          <p>All steps have been completed successfully.</p>
          <p style={{ fontSize: "0.85rem", color: "var(--gray-500)" }}>
            {run.test_type === "simplex" ? "Simplex" : "Triplex"} test started by {run.started_by} at {new Date(run.started_at).toLocaleString()}
            {run.completed_at && <> — Completed at {new Date(run.completed_at).toLocaleString()}</>}
          </p>
          <button className="btn btn-primary" style={{ width: "auto", marginTop: "1rem" }} onClick={() => { setRun(null); setChecklist({}); setVerification(null); setTestType(null); loadHistory(); }}>
            Start Another Test
          </button>
        </div>
      )}

      {/* Test run history — always visible at bottom */}
      {history.length > 0 && (
        <div className="test-run-history" style={{ textAlign: "left", maxWidth: 720, margin: "2rem auto 0" }}>
          <h3>Test Run History</h3>
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
                  <tr key={h.id} className={!h.completed_at ? "active-row" : ""}>
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
        </div>
      )}
    </div>
  );
}
