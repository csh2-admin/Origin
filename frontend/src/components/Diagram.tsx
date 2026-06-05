import type { PositionState } from "../types";

interface Props {
  state: PositionState[];
  selected: string | null;
  onSelect: (position: string) => void;
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
  id, x, y, w, h, lines, state, selected, onSelect,
}: {
  id: string; x: number; y: number; w: number; h: number;
  lines: string[]; state: PositionState[];
  selected: string | null; onSelect: (p: string) => void;
}) {
  const totalH = lines.length * 19;
  const startY = y + h / 2 - totalH / 2 + 14;

  return (
    <g
      className={`component${selected === id ? " selected" : ""}`}
      onClick={(e) => { e.stopPropagation(); onSelect(id); }}
    >
      <rect className="comp-fill" x={x} y={y} width={w} height={h} rx={4} />
      {lines.map((line, i) => (
        <text key={i} x={x + w / 2} y={startY + i * 19} className="comp-label">
          {line}
        </text>
      ))}
      <text x={x + w / 2} y={y + h - 8} className="comp-part-label">
        {partLabel(getPos(state, id))}
      </text>
    </g>
  );
}

export function Diagram({ state, selected, onSelect }: Props) {
  return (
    <svg
      className="diagram-svg"
      viewBox="0 0 1100 660"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* ---- Flow lines ---- */}
      {/* Discharge — vertical pipe going up from housing top */}
      <line x1="515" y1="75" x2="515" y2="22" className="flow-line" />
      <polygon points="509,28 521,28 515,14" className="flow-arrow" />
      <text x="515" y="8" className="section-label">DISCHARGE</text>

      {/* Suction — horizontal pipe entering from right */}
      <line x1="790" y1="290" x2="1070" y2="290" className="flow-line" />
      <polygon points="798,284 798,296 786,290" className="flow-arrow" />
      <text x="970" y="278" className="section-label">SUCTION</text>

      {/* ---- Pump Housing (outer container, clickable) ---- */}
      <g
        className={`component${selected === "pump_housing" ? " selected" : ""}`}
        onClick={() => onSelect("pump_housing")}
      >
        <rect
          className="housing-fill"
          x={50} y={75} width={740} height={530} rx={3}
        />
        <text x={420} y={98} className="housing-label">PUMP HOUSING</text>
        <text x={420} y={592} className="comp-part-label">
          {partLabel(getPos(state, "pump_housing"))}
        </text>
      </g>

      {/* ---- Internal components ---- */}

      {/* LP Seal Group — left side, mid height */}
      <Comp id="lp_seal_group" x={95} y={210} w={180} h={90}
        lines={["LP SEAL GROUP"]}
        state={state} selected={selected} onSelect={onSelect} />

      {/* DCV Spring — upper center-right */}
      <Comp id="dcv_spring" x={430} y={115} w={170} h={80}
        lines={["DCV", "SPRING"]}
        state={state} selected={selected} onSelect={onSelect} />

      {/* DCV Poppet — below DCV Spring */}
      <Comp id="dcv_poppet" x={430} y={210} w={170} h={80}
        lines={["DCV", "POPPET"]}
        state={state} selected={selected} onSelect={onSelect} />

      {/* Piston — large, bottom-left spanning most of the width */}
      <Comp id="piston" x={95} y={345} w={390} h={120}
        lines={["PISTON"]}
        state={state} selected={selected} onSelect={onSelect} />

      {/* HP Seal Group — right of piston, same row */}
      <Comp id="hp_seal_group" x={500} y={345} w={155} h={120}
        lines={["HP SEAL", "GROUP"]}
        state={state} selected={selected} onSelect={onSelect} />

      {/* ICV Flapper — right side, upper */}
      <Comp id="icv_flapper" x={675} y={205} w={100} h={80}
        lines={["ICV", "FLAPPER"]}
        state={state} selected={selected} onSelect={onSelect} />

      {/* ICV Spring — right side, lower */}
      <Comp id="icv_spring" x={675} y={345} w={100} h={120}
        lines={["ICV", "SPRING"]}
        state={state} selected={selected} onSelect={onSelect} />

      {/* Retaining Ring — bottom center-left */}
      <Comp id="retaining_ring" x={430} y={490} w={155} h={90}
        lines={["RETAINING", "RING"]}
        state={state} selected={selected} onSelect={onSelect} />

      {/* Head Block — bottom center-right */}
      <Comp id="head_block" x={620} y={490} w={155} h={90}
        lines={["HEAD", "BLOCK"]}
        state={state} selected={selected} onSelect={onSelect} />

      {/* Footer */}
      <text x={550} y={645} className="section-label" fontSize="9">
        Click a component to view details and log changes
      </text>
    </svg>
  );
}
