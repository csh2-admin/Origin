import type { PositionState } from "../types";

interface Props {
  state: PositionState[];
  selected: string | null;
  onSelect: (position: string) => void;
  onRemoveInlineDcv: () => void;
}

function partLabel(s: PositionState | undefined): string {
  if (!s || !s.part_number) return "—";
  let lbl = s.part_number;
  if (s.part_revision) lbl += ` Rev ${s.part_revision}`;
  return lbl;
}

function getPos(state: PositionState[], pos: string) {
  return state.find((s) => s.position === pos);
}

function Comp({
  id, x, y, w, h, lines, state, selected, onSelect, disabled,
}: {
  id: string; x: number; y: number; w: number; h: number;
  lines: string[]; state: PositionState[];
  selected: string | null; onSelect: (p: string) => void;
  disabled?: boolean;
}) {
  const totalH = lines.length * 19;
  const startY = y + h / 2 - totalH / 2 + 14;

  return (
    <g
      className={`component${selected === id ? " selected" : ""}${disabled ? " disabled" : ""}`}
      onClick={(e) => { e.stopPropagation(); onSelect(id); }}
    >
      <rect className="comp-fill" x={x} y={y} width={w} height={h} rx={4} />
      {lines.map((line, i) => (
        <text key={i} x={x + w / 2} y={startY + i * 19} className="comp-label">
          {line}
        </text>
      ))}
      <text x={x + w / 2} y={y + h - 8} className="comp-part-label">
        {disabled ? "REMOVED" : partLabel(getPos(state, id))}
      </text>
    </g>
  );
}

export function Diagram({ state, selected, onSelect, onRemoveInlineDcv }: Props) {
  const dcvState = getPos(state, "inline_dcv");
  const dcvInstalled = !!(dcvState && dcvState.part_number);

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (dcvInstalled) {
      onRemoveInlineDcv();
    } else {
      onSelect("inline_dcv");
    }
  }

  return (
    <svg
      className="diagram-svg"
      viewBox="0 0 1200 750"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* ---- Flow lines ---- */}
      <line x1="515" y1="170" x2="515" y2="22" className="flow-line" />
      <polygon points="509,28 521,28 515,14" className="flow-arrow" />
      <text x="515" y="8" className="section-label">DISCHARGE</text>

      <line x1="930" y1="485" x2="1170" y2="485" className="flow-line" />
      <polygon points="938,479 938,491 926,485" className="flow-arrow" />
      <text x="1080" y="473" className="section-label">SUCTION</text>

      {/* ---- In-Line DCV (above housing, toggleable) ---- */}
      <Comp id="inline_dcv" x={455} y={50} w={120} h={80}
        lines={["IN-LINE", "DCV"]}
        state={state} selected={selected} onSelect={onSelect}
        disabled={!dcvInstalled} />

      {/* Toggle switch for In-Line DCV */}
      <g className="dcv-toggle" onClick={handleToggle}>
        <rect x={590} y={72} width={52} height={26} rx={13}
          fill={dcvInstalled ? "#1f6e7d" : "#94a3b8"} />
        <circle cx={dcvInstalled ? 629 : 603} cy={85} r={10}
          fill="#fff" />
        <text x={650} y={90} fontSize="10" fill="#64748b" fontWeight="600">
          {dcvInstalled ? "Installed" : "Removed"}
        </text>
      </g>

      {/* ---- Pump Housing (outer container, clickable) ---- */}
      <g
        className={`component${selected === "pump_housing" ? " selected" : ""}`}
        onClick={() => onSelect("pump_housing")}
      >
        <rect
          className="housing-fill"
          x={50} y={170} width={880} height={540} rx={3}
        />
        <text x={160} y={200} className="housing-label" textAnchor="start">PUMP HOUSING</text>
        <text x={490} y={698} className="comp-part-label">
          {partLabel(getPos(state, "pump_housing"))}
        </text>
      </g>

      {/* ---- Internal components ---- */}

      <Comp id="lp_seal_group" x={95} y={310} w={180} h={80}
        lines={["LP SEAL GROUP"]}
        state={state} selected={selected} onSelect={onSelect} />

      <Comp id="dcv_spring" x={380} y={215} w={170} h={80}
        lines={["DCV", "SPRING"]}
        state={state} selected={selected} onSelect={onSelect} />

      <Comp id="dcv_poppet" x={380} y={310} w={170} h={80}
        lines={["DCV", "POPPET"]}
        state={state} selected={selected} onSelect={onSelect} />

      <Comp id="piston" x={95} y={425} w={390} h={120}
        lines={["PISTON"]}
        state={state} selected={selected} onSelect={onSelect} />

      <Comp id="icv_flapper" x={500} y={425} w={120} h={55}
        lines={["ICV", "FLAPPER"]}
        state={state} selected={selected} onSelect={onSelect} />

      <Comp id="icv_spring" x={500} y={490} w={120} h={55}
        lines={["ICV", "SPRING"]}
        state={state} selected={selected} onSelect={onSelect} />

      <Comp id="head_block" x={635} y={425} w={130} h={120}
        lines={["CYLINDER", "HEAD BLOCK"]}
        state={state} selected={selected} onSelect={onSelect} />

      <Comp id="retaining_ring" x={775} y={425} w={130} h={120}
        lines={["RETAINER", "RING"]}
        state={state} selected={selected} onSelect={onSelect} />

      <Comp id="hp_seal_group" x={380} y={580} w={170} h={90}
        lines={["HP SEAL", "GROUP"]}
        state={state} selected={selected} onSelect={onSelect} />

      <text x={550} y={740} className="section-label" fontSize="9">
        Click a component to view details and log changes
      </text>
    </svg>
  );
}
