import type { PositionState } from "../types";

type UsageMap = Record<string, { est_cycles: number; runtime_hours: number }>;

interface Props {
  onSelectHead: (head: number) => void;
  state: PositionState[];
  selected: string | null;
  onSelect: (position: string) => void;
  usage: UsageMap;
}

function partLabel(s: PositionState | undefined): string {
  if (!s || !s.part_number) return "—";
  let lbl = s.part_number;
  if (s.part_revision) lbl += ` Rev ${s.part_revision}`;
  return lbl;
}

function cycleLabel(usage: UsageMap, id: string): string {
  const u = usage[id];
  if (!u || !u.est_cycles) return "";
  const cycles = u.est_cycles;
  if (cycles >= 1_000_000) return `${(cycles / 1_000_000).toFixed(1)}M cycles`;
  if (cycles >= 1_000) return `${(cycles / 1_000).toFixed(1)}K cycles`;
  return `${Math.round(cycles)} cycles`;
}

function PumpHead({ num, y, onSelect }: { num: number; y: number; onSelect: () => void }) {
  return (
    <g className="pump-head" onClick={onSelect}>
      <rect className="pump-head-fill" x={250} y={y} width={500} height={120} rx={6} />
      <text x={500} y={y + 55} className="pump-head-label">
        PUMP HEAD {num}
      </text>
      <text x={500} y={y + 80} className="pump-head-hint">
        Click to view components
      </text>
    </g>
  );
}

export function Triplex({ onSelectHead, state, selected, onSelect, usage }: Props) {
  const headY = [150, 300, 450];
  const headMidY = headY.map((y) => y + 60);
  const dischX = 583;

  const motorPos = state.find((s) => s.position === "motor");
  const crankPos = state.find((s) => s.position === "crank_drive");
  const motorCl = cycleLabel(usage, "motor");
  const crankCl = cycleLabel(usage, "crank_drive");

  const crankTop = headY[0];
  const crankBottom = headY[2] + 120;
  const crankMidY = crankTop + (crankBottom - crankTop) / 2;

  return (
    <svg className="diagram-svg" viewBox="0 0 900 630" xmlns="http://www.w3.org/2000/svg">
      <text x={450} y={35} className="section-label" fontSize="14">
        TRIPLEX PUMP CONFIGURATION
      </text>

      {/* Discharge line rendered first so it's behind pump heads */}
      <line x1={dischX} y1={headY[2] + 120} x2={dischX} y2={55} className="flow-line" />
      <polygon points={`${dischX - 6},63 ${dischX + 6},63 ${dischX},55`} className="flow-arrow" />
      <text x={dischX + 45} y={60} className="section-label" textAnchor="start">DISCHARGE</text>

      {/* ---- Motor (above pump heads, left side) ---- */}
      <g
        className={`component${selected === "motor" ? " selected" : ""}`}
        onClick={(e) => { e.stopPropagation(); onSelect("motor"); }}
      >
        <rect className="comp-fill" x={30} y={50} rx={4} width={140} height={80} />
        <text x={100} y={82} className="comp-label">MOTOR</text>
        <text x={100} y={100} className="comp-part-label">
          {partLabel(motorPos)}
        </text>
        {motorCl && (
          <text x={100} y={120} className="comp-cycle-label">{motorCl}</text>
        )}
      </g>

      {/* Motor to crank drive connection line */}
      <line x1={100} y1={130} x2={100} y2={crankTop} className="flow-line" />

      {/* ---- Crank Drive (spans full height of pump heads) ---- */}
      <g
        className={`component${selected === "crank_drive" ? " selected" : ""}`}
        onClick={(e) => { e.stopPropagation(); onSelect("crank_drive"); }}
      >
        <rect className="comp-fill" x={30} y={crankTop} rx={4} width={140} height={crankBottom - crankTop} />
        <text x={100} y={crankMidY - 10} className="comp-label">CRANK</text>
        <text x={100} y={crankMidY + 9} className="comp-label">DRIVE</text>
        <text x={100} y={crankMidY + 32} className="comp-part-label">
          {partLabel(crankPos)}
        </text>
        {crankCl && (
          <text x={100} y={crankMidY + 50} className="comp-cycle-label">{crankCl}</text>
        )}
      </g>

      {/* Crank drive to each pump head connection lines (no arrows) */}
      {headMidY.map((my, i) => (
        <line key={`drive-${i}`} x1={170} y1={my} x2={250} y2={my} className="flow-line" />
      ))}

      <PumpHead num={1} y={headY[0]} onSelect={() => onSelectHead(1)} />
      <PumpHead num={2} y={headY[1]} onSelect={() => onSelectHead(2)} />
      <PumpHead num={3} y={headY[2]} onSelect={() => onSelectHead(3)} />

      {/* ---- SUCTION (right side, feeding into each head) ---- */}
      <text x={820} y={headMidY[0] - 15} className="section-label">SUCTION</text>
      <line x1={810} y1={headMidY[0]} x2={810} y2={headMidY[2]} className="flow-line" />
      {headMidY.map((my, i) => (
        <g key={`suc-${i}`}>
          <line x1={810} y1={my} x2={750} y2={my} className="flow-line" />
          <polygon points={`758,${my - 6} 758,${my + 6} 750,${my}`} className="flow-arrow" />
        </g>
      ))}
    </svg>
  );
}
