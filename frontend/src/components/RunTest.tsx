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
  const [testName, setTestName] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [assemblyRuns, setAssemblyRuns] = useState<Record<string, AssemblyRun[]>>({});
  const [assemblyChoice, setAssemblyChoice] = useState<Record<string, "new" | number>>({});
  const [startupItems, setStartupItems] = useState<string[]>([]);
  const [shutdownItems, setShutdownItems] = useState<string[]>([]);

  const loadRun = useCallback(async () => {
    try {
      const r = await getActiveTestRun();
      setRun(r);
      if (r) {
        setChecklist(parseChecklist(r));
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

  const loadAssemblyRuns = useCallback(async () => {
    const results: Record<string, AssemblyRun[]> = {};
    for (const phase of ASSEMBLY_PHASES) {
      try {
        const runs = await getAssemblyRuns(phase.id);
        results[phase.id] = runs.filter((r) => r.completed_at);
      } catch {
        results[phase.id] = [];
      }
    }
    setAssemblyRuns(results);
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
    if (run?.current_step === "build") loadAssemblyRuns();
  }, [run?.current_step, loadAssemblyRuns]);

  async function handleStart() {
    if (!testType) return;
    setAdvancing(true);
    try {
      const r = await startTestRun(testType, testName.trim() || undefined);
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
      return v === "yes" || v === "no";
    });
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
                <strong>Test in progress{activeInHistory.test_name ? `: ${activeInHistory.test_name}` : ""}</strong> — {activeInHistory.test_type === "simplex" ? "Simplex" : "Triplex"} run
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
                <>
                  <div style={{ marginTop: "1rem", maxWidth: 400 }}>
                    <label htmlFor="test-name" style={{ display: "block", fontWeight: 600, marginBottom: "0.3rem" }}>Test Name</label>
                    <input
                      id="test-name"
                      type="text"
                      value={testName}
                      onChange={(e) => setTestName(e.target.value)}
                      placeholder="e.g. Endurance Run #4"
                      style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
                    />
                  </div>
                  <button className="btn btn-primary" style={{ width: "auto", marginTop: "1rem" }} onClick={handleStart} disabled={advancing}>
                    {advancing ? "Starting..." : `Start ${testType === "simplex" ? "Simplex" : "Triplex"} Test Run`}
                  </button>
                </>
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
            For each procedure, choose to start a new assembly or select a previous completed run.
          </p>

          <div className="build-phases">
            {ASSEMBLY_PHASES.map((phase) => {
              const runs = assemblyRuns[phase.id] ?? [];
              const choice = assemblyChoice[phase.id];
              return (
                <div key={phase.id} className="build-phase-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <strong style={{ marginBottom: "0.5rem" }}>{phase.label}</strong>
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    <label className="test-type-option" style={{ flex: 1 }}>
                      <input
                        type="radio"
                        name={`asm_${phase.id}`}
                        checked={choice === "new"}
                        onChange={() => {
                          setAssemblyChoice((prev) => ({ ...prev, [phase.id]: "new" }));
                          onNavigate("assembly");
                        }}
                      />
                      <div className="test-type-card">
                        <strong>Start New</strong>
                      </div>
                    </label>
                    <label className="test-type-option" style={{ flex: 1 }}>
                      <input
                        type="radio"
                        name={`asm_${phase.id}`}
                        checked={typeof choice === "number"}
                        onChange={() => {
                          if (runs.length > 0) {
                            setAssemblyChoice((prev) => ({ ...prev, [phase.id]: runs[0].id }));
                          }
                        }}
                        disabled={runs.length === 0}
                      />
                      <div className="test-type-card">
                        <strong>Use Previous</strong>
                        {runs.length === 0 && <span style={{ fontSize: "0.75rem" }}>No completed runs</span>}
                      </div>
                    </label>
                  </div>
                  {typeof choice === "number" && runs.length > 0 && (
                    <select
                      className="checklist-note-input"
                      style={{ maxWidth: 400 }}
                      value={choice}
                      onChange={(e) => setAssemblyChoice((prev) => ({ ...prev, [phase.id]: parseInt(e.target.value) }))}
                    >
                      {runs.map((r) => (
                        <option key={r.id} value={r.id}>
                          Run #{r.id} — {r.completed_by}, {fmtTime(r.completed_at!)}
                          {r.pump_head ? ` (Head ${r.pump_head})` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>

          <div className="build-actions">
            <button
              className="btn btn-primary"
              style={{ width: "auto" }}
              onClick={handleAdvance}
              disabled={advancing || ASSEMBLY_PHASES.some((p) => !assemblyChoice[p.id])}
            >
              {advancing ? "..." : "Continue to Verification"}
            </button>
          </div>
          {ASSEMBLY_PHASES.some((p) => !assemblyChoice[p.id]) && (
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.5rem" }}>
              Select an option for each procedure to continue.
            </p>
          )}
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
                    <input
                      type="text"
                      className="checklist-note-input"
                      placeholder="Add note..."
                      value={checklist[`${key}_notes`] ?? ""}
                      onChange={(e) => setItemNotes(key, e.target.value)}
                    />
                  </span>
                </div>
              );
            })}
          </div>

          <button
            className="btn btn-primary"
            style={{ width: "auto", marginTop: "1rem" }}
            onClick={handleAdvance}
            disabled={advancing || !allAnswered("startup", startupItems)}
          >
            {advancing ? "..." : "Startup Complete — Continue"}
          </button>
        </div>
      )}

      {/* Step: Test */}
      {run?.current_step === "test" && (
        <div className="run-test-card">
          <h2>Step 4: Run Test{run.test_name ? ` — ${run.test_name}` : ""}</h2>
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
                    <input
                      type="text"
                      className="checklist-note-input"
                      placeholder="Add note..."
                      value={checklist[`${key}_notes`] ?? ""}
                      onChange={(e) => setItemNotes(key, e.target.value)}
                    />
                  </span>
                </div>
              );
            })}
          </div>
          <button
            className="btn btn-primary"
            style={{ width: "auto", marginTop: "1rem" }}
            onClick={handleAdvance}
            disabled={advancing || !allAnswered("shutdown", shutdownItems)}
          >
            {advancing ? "..." : "Shutdown Complete — Finalize"}
          </button>
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
          <button className="btn btn-primary" style={{ width: "auto", marginTop: "1rem" }} onClick={() => { setRun(null); setChecklist({}); setVerification(null); setTestType(null); }}>
            Start Another Test
          </button>
        </div>
      )}

    </div>
  );
}
