import { useCallback, useEffect, useState } from "react";
import { getAllUsage, getMe, getState, logout, postChange } from "./api/client";
import { Diagram } from "./components/Diagram";
import { FeedbackModal } from "./components/FeedbackModal";
import { Login } from "./components/Login";
import { PartDetail } from "./components/PartDetail";
import { RunTest } from "./components/RunTest";
import { Triplex } from "./components/Triplex";
import type { PositionState } from "./types";

type Page = "asset-model" | "assembly" | "startup" | "shutdown" | "weebo" | "run-test";

const NAV_ITEMS: { id: Page; label: string }[] = [
  { id: "asset-model", label: "Asset Model" },
  { id: "assembly", label: "Assembly Instructions" },
  { id: "startup", label: "Startup Procedure" },
  { id: "shutdown", label: "Shut-Down Procedure" },
  { id: "run-test", label: "Run Test" },
  { id: "weebo", label: "Weebo" },
];

function toLocalISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="placeholder-page">
      <h2>{title}</h2>
      <p>This section is under development.</p>
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState<Page>("asset-model");
  const [navOpen, setNavOpen] = useState(true);
  const [state, setState] = useState<PositionState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewAt, setViewAt] = useState("");
  const [usage, setUsage] = useState<Record<string, { est_cycles: number; runtime_hours: number }>>({});
  const [activeHead, setActiveHead] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  const isTimeTraveling = viewAt !== "";

  useEffect(() => {
    getMe()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const loadState = useCallback(async () => {
    try {
      const at = viewAt ? new Date(viewAt).toISOString() : undefined;
      const s = await getState(at);
      setState(s);
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") setUser(null);
    }
  }, [viewAt]);

  const loadUsage = useCallback(async () => {
    if (isTimeTraveling) {
      setUsage({});
      return;
    }
    try {
      const u = await getAllUsage();
      setUsage(u);
    } catch {
      setUsage({});
    }
  }, [isTimeTraveling]);

  useEffect(() => {
    if (user) {
      loadState();
      loadUsage();
    }
  }, [user, loadState, loadUsage]);

  async function handleLogout() {
    await logout();
    setUser(null);
    setState([]);
    setSelected(null);
    setViewAt("");
    setActiveHead(null);
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
    await loadUsage();
  }

  function handleRefresh() {
    loadState();
    loadUsage();
  }

  function handleBackToTriplex() {
    setActiveHead(null);
    setSelected(null);
  }

  const selectedPosition = state.find((s) => s.position === selected);

  const currentLabel = NAV_ITEMS.find((n) => n.id === page)?.label ?? "";

  return (
    <>
      <header className="app-header">
        <div className="header-left">
          <button className="nav-toggle" onClick={() => setNavOpen(!navOpen)} title="Toggle navigation">
            {navOpen ? "✕" : "☰"}
          </button>
          <h1>CSH2 MAINTENANCE SOFTWARE</h1>
        </div>
        {page === "asset-model" && (
          <div className="time-travel">
            <label htmlFor="view-at">View at:</label>
            <input
              id="view-at"
              type="datetime-local"
              value={viewAt}
              max={toLocalISO()}
              onChange={(e) => setViewAt(e.target.value)}
            />
            {isTimeTraveling && (
              <button className="btn-now" onClick={() => setViewAt("")}>
                Back to Now
              </button>
            )}
          </div>
        )}
        <div className="user-info">
          <span>{user}</span>
          <button className="btn-logout" onClick={handleLogout}>Sign Out</button>
        </div>
      </header>
      {isTimeTraveling && page === "asset-model" && (
        <div className="time-travel-banner">
          Viewing configuration as of {new Date(viewAt).toLocaleString()} — changes are disabled
        </div>
      )}
      <div className="app-body">
        <nav className={`sidebar${navOpen ? "" : " collapsed"}`}>
          <div className="sidebar-title">Contents</div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`sidebar-item${page === item.id ? " active" : ""}`}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="page-content">
          {page === "asset-model" ? (
            <div className="main-layout">
              <div className="diagram-pane">
                {activeHead === null ? (
                  <Triplex onSelectHead={setActiveHead} />
                ) : (
                  <>
                    <div className="diagram-nav">
                      <button className="btn-back" onClick={handleBackToTriplex}>
                        &larr; All Pump Heads
                      </button>
                      <span className="diagram-nav-title">Pump Head {activeHead}</span>
                    </div>
                    <Diagram
                      state={state}
                      selected={selected}
                      onSelect={setSelected}
                      onRemoveInlineDcv={handleRemoveInlineDcv}
                      usage={usage}
                      readOnly={isTimeTraveling}
                    />
                  </>
                )}
              </div>
              <div className="side-panel">
                {activeHead === null ? (
                  <div className="empty-state">
                    Select a pump head to view its components
                  </div>
                ) : selectedPosition ? (
                  <PartDetail
                    position={selectedPosition}
                    onRefresh={handleRefresh}
                    readOnly={isTimeTraveling}
                  />
                ) : (
                  <div className="empty-state">
                    Select a component on the diagram to view details
                  </div>
                )}
              </div>
            </div>
          ) : page === "run-test" ? (
            <RunTest onNavigate={(p) => setPage(p as Page)} />
          ) : (
            <PlaceholderPage title={currentLabel} />
          )}
        </div>
      </div>
      <button className="feedback-btn" onClick={() => setShowFeedback(true)}>Feedback</button>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </>
  );
}
