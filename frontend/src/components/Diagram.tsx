import type { PositionState } from "../types";

interface Props {
  state: PositionState[];
  selected: string | null;
  onSelect: (position: string) => void;
}

function partLabel(s: PositionState): string {
  if (!s.part_number) return "Empty";
  let lbl = s.part_number;
  if (s.part_revision) lbl += ` Rev ${s.part_revision}`;
  return lbl;
}

function getState(state: PositionState[], pos: string): PositionState | undefined {
  return state.find((s) => s.position === pos);
}

export function Diagram({ state, selected, onSelect }: Props) {
  const cls = (pos: string) =>
    `component${selected === pos ? " selected" : ""}`;

  const icv = getState(state, "icv_flapper");
  const dcv = getState(state, "dcv_poppet");
  const pump = getState(state, "pump_housing");
  const lpSeal = getState(state, "lp_seal_group");
  const hpSeal = getState(state, "hp_seal_position_1");

  return (
    <svg
      className="diagram-svg"
      viewBox="0 0 960 440"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Title */}
      <text x="480" y="32" className="title-label">
        CRYOGENIC PUMP TEST SYSTEM
      </text>

      {/* Flow lines */}
      <line x1="20" y1="220" x2="115" y2="220" className="flow-line" />
      <line x1="195" y1="220" x2="270" y2="220" className="flow-line" />
      <line x1="690" y1="220" x2="765" y2="220" className="flow-line" />
      <line x1="845" y1="220" x2="940" y2="220" className="flow-line" />

      {/* Flow arrows */}
      <polygon points="80,212 80,228 96,220" className="flow-arrow" />
      <polygon points="240,212 240,228 256,220" className="flow-arrow" />
      <polygon points="730,212 730,228 746,220" className="flow-arrow" />
      <polygon points="900,212 900,228 916,220" className="flow-arrow" />

      {/* Section labels */}
      <text x="50" y="260" className="section-label">Suction</text>
      <text x="910" y="260" className="section-label">Discharge</text>

      {/* ---- Pump Housing (outer) ---- */}
      <g className={cls("pump_housing")} onClick={() => onSelect("pump_housing")}>
        <rect
          className="comp-fill housing-fill"
          x="270" y="80" width="420" height="280" rx="8"
        />
        <text x="480" y="108" className="comp-label">PUMP HOUSING</text>
        <text x="480" y="348" className="comp-part-label">
          {pump ? partLabel(pump) : ""}
        </text>
      </g>

      {/* ---- LP Seal Group (inside housing, left) ---- */}
      <g className={cls("lp_seal_group")} onClick={(e) => { e.stopPropagation(); onSelect("lp_seal_group"); }}>
        <rect className="comp-fill" x="295" y="130" width="140" height="180" rx="6" />
        <text x="365" y="216" className="comp-label">LP SEAL</text>
        <text x="365" y="232" className="comp-label">GROUP</text>
        <text x="365" y="296" className="comp-part-label">
          {lpSeal ? partLabel(lpSeal) : ""}
        </text>
      </g>

      {/* ---- HP Seal Position 1 (inside housing, right) ---- */}
      <g className={cls("hp_seal_position_1")} onClick={(e) => { e.stopPropagation(); onSelect("hp_seal_position_1"); }}>
        <rect className="comp-fill" x="525" y="130" width="140" height="180" rx="6" />
        <text x="595" y="216" className="comp-label">HP SEAL</text>
        <text x="595" y="232" className="comp-label">POS 1</text>
        <text x="595" y="296" className="comp-part-label">
          {hpSeal ? partLabel(hpSeal) : ""}
        </text>
      </g>

      {/* Pump symbol (center circle) */}
      <circle cx="480" cy="220" r="28" fill="none" stroke="var(--gray-700)" strokeWidth="1.5" />
      <polygon
        points="480,196 496,230 464,230"
        fill="none"
        stroke="var(--gray-700)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* ---- ICV Flapper (inlet check valve) ---- */}
      <g className={cls("icv_flapper")} onClick={() => onSelect("icv_flapper")}>
        <rect className="comp-fill" x="115" y="180" width="80" height="80" rx="6" />
        {/* Check valve symbol */}
        <polygon
          points="135,230 155,210 155,250"
          fill="none" stroke="var(--gray-700)" strokeWidth="1.5"
        />
        <line x1="155" y1="208" x2="155" y2="252" stroke="var(--gray-700)" strokeWidth="1.5" />
        <text x="155" y="176" className="comp-label">ICV FLAPPER</text>
        <text x="155" y="275" className="comp-part-label">
          {icv ? partLabel(icv) : ""}
        </text>
      </g>

      {/* ---- DCV Poppet (discharge check valve) ---- */}
      <g className={cls("dcv_poppet")} onClick={() => onSelect("dcv_poppet")}>
        <rect className="comp-fill" x="765" y="180" width="80" height="80" rx="6" />
        {/* Check valve symbol */}
        <polygon
          points="785,230 805,210 805,250"
          fill="none" stroke="var(--gray-700)" strokeWidth="1.5"
        />
        <line x1="805" y1="208" x2="805" y2="252" stroke="var(--gray-700)" strokeWidth="1.5" />
        <text x="805" y="176" className="comp-label">DCV POPPET</text>
        <text x="805" y="275" className="comp-part-label">
          {dcv ? partLabel(dcv) : ""}
        </text>
      </g>

      {/* Internal flow lines (inside housing) */}
      <line x1="435" y1="220" x2="452" y2="220" className="flow-line" strokeDasharray="4 3" />
      <line x1="508" y1="220" x2="525" y2="220" className="flow-line" strokeDasharray="4 3" />

      {/* Border legend */}
      <rect x="20" y="380" width="920" height="1" fill="var(--gray-200)" />
      <text x="480" y="420" className="section-label" fontSize="9">
        Click a component to view details and log changes
      </text>
    </svg>
  );
}
