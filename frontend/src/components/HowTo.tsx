interface Props {
  onNavigate: (page: string) => void;
}

const SECTIONS = [
  {
    page: "asset-model",
    title: "Asset Model",
    description:
      "View and manage the current configuration of the triplex pump system. The main view shows all three pump heads, the motor, and crank drive. Click on a pump head to drill into its individual components (piston, seals, valves, etc.).",
    bullets: [
      "Click any component to view its current part number, revision, serial, and installation history",
      "Use the side panel to swap parts — record what was removed and what was installed",
      "Upload photos (before/after/inspection) to any component",
      "Use the time-travel control in the header to view the system configuration at any past date",
      "Cycle counts and runtime hours are calculated automatically from motor speed data",
    ],
  },
  {
    page: "assembly",
    title: "Assembly Instructions",
    description:
      "Editable step-by-step instructions for three assembly phases: Seal Installation, Pump Assembly, and Pump Installation. Each phase has its own instruction table and assembly tracking.",
    bullets: [
      "engineer1 has full edit access — add, edit, delete, and reorder steps",
      "Each step can include: action description, part numbers/tags, required tools, and torque specs",
      "Mark torque as N/A for steps that don't require it",
      "Click 'Start Assembly' and select a pump head (1, 2, or 3) to begin a tracked assembly run",
      "The assembly wizard lets you check off each step with an automatic timestamp and enter actual torque values",
      "View past assembly runs in the History panel to review who did what and when",
    ],
  },
  {
    page: "startup",
    title: "Startup Procedure",
    description:
      "Pre-seeded checklist of startup steps that must be completed before each test. Covers safety checks, PPE, power-on sequences, and system verification.",
    bullets: [
      "Steps are editable by engineer1 — add, remove, or reorder as procedures evolve",
      "Click 'Start Procedure' and select a pump head to begin a tracked startup run",
      "Check off each step as you go — timestamps are recorded automatically",
      "Completed runs are saved with who started and who completed the procedure",
    ],
  },
  {
    page: "shutdown",
    title: "Shut-Down Procedure",
    description:
      "Checklist for safely shutting down the test system. Covers data integrity, system purge, power-off sequences, and securing the site.",
    bullets: [
      "Same functionality as Startup Procedure — editable steps with tracked runs",
      "Ensure all shutdown steps are completed and documented after every test",
    ],
  },
  {
    page: "run-test",
    title: "Run Test",
    description:
      "Guided wizard for executing a full test run. Choose simplex (1 head) or triplex (all 3 heads), then step through assembly verification, startup, test, and shutdown phases.",
    bullets: [
      "Step 1 — Assembly: verifies all positions in the asset model have parts installed",
      "Step 2 — Startup: checklist of pre-test items (power, coolant, leaks, data logging)",
      "Step 3 — Test: run the test and log observations via Weebo",
      "Step 4 — Shutdown: checklist of post-test items (depressurize, power off, secure)",
      "Notes can be added at any step — they auto-save as you type",
    ],
  },
  {
    page: "weebo",
    title: "Weebo",
    description:
      "The engineering memo and knowledge system. Record observations, track action items, and query your data using natural language.",
    bullets: [
      "Records — browse, filter, edit, and delete engineering memos",
      "New Entry — record a voice memo, transcribe it with Whisper AI, then use Claude to auto-extract structured fields (activity type, severity, action items, etc.)",
      "Actions — track action items parsed from memos. Filter by engineer, status, or keyword. Inline editing with status grouping (In Progress / Not Started / Complete)",
      "Ask Weebo — type a question in plain English and get answers from your database. Weebo generates SQL, runs it, and summarizes the results. You can inspect the SQL and raw data for any response",
    ],
  },
];

export function HowToPage({ onNavigate }: Props) {
  return (
    <div className="howto-page">
      <div className="howto-header">
        <h2>How To Use Origin</h2>
        <p>This guide covers each section of the application. Click any title to navigate directly to that page.</p>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.page} className="howto-section">
          <h3>
            <button className="howto-link" onClick={() => onNavigate(section.page)}>
              {section.title} &rarr;
            </button>
          </h3>
          <p>{section.description}</p>
          <ul>
            {section.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
