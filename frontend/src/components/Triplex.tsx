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
  const dischX = 483;

  return (
    <svg className="diagram-svg" viewBox="0 0 800 580" xmlns="http://www.w3.org/2000/svg">
      <text x={400} y={35} className="section-label" fontSize="14">
        TRIPLEX PUMP CONFIGURATION
      </text>

      {/* Discharge line rendered first so it's behind pump heads */}
      <line x1={dischX} y1={headY[2] + 120} x2={dischX} y2={55} className="flow-line" />
      <polygon points={`${dischX - 6},63 ${dischX + 6},63 ${dischX},55`} className="flow-arrow" />
      <text x={dischX + 15} y={60} className="section-label" textAnchor="start">DISCHARGE</text>

      <PumpHead num={1} y={headY[0]} onSelect={() => onSelectHead(1)} />
      <PumpHead num={2} y={headY[1]} onSelect={() => onSelectHead(2)} />
      <PumpHead num={3} y={headY[2]} onSelect={() => onSelectHead(3)} />

      {/* ---- SUCTION (right side, feeding into each head) ---- */}
      <text x={720} y={headMidY[0] - 15} className="section-label">SUCTION</text>
      <line x1={710} y1={headMidY[0]} x2={710} y2={headMidY[2]} className="flow-line" />
      {headMidY.map((my, i) => (
        <g key={`suc-${i}`}>
          <line x1={710} y1={my} x2={650} y2={my} className="flow-line" />
          <polygon points={`658,${my - 6} 658,${my + 6} 650,${my}`} className="flow-arrow" />
        </g>
      ))}
    </svg>
  );
}
