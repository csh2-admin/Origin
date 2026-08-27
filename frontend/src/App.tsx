import { useCallback, useEffect, useRef, useState } from "react";
import { getMe, getState, logout, postChange, getUnreadNotifications, markNotificationsRead, getFeedback } from "./api/client";
import type { Reply } from "./api/client";
import { Assembly, ProcedurePage } from "./components/Assembly";
import { Dashboard } from "./components/Dashboard";
import { DevTodo } from "./components/DevTodo";
import { Diagram } from "./components/Diagram";
import { FeedbackModal } from "./components/FeedbackModal";
import { HowToPage } from "./components/HowTo";
import { Login } from "./components/Login";
import { PartDetail } from "./components/PartDetail";
import { RunTest } from "./components/RunTest";
import { TestHistory } from "./components/TestHistory";
import { SystemDiagnostics } from "./components/SystemDiagnostics";
import { Triplex } from "./components/Triplex";
import { WeeboActions } from "./components/WeeboActions";
import { WeeboAsk } from "./components/WeeboAsk";
import { WeeboNewEntry } from "./components/WeeboNewEntry";
import { WeeboRecords } from "./components/WeeboRecords";
import { VoiceNote } from "./components/VoiceNote";
import { DailyLog } from "./components/DailyLog";
import { WeekLookAhead } from "./components/WeekLookAhead";
import type { PositionState } from "./types";

type Page = "dashboard" | "how-to" | "asset-model" | "assembly" | "startup" | "shutdown" | "weebo" | "run-test" | "test-history" | "daily-log" | "week-ahead" | "diagnostics" | "voice-note" | "dev-todo";

interface NavItem {
  id: Page;
  label: string;
  devOnly?: boolean;
  children?: { id: Page; label: string }[];
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "asset-model", label: "Asset Model" },
  { id: "run-test", label: "Run Test" },
  { id: "test-history", label: "Test History" },
  { id: "daily-log", label: "Daily Log" },
  { id: "week-ahead", label: "Week Look Ahead" },
  { id: "diagnostics", label: "System Diagnostics" },
  { id: "voice-note", label: "Field Notes" },
  { id: "weebo", label: "Weebo (BETA)" },
  {
    id: "assembly", label: "Documentation",
    children: [
      { id: "assembly", label: "Assembly Instructions" },
      { id: "startup", label: "Startup Procedure" },
      { id: "shutdown", label: "Shut-Down Procedure" },
      { id: "how-to", label: "How To Use" },
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
  const isTablet = typeof window !== "undefined" && window.innerWidth <= 1024;
  const [navOpen, setNavOpen] = useState(!isTablet);
  const [state, setState] = useState<PositionState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewAt, setViewAt] = useState("");
  const [activeHead, setActiveHead] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [weeboTab, setWeeboTab] = useState<"records" | "new" | "actions" | "ask">("records");
  const [fieldNotesTab, setFieldNotesTab] = useState<"notes" | "actions" | "log-feed">("notes");
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadReplies, setUnreadReplies] = useState<Reply[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const [todoCount, setTodoCount] = useState(0);

  const isTimeTraveling = viewAt !== "";

  function navigateTo(p: Page) {
    setPage(p);
    if (p !== "voice-note") setFieldNotesTab("notes");
    if (window.innerWidth <= 1024) setNavOpen(false);
  }

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

  useEffect(() => {
    if (user) {
      loadState();
    }
  }, [user, loadState]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    async function poll() {
      try {
        const data = await getUnreadNotifications(user!);
        if (active) { setUnreadCount(data.count); setUnreadReplies(data.replies); }
      } catch { /* ignore */ }
      try {
        const items = await getFeedback();
        if (active) setTodoCount(items.length);
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 30000);
    return () => { active = false; clearInterval(id); };
  }, [user]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifs(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function handleOpenNotifs() {
    setShowNotifs(!showNotifs);
    if (!showNotifs && unreadCount > 0) {
      await markNotificationsRead(user!);
      setUnreadCount(0);
    }
  }

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
  }

  function handleRefresh() {
    loadState();
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
          <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)", marginLeft: "0.4rem", alignSelf: "flex-end", marginBottom: "0.35rem" }}>v0.2</span>
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
          <div className="notif-wrapper" ref={notifRef}>
            <button className="notif-bell" onClick={handleOpenNotifs} title="Notifications">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            {showNotifs && (
              <div className="notif-dropdown">
                <div className="notif-dropdown-header">Notifications</div>
                {unreadReplies.length === 0 ? (
                  <p className="notif-empty">No new replies.</p>
                ) : (
                  <div className="notif-list">
                    {unreadReplies.map((r) => (
                      <div key={r.id} className="notif-item" onClick={() => { setShowNotifs(false); setPage("voice-note"); }}>
                        <div className="notif-item-header">
                          <strong>{r.author}</strong>
                          <span className="notif-item-time">{new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <p className="notif-item-text">{r.reply_text}</p>
                        {r.note_preview && <p className="notif-item-preview">on: {r.note_preview}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
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
                    onClick={() => navigateTo(child.id)}
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            ) : (
              <button
                key={item.id}
                className={`sidebar-item${page === item.id ? " active" : ""}`}
                onClick={() => navigateTo(item.id)}
              >
                {item.label}
                {item.id === "dev-todo" && todoCount > 0 && (
                  <span className="sidebar-badge">{todoCount}</span>
                )}
              </button>
            )
          )}
        </nav>
        <div className="page-content">
          {page === "dashboard" ? (
            <Dashboard onNavigate={(p) => {
              if (p === "weebo:actions") { setPage("voice-note"); setFieldNotesTab("actions"); }
              else setPage(p as Page);
            }} />
          ) : page === "how-to" ? (
            <HowToPage onNavigate={(p) => setPage(p as Page)} />
          ) : page === "asset-model" ? (
            <div className="main-layout">
              <div className={`diagram-pane${activeHead === null ? " triplex-view" : ""}`}>
                {activeHead === null ? (
                  <Triplex
                    onSelectHead={setActiveHead}
                    state={state}
                    selected={selected}
                    onSelect={setSelected}
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
          ) : page === "test-history" ? (
            <TestHistory />
          ) : page === "daily-log" ? (
            <DailyLog engineer={user} />
          ) : page === "week-ahead" ? (
            <WeekLookAhead />
          ) : page === "assembly" ? (
            <Assembly user={user!} />
          ) : page === "startup" ? (
            <ProcedurePage user={user!} subPage="startup_procedure" label="Startup Procedure" />
          ) : page === "shutdown" ? (
            <ProcedurePage user={user!} subPage="shutdown_procedure" label="Shut-Down Procedure" />
          ) : page === "diagnostics" ? (
            <SystemDiagnostics />
          ) : page === "voice-note" ? (
            <VoiceNote key={fieldNotesTab} engineer={user!} initialTab={fieldNotesTab} />
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
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} currentPage={page} />}
    </>
  );
}
