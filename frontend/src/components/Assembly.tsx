import { useCallback, useEffect, useState } from "react";
import {
  addInstruction,
  completeAssemblyRun,
  deleteAssemblyRun,
  deleteInstruction,
  getAssemblyRun,
  getAssemblyRuns,
  getInstructions,
  reorderInstructions,
  startAssemblyRun,
  updateAssemblyStep,
  updateInstruction,
} from "../api/client";
import type { AssemblyInstruction, AssemblyRun, AssemblyStepLog } from "../types";

const ASSEMBLY_TABS = [
  { id: "seal_installation", label: "Seal Installation" },
  { id: "pump_assembly", label: "Pump Assembly" },
  { id: "pump_installation", label: "Pump Installation" },
] as const;

interface Props {
  user: string;
}

export function Assembly({ user }: Props) {
  const [subPage, setSubPage] = useState(ASSEMBLY_TABS[0].id as string);

  return (
    <div className="assembly-page">
      <div className="weebo-tabs">
        {ASSEMBLY_TABS.map((sp) => (
          <button
            key={sp.id}
            className={`weebo-tab${subPage === sp.id ? " active" : ""}`}
            onClick={() => setSubPage(sp.id)}
          >
            {sp.label}
          </button>
        ))}
      </div>
      <AssemblySubPage key={subPage} subPage={subPage} user={user} />
    </div>
  );
}

export function ProcedurePage({ user, subPage, label }: { user: string; subPage: string; label: string }) {
  return (
    <div className="assembly-page">
      <AssemblySubPage key={subPage} subPage={subPage} user={user} labelOverride={label} simplified />
    </div>
  );
}

