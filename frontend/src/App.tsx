import { useCallback, useEffect, useState } from "react";
import { getMe, getState, logout, postChange } from "./api/client";
import { Diagram } from "./components/Diagram";
import { Login } from "./components/Login";
import { PartDetail } from "./components/PartDetail";
import type { PositionState } from "./types";

export function App() {
  const [user, setUser] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [state, setState] = useState<PositionState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const loadState = useCallback(async () => {
    try {
      const s = await getState();
      setState(s);
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") setUser(null);
    }
  }, []);

  useEffect(() => {
    if (user) loadState();
  }, [user, loadState]);

  async function handleLogout() {
    await logout();
    setUser(null);
    setState([]);
    setSelected(null);
  }

  if (checking) return null;
  if (!user) return <Login onLogin={(u) => setUser(u)} />;

  async function handleRemoveInlineDcv() {
    const dcv = state.find((s) => s.position === "inline_dcv");
    if (!dcv?.part_number) return;
    if (!confirm("Remove the in-line DCV from the system?")) return;
    await postChange({
      position: "inline_dcv",
      effective_time: new Date().toISOString(),
      removed_part_number: dcv.part_number,
      removed_part_revision: dcv.part_revision ?? undefined,
      removed_part_serial: dcv.part_serial ?? undefined,
      note: "In-line DCV removed from system",
    });
    await loadState();
  }

  const selectedPosition = state.find((s) => s.position === selected);

  return (
    <>
      <header className="app-header">
        <h1>ASSET MODEL TRACKER</h1>
        <div className="user-info">
          <span>{user}</span>
          <button className="btn-logout" onClick={handleLogout}>Sign Out</button>
        </div>
      </header>
      <div className="main-layout">
        <div className="diagram-pane">
          <Diagram state={state} selected={selected} onSelect={setSelected} onRemoveInlineDcv={handleRemoveInlineDcv} />
        </div>
        <div className="side-panel">
          {selectedPosition ? (
            <PartDetail position={selectedPosition} onRefresh={loadState} />
          ) : (
            <div className="empty-state">
              Select a component on the diagram to view details
            </div>
          )}
        </div>
      </div>
    </>
  );
}
