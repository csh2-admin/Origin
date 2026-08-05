import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceTestRun,
  getActiveTestRun,
  getTestRunHistory,
  startTestRun,
  updateChecklist,
  updateNotes,
  verifyAssembly,
} from "../api/client";
import type { AssemblyVerification, TestRun } from "../types";

interface Props {
  onNavigate: (page: string) => void;
}

const STEPS = [
  { id: "assembly", label: "Assembly" },
  { id: "startup", label: "Startup" },
  { id: "test", label: "Test" },
  { id: "shutdown", label: "Shutdown" },
  { id: "complete", label: "Complete" },
];

const STARTUP_ITEMS = [
  "Power on main system",
  "Confirm data logging is active",
  "Complete environmental safety checks",
  "Compressed air on",
  "Verify coolant levels",
  "Check for leaks at all fittings",
];

const SHUTDOWN_ITEMS = [
  "Reduce motor speed to zero",
  "Compressed air off",
  "De-pressurize system",
  "Power off main system",
  "Record final meter readings",
  "Secure test area",
];

function parseChecklist(run: TestRun): Record<string, boolean> {
  try {
    const raw = typeof run.checklist_state === "string"
      ? JSON.parse(run.checklist_state)
      : run.checklist_state;
    return raw && typeof raw === "object" ? raw : {};
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
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [advancing, setAdvancing] = useState(false);
  const [testType, setTestType] = useState<"simplex" | "triplex" | null>(null);
  const [notes, setNotes] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => { loadRun(); loadHistory(); }, [loadRun, loadHistory]);

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

  async function toggleItem(key: string, _items: string[]) {
    if (!run) return;
    const next = { ...checklist, [key]: !checklist[key] };
    setChecklist(next);
    try {
      await updateChecklist(run.id, next);
    } catch { /* best effort */ }
  }

  function allChecked(prefix: string, items: string[]) {
    return items.every((_, i) => checklist[`${prefix}_${i}`]);
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

  // Find active run from history (to show who's running it even if current user doesn't have it loaded)
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

      {/* No active run — show start form */}
      {!run && (
        <div className="run-test-start">
          <h2>Run Test</h2>

          {/* Active run banner */}
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

          {/* Start new run */}
          {!activeInHistory ? (
            <>
              <p>Select the test configuration and start a new test run.</p>
              <div className="test-type-select">
                <label className="test-type-option">
                  <input
                    type="radio"
                    name="testType"
                    checked={testType === "simplex"}
                    onChange={() => setTestType("simplex")}
                  />
                  <div className="test-type-card">
                    <strong>Simplex</strong>
                    <span>Single pump head (Head 1 only)</span>
                  </div>
                </label>
                <label className="test-type-option">
                  <input
                    type="radio"
                    name="testType"
                    checked={testType === "triplex"}
                    onChange={() => setTestType("triplex")}
                  />
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

      {/* Test run history — always visible */}
      {history.length > 0 && (
        <div className="test-run-history" style={{ textAlign: "left", maxWidth: 720, margin: "1.5rem auto 0" }}>
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

      {/* Step: Assembly */}
      {run?.current_step === "assembly" && (
        <div className="run-test-card">
          <h2>Step 1: System Assembly</h2>
          <p>
            {isTriplex
              ? "Verify that all 3 pump heads have been assembled and the asset model is up to date."
              : "Verify that Pump Head 1 has been assembled and the asset model is up to date."}
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
          <h2>Step 2: Startup Procedure</h2>
          <p>Complete all items before proceeding to the test.</p>
          <div className="checklist">
            {STARTUP_ITEMS.map((item, i) => {
              const key = `startup_${i}`;
              return (
                <label key={key} className="checklist-item">
                  <input
                    type="checkbox"
                    checked={!!checklist[key]}
                    onChange={() => toggleItem(key, STARTUP_ITEMS)}
                  />
                  <span>{item}</span>
                </label>
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

          {allChecked("startup", STARTUP_ITEMS) && (
            <button className="btn btn-primary" style={{ width: "auto", marginTop: "1rem" }} onClick={handleAdvance} disabled={advancing}>
              {advancing ? "..." : "Startup Complete — Continue"}
            </button>
          )}
        </div>
      )}

      {/* Step: Test */}
      {run?.current_step === "test" && (
        <div className="run-test-card">
          <h2>Step 3: Run Test</h2>
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
          <h2>Step 4: Shutdown Procedure</h2>
          <p>Complete all shutdown steps before finalizing.</p>
          <div className="checklist">
            {SHUTDOWN_ITEMS.map((item, i) => {
              const key = `shutdown_${i}`;
              return (
                <label key={key} className="checklist-item">
                  <input
                    type="checkbox"
                    checked={!!checklist[key]}
                    onChange={() => toggleItem(key, SHUTDOWN_ITEMS)}
                  />
                  <span>{item}</span>
                </label>
              );
            })}
          </div>
          {allChecked("shutdown", SHUTDOWN_ITEMS) && (
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
    </div>
  );
}