function AssemblySubPage({ subPage, user, labelOverride, simplified }: { subPage: string; user: string; labelOverride?: string; simplified?: boolean }) {
  const [instructions, setInstructions] = useState<AssemblyInstruction[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRow, setEditRow] = useState({ action: "", pns_tags: "", tools: "", torque_spec: "" });
  const [addingRow, setAddingRow] = useState(false);
  const [newRow, setNewRow] = useState({ action: "", pns_tags: "", tools: "", torque_spec: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeRun, setActiveRun] = useState<AssemblyRun | null>(null);
  const [wizardHead, setWizardHead] = useState<number | null>(null);
  const [runs, setRuns] = useState<AssemblyRun[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const ADMIN_USERS = ["engineer1", "edwardyoun", "anthonyku", "jimmyli"];
  const canEdit = ADMIN_USERS.includes(user);
  const pageLabel = labelOverride ?? ASSEMBLY_TABS.find((sp) => sp.id === subPage)?.label ?? subPage;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getInstructions(subPage);
      setInstructions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load instructions");
    }
    setLoading(false);
  }, [subPage]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!newRow.action.trim()) return;
    setSaving(true);
    setError("");
    try {
      await addInstruction(subPage, newRow);
      setNewRow({ action: "", pns_tags: "", tools: "", torque_spec: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add step");
    }
    setSaving(false);
  }

  async function handleUpdate() {
    if (editingId == null) return;
    setSaving(true);
    setError("");
    try {
      await updateInstruction(subPage, editingId, editRow);
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update step");
    }
    setSaving(false);
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this instruction step?")) return;
    try {
      await deleteInstruction(subPage, id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete step");
    }
  }

  async function handleMove(idx: number, direction: "up" | "down") {
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= instructions.length) return;
    const newOrder = instructions.map((i) => i.id);
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    try {
      await reorderInstructions(subPage, newOrder);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reorder");
    }
  }

  function startEdit(instr: AssemblyInstruction) {
    setEditingId(instr.id);
    setEditRow({
      action: instr.action,
      pns_tags: instr.pns_tags,
      tools: instr.tools,
      torque_spec: instr.torque_spec,
    });
  }

  async function handleStartAssembly(head: number) {
    if (instructions.length === 0) {
      alert("No instructions defined. Add steps before starting an assembly.");
      return;
    }
    setSaving(true);
    try {
      const run = await startAssemblyRun(subPage, head);
      setActiveRun(run);
      setWizardHead(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start");
    }
    setSaving(false);
  }

  async function loadRun(runId: number) {
    try {
      const run = await getAssemblyRun(runId);
      setActiveRun(run);
    } catch { /* ignore */ }
  }

  async function handleLoadHistory() {
    try {
      const data = await getAssemblyRuns(subPage);
      setRuns(data);
      setShowHistory(true);
    } catch { /* ignore */ }
  }

  if (activeRun) {
    return (
      <AssemblyWizard
        run={activeRun}
        instructions={instructions}
        pageLabel={pageLabel}
        simplified={simplified}
        onRefresh={() => loadRun(activeRun.id)}
        onClose={() => setActiveRun(null)}
      />
    );
  }

  if (wizardHead !== null) {
    return (
      <div className="asm-start-panel">
        <h3>Start {pageLabel}{!simplified && wizardHead ? ` — Pump Head ${wizardHead}` : ""}</h3>
        <p>This will create a new {simplified ? "procedure log" : `assembly run for Pump Head ${wizardHead}`} with {instructions.length} steps.</p>
        <div className="asm-start-actions">
          <button className="btn btn-primary" style={{ width: "auto" }} onClick={() => handleStartAssembly(wizardHead)} disabled={saving}>
            {saving ? "Starting..." : "Confirm & Start"}
          </button>
          <button className="btn btn-secondary" style={{ width: "auto" }} onClick={() => setWizardHead(null)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="asm-sub-page">
      <div className="asm-header">
        <h2>{pageLabel}</h2>
        <div className="asm-header-actions">
          <button className="btn btn-secondary" style={{ width: "auto" }} onClick={handleLoadHistory}>History</button>
          {simplified ? (
            <button className="btn btn-primary" style={{ width: "auto" }} onClick={() => setWizardHead(0)}>Start Procedure</button>
          ) : (
            <div className="asm-start-dropdown">
              <button className="btn btn-primary" style={{ width: "auto" }}>Start Assembly &#9662;</button>
              <div className="asm-dropdown-menu">
                {[1, 2, 3].map((h) => (
                  <button key={h} onClick={() => setWizardHead(h)}>Pump Head {h}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="asm-error">
          {error}
          <button onClick={() => setError("")}>&times;</button>
        </div>
      )}

      {showHistory && (
        <div className="asm-history">
          <div className="asm-history-header">
            <h3>{pageLabel} History</h3>
            <button className="btn btn-secondary" style={{ width: "auto", padding: "0.25rem 0.75rem", fontSize: "0.8rem" }} onClick={() => setShowHistory(false)}>Close</button>
          </div>
          {runs.length === 0 ? (
            <p style={{ color: "var(--gray-500)", padding: "0.5rem 0" }}>No assembly runs recorded yet.</p>
          ) : (
            <table className="asm-table">
              <thead>
                <tr>
                  {!simplified && <th>Head</th>}
                  <th>Started</th>
                  <th>Started By</th>
                  <th>Completed</th>
                  <th>Completed By</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    {!simplified && <td>PH {r.pump_head}</td>}
                    <td>{new Date(r.started_at).toLocaleString()}</td>
                    <td>{r.started_by}</td>
                    <td>{r.completed_at ? new Date(r.completed_at).toLocaleString() : "In Progress"}</td>
                    <td>{r.completed_by ?? "—"}</td>
                    <td>
                      <div className="asm-cell-actions">
                        <button className="btn btn-secondary" style={{ width: "auto", padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                          onClick={() => loadRun(r.id)}>View</button>
                        {!r.completed_at && (
                          <button className="asm-btn-sm del" style={{ fontSize: "0.75rem" }}
                            onClick={async () => {
                              if (!confirm("Delete this in-progress run?")) return;
                              try {
                                await deleteAssemblyRun(r.id);
                                handleLoadHistory();
                              } catch { /* ignore */ }
                            }}>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {loading ? (
        <p style={{ padding: "1rem", color: "var(--gray-500)" }}>Loading...</p>
      ) : (
        <table className="asm-table">
          <thead>
            <tr>
              <th style={{ width: "3rem" }}>Step</th>
              <th>Action</th>
              {!simplified && <th>PNs or Tags</th>}
              {!simplified && <th>Tools</th>}
              {!simplified && <th>Torque, Nm (ft-lb)</th>}
              {canEdit && <th style={{ width: "8rem" }}></th>}
            </tr>
          </thead>
          <tbody>
            {instructions.map((instr, idx) => (
              <tr key={instr.id}>
                {editingId === instr.id ? (
                  <>
                    <td>{idx + 1}</td>
                    <td><input type="text" value={editRow.action} onChange={(e) => setEditRow({ ...editRow, action: e.target.value })} /></td>
                    {!simplified && <td><input type="text" value={editRow.pns_tags} onChange={(e) => setEditRow({ ...editRow, pns_tags: e.target.value })} /></td>}
                    {!simplified && <td><input type="text" value={editRow.tools} onChange={(e) => setEditRow({ ...editRow, tools: e.target.value })} /></td>}
                    {!simplified && (
                      <td>
                        <div className="asm-torque-cell">
                          <input
                            type="text"
                            value={editRow.torque_spec}
                            onChange={(e) => setEditRow({ ...editRow, torque_spec: e.target.value })}
                            disabled={editRow.torque_spec === "N/A"}
                            placeholder="e.g. 25 (18.4)"
                          />
                          <label className="asm-na-toggle">
                            <input
                              type="checkbox"
                              checked={editRow.torque_spec === "N/A"}
                              onChange={(e) => setEditRow({ ...editRow, torque_spec: e.target.checked ? "N/A" : "" })}
                            />
                            N/A
                          </label>
                        </div>
                      </td>
                    )}
                    <td>
                      <div className="asm-cell-actions">
                        <button className="asm-btn-sm save" onClick={handleUpdate} disabled={saving}>Save</button>
                        <button className="asm-btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{idx + 1}</td>
                    <td>{instr.action}</td>
                    {!simplified && <td>{instr.pns_tags}</td>}
                    {!simplified && <td>{instr.tools}</td>}
                    {!simplified && (
                      <td className={instr.torque_spec === "N/A" || !instr.torque_spec ? "asm-na-cell" : ""}>
                        {instr.torque_spec || "N/A"}
                      </td>
                    )}
                    {canEdit && (
                      <td>
                        <div className="asm-cell-actions">
                          <button className="asm-btn-sm asm-btn-arrow" onClick={() => handleMove(idx, "up")} disabled={idx === 0} title="Move up">&uarr;</button>
                          <button className="asm-btn-sm asm-btn-arrow" onClick={() => handleMove(idx, "down")} disabled={idx === instructions.length - 1} title="Move down">&darr;</button>
                          <button className="asm-btn-sm" onClick={() => startEdit(instr)}>Edit</button>
                          <button className="asm-btn-sm del" onClick={() => handleDelete(instr.id)}>Del</button>
                        </div>
                      </td>
                    )}
                  </>
                )}
              </tr>
            ))}
            {addingRow && (
              <tr className="asm-adding-row">
                <td>{instructions.length + 1}</td>
                <td><input type="text" value={newRow.action} onChange={(e) => setNewRow({ ...newRow, action: e.target.value })} placeholder="Action description" autoFocus /></td>
                {!simplified && <td><input type="text" value={newRow.pns_tags} onChange={(e) => setNewRow({ ...newRow, pns_tags: e.target.value })} placeholder="Part numbers" /></td>}
                {!simplified && <td><input type="text" value={newRow.tools} onChange={(e) => setNewRow({ ...newRow, tools: e.target.value })} placeholder="Required tools" /></td>}
                {!simplified && (
                  <td>
                    <div className="asm-torque-cell">
                      <input
                        type="text"
                        value={newRow.torque_spec}
                        onChange={(e) => setNewRow({ ...newRow, torque_spec: e.target.value })}
                        disabled={newRow.torque_spec === "N/A"}
                        placeholder="e.g. 25 (18.4)"
                      />
                      <label className="asm-na-toggle">
                        <input
                          type="checkbox"
                          checked={newRow.torque_spec === "N/A"}
                          onChange={(e) => setNewRow({ ...newRow, torque_spec: e.target.checked ? "N/A" : "" })}
                        />
                        N/A
                      </label>
                    </div>
                  </td>
                )}
                <td>
                  <div className="asm-cell-actions">
                    <button className="asm-btn-sm save" onClick={handleAdd} disabled={saving || !newRow.action.trim()}>
                      {saving ? "..." : "Add"}
                    </button>
                    <button className="asm-btn-sm" onClick={() => { setAddingRow(false); setNewRow({ action: "", pns_tags: "", tools: "", torque_spec: "" }); }}>Done</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {canEdit && !addingRow && (
        <button className="btn btn-secondary" style={{ width: "auto", marginTop: "0.75rem" }} onClick={() => setAddingRow(true)}>
          + Add Step
        </button>
      )}
      {instructions.length === 0 && !loading && !addingRow && (
        <p style={{ padding: "1rem", color: "var(--gray-500)" }}>
          No instructions defined yet.{canEdit ? " Click '+ Add Step' to get started." : " Contact an admin to add steps."}
        </p>
      )}
    </div>
  );
}

function AssemblyWizard({
  run,
  instructions,
  pageLabel,
  simplified,
  onRefresh,
  onClose,
}: {
  run: AssemblyRun;
  instructions: AssemblyInstruction[];
  pageLabel: string;
  simplified?: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [localSteps, setLocalSteps] = useState(run.steps ?? []);
  useEffect(() => { setLocalSteps(run.steps ?? []); }, [run]);
  const steps = localSteps;
  const instrMap = new Map(instructions.map((i) => [i.id, i]));
  const [completing, setCompleting] = useState(false);
  const allChecked = steps.length > 0 && steps.every((s) => s.checked_at);
  const isCompleted = !!run.completed_at;

  function toggleStep(step: AssemblyStepLog) {
    if (isCompleted) return;
    const now = step.checked_at ? null : new Date().toISOString();
    setLocalSteps((prev) => prev.map((s) => s.id === step.id ? { ...s, checked_at: now } : s));
    updateAssemblyStep(run.id, step.id, { checked: !step.checked_at }).catch(() => onRefresh());
  }

  async function handleTorqueChange(step: AssemblyStepLog, value: string) {
    if (isCompleted) return;
    try {
      await updateAssemblyStep(run.id, step.id, { torque_actual: value });
    } catch { /* ignore */ }
  }

  async function handleComplete() {
    setCompleting(true);
    try {
      await completeAssemblyRun(run.id);
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to complete");
    }
    setCompleting(false);
  }

  return (
    <div className="asm-wizard">
      <div className="asm-wizard-header">
        <div>
          <h2>{pageLabel}{!simplified && run.pump_head ? ` — Pump Head ${run.pump_head}` : ""}</h2>
          <p className="asm-wizard-meta">
            Started by {run.started_by} at {new Date(run.started_at).toLocaleString()}
            {isCompleted && <> — Completed by {run.completed_by} at {new Date(run.completed_at!).toLocaleString()}</>}
          </p>
        </div>
        <button className="btn btn-secondary" style={{ width: "auto" }} onClick={onClose}>
          {isCompleted ? "Close" : "Exit Wizard"}
        </button>
      </div>

      <div className="asm-wizard-progress">
        <div className="asm-progress-bar">
          <div
            className="asm-progress-fill"
            style={{ width: `${steps.length ? (steps.filter((s) => s.checked_at).length / steps.length) * 100 : 0}%` }}
          />
        </div>
        <span className="asm-progress-text">
          {steps.filter((s) => s.checked_at).length} / {steps.length} steps complete
        </span>
      </div>

      <table className="asm-table asm-wizard-table">
        <thead>
          <tr>
            <th style={{ width: "2.5rem" }}></th>
            <th style={{ width: "3rem" }}>Step</th>
            <th>Action</th>
            {!simplified && <th>PNs or Tags</th>}
            {!simplified && <th>Tools</th>}
            {!simplified && <th>Torque Spec</th>}
            {!simplified && <th>Torque Actual</th>}
            <th>Completed At</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step, idx) => {
            const instr = instrMap.get(step.instruction_id);
            const hasTorque = !simplified && !!(instr?.torque_spec) && instr.torque_spec !== "N/A";
            return (
              <tr key={step.id} className={step.checked_at ? "asm-step-done" : ""}>
                <td>
                  <input
                    type="checkbox"
                    checked={!!step.checked_at}
                    onChange={() => toggleStep(step)}
                    disabled={isCompleted}
                  />
                </td>
                <td>{idx + 1}</td>
                <td>{instr?.action ?? "—"}</td>
                {!simplified && <td>{instr?.pns_tags ?? ""}</td>}
                {!simplified && <td>{instr?.tools ?? ""}</td>}
                {!simplified && <td className={!hasTorque ? "asm-na-cell" : ""}>{hasTorque ? instr?.torque_spec : "N/A"}</td>}
                {!simplified && (
                  <td>
                    {hasTorque ? (
                      <input
                        type="text"
                        className="asm-torque-input"
                        defaultValue={step.torque_actual ?? ""}
                        onBlur={(e) => handleTorqueChange(step, e.target.value)}
                        disabled={isCompleted}
                        placeholder="Enter actual"
                      />
                    ) : (
                      <span className="asm-na">N/A</span>
                    )}
                  </td>
                )}
                <td className="asm-ts-cell">
                  {step.checked_at ? new Date(step.checked_at).toLocaleTimeString() : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!isCompleted && allChecked && (
        <div className="asm-wizard-complete">
          <button className="btn btn-primary" style={{ width: "auto" }} onClick={handleComplete} disabled={completing}>
            {completing ? "Completing..." : simplified ? "Mark Procedure Complete" : "Mark Assembly Complete"}
          </button>
        </div>
      )}

      {isCompleted && (
        <div className="asm-wizard-complete done">
          {simplified ? "Procedure" : "Assembly"} completed successfully.
        </div>
      )}
    </div>
  );
}
