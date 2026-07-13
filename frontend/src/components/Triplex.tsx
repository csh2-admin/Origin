interface Props {
  onSelectHead: (head: number) => void;
}

function PumpHead({ num, y, onSelect }: { num: number; y: number; onSelect: () => void }) {
  return (
    <g className="pump-head" onClick={onSelect}>
      <rect className="pump-head-fill" x={150} y={y} width={500} height={120} rx={6} />
      <text x={400} y={y + 55} className="pump-head-label">
        PUMP HEAD {num}
      </text>
      <text x={400} y={y + 80} className="pump-head-hint">
        Click to view components
      </text>
    </g>
  );
}

export function Triplex({ onSelectHead }: Props) {
  const headY = [100, 250, 400];
  const headMidY = headY.map((y) => y + 60);

  return (
    <svg className="diagram-svg" viewBox="0 0 800 580" xmlns="http://www.w3.org/2000/svg">
      <text x={400} y={35} className="section-label" fontSize="14">
        TRIPLEX PUMP CONFIGURATION
      </text>

      <PumpHead num={1} y={headY[0]} onSelect={() => onSelectHead(1)} />
      <PumpHead num={2} y={headY[1]} onSelect={() => onSelectHead(2)} />
      <PumpHead num={3} y={headY[2]} onSelect={() => onSelectHead(3)} />

      {/* ---- SUCTION (right side, feeding into each head) ---- */}
      <text x={720} y={headMidY[0] - 15} className="section-label">SUCTION</text>
      {/* Vertical suction manifold */}
      <line x1={710} y1={headMidY[0]} x2={710} y2={headMidY[2]} className="flow-line" />
      {/* Branches into each head */}
      {headMidY.map((my, i) => (
        <g key={`suc-${i}`}>
          <line x1={710} y1={my} x2={650} y2={my} className="flow-line" />
          <polygon points={`658,${my - 6} 658,${my + 6} 650,${my}`} className="flow-arrow" />
        </g>
      ))}

      {/* ---- DISCHARGE (left side, exiting each head, merging up and out top-right) ---- */}
      {/* Branches out of each head */}
      {headMidY.map((my, i) => (
        <g key={`dis-${i}`}>
          <line x1={150} y1={my} x2={90} y2={my} className="flow-line" />
          <polygon points={`98,${my - 6} 98,${my + 6} 90,${my}`} className="flow-arrow" />
        </g>
      ))}
      {/* Vertical discharge manifold */}
      <line x1={90} y1={headMidY[0]} x2={90} y2={headMidY[2]} className="flow-line" />
      {/* Up and out */}
      <line x1={90} y1={headMidY[0]} x2={90} y2={55} className="flow-line" />
      <polygon points="84,63 96,63 90,55" className="flow-arrow" />
      <text x={90} y={45} className="section-label">DISCHARGE</text>
    </svg>
  );
}
