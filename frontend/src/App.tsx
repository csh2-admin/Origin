import { useCallback, useEffect, useState } from "react";
import { getAllUsage, getMe, getState, logout, postChange } from "./api/client";
import { Assembly, ProcedurePage } from "./components/Assembly";
import { Dashboard } from "./components/Dashboard";
import { DevTodo } from "./components/DevTodo";
import { Diagram } from "./components/Diagram";
import { FeedbackModal } from "./components/FeedbackModal";
import { HowToPage } from "./components/HowTo";
import { Login } from "./components/Login";
import { PartDetail } from "./components/PartDetail";
import { RunTest } from "./components/RunTest";
import { Triplex } from "./components/Triplex";
import { WeeboActions } from "./components/WeeboActions";
import { WeeboAsk } from "./components/WeeboAsk";
import { WeeboNewEntry } from "./components/WeeboNewEntry";
import { WeeboRecords } from "./components/WeeboRecords";
import type { PositionState } from "./types";

type Page = "dashboard" | "how-to" | "asset-model" | "assembly" | "startup" | "shutdown" | "weebo" | "run-test" | "dev-todo";

interface NavItem {
  id: Page;
  label: string;
  devOnly?: boolean;
  children?: { id: Page; label: string }[];
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "how-to", label: "How To Use" },
  { id: "asset-model", label: "Asset Model" },
  { id: "run-test", label: "Run Test" },
  { id: "weebo", label: "Weebo" },
  {
    id: "assembly", label: "Documentation",
    children: [
      { id: "assembly", label: "Assembly Instructions" },
      { id: "startup", label: "Startup Procedure" },
      { id: "shutdown", label: "Shut-Down Procedure" },
    ],
  },
  { id: "dev-todo", label: "Developer To-Do", devOnly: true },
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
  const [page, setPage] = useState<Page>("dashboard");
  const [navOpen, setNavOpen] = useState(true);
  const [state, setState] = useState<PositionState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewAt, setViewAt] = useState("");
  const [usage, setUsage] = useState<Record<string, { est_cycles: number; runtime_hours: number }>>({});
  const [activeHead, setActiveHead] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [weeboTab, setWeeboTab] = useState<"records" | "new" | "actions" | "ask">("records");

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
          <img src="/logo.png" alt="CSH2" className="header-logo" />
          <h1>ORIGIN</h1>
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
          <button className="btn-feedback" onClick={() => setShowFeedback(true)}>Feedback</button>
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
          {NAV_ITEMS.filter((item) => !item.devOnly || user === "engineer1").map((item) =>
            item.children ? (
              <div key={item.label} className="sidebar-group">
                <div className="sidebar-group-label">{item.label}</div>
                {item.children.map((child) => (
                  <button
                    key={child.id}
                    className={`sidebar-item sub${page === child.id ? " active" : ""}`}
                    onClick={() => setPage(child.id)}
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            ) : (
              <button
                key={item.id}
                className={`sidebar-item${page === item.id ? " active" : ""}`}
                onClick={() => setPage(item.id)}
              >
                {item.label}
              </button>
            )
          )}
        </nav>
        <div className="page-content">
          {page === "dashboard" ? (
            <Dashboard onNavigate={(p) => setPage(p as Page)} />
          ) : page === "how-to" ? (
            <HowToPage onNavigate={(p) => setPage(p as Page)} />
          ) : page === "asset-model" ? (
            <div className="main-layout">
              <div className="diagram-pane">
                {activeHead === null ? (
                  <Triplex
                    onSelectHead={setActiveHead}
                    state={state}
                    selected={selected}
                    onSelect={setSelected}
                    usage={usage}
                  />
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
              {selectedPosition && (
                <div className="side-panel">
                  <PartDetail
                    position={selectedPosition}
                    onRefresh={handleRefresh}
                    readOnly={isTimeTraveling}
                    user={user!}
                  />
                </div>
              )}
            </div>
          ) : page === "run-test" ? (
            <RunTest onNavigate={(p) => setPage(p as Page)} />
          ) : page === "assembly" ? (
            <Assembly user={user!} />
          ) : page === "startup" ? (
            <ProcedurePage user={user!} subPage="startup_procedure" label="Startup Procedure" />
          ) : page === "shutdown" ? (
            <ProcedurePage user={user!} subPage="shutdown_procedure" label="Shut-Down Procedure" />
          ) : page === "weebo" ? (
            <div className="weebo-page">
              <div className="weebo-tabs">
                <button className={`weebo-tab${weeboTab === "records" ? " active" : ""}`} onClick={() => setWeeboTab("records")}>Records</button>
                <button className={`weebo-tab${weeboTab === "new" ? " active" : ""}`} onClick={() => setWeeboTab("new")}>New Entry</button>
                <button className={`weebo-tab${weeboTab === "actions" ? " active" : ""}`} onClick={() => setWeeboTab("actions")}>Actions</button>
                <button className={`weebo-tab${weeboTab === "ask" ? " active" : ""}`} onClick={() => setWeeboTab("ask")}>Ask Weebo</button>
              </div>
              {weeboTab === "records" ? (
                <WeeboRecords />
              ) : weeboTab === "new" ? (
                <WeeboNewEntry engineer={user!} onSaved={() => setWeeboTab("records")} />
              ) : weeboTab === "actions" ? (
                <WeeboActions />
              ) : (
                <WeeboAsk />
              )}
            </div>
          ) : page === "dev-todo" ? (
            <DevTodo />
          ) : (
            <PlaceholderPage title={currentLabel} />
          )}
        </div>
      </div>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </>
  );
}
