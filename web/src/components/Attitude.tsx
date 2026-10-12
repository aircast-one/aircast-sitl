const PITCH_PX_PER_DEG = 1.2;

export function Attitude({ roll, pitch, live }: { roll: number; pitch: number; live: boolean }) {
  const rollDeg = live ? (roll * 180) / Math.PI : 0;
  const pitchDeg = live ? (pitch * 180) / Math.PI : 0;
  return (
    <svg viewBox="-50 -50 100 100" className="size-28 shrink-0" role="img" aria-label={`Roll ${rollDeg.toFixed(0)}°, pitch ${pitchDeg.toFixed(0)}°`}>
      <defs>
        <clipPath id="attitude-face">
          <circle r="46" />
        </clipPath>
      </defs>
      <g clipPath="url(#attitude-face)" opacity={live ? 1 : 0.35}>
        <g transform={`rotate(${-rollDeg}) translate(0 ${pitchDeg * PITCH_PX_PER_DEG})`}>
          <rect x="-120" y="-160" width="240" height="160" className="fill-sky" />
          <rect x="-120" y="0" width="240" height="160" className="fill-ground" />
          <line x1="-120" x2="120" y1="0" y2="0" className="stroke-foreground/70" strokeWidth="1" />
          {[-20, -10, 10, 20].map((deg) => (
            <line
              key={deg}
              x1={Math.abs(deg) === 10 ? -8 : -14}
              x2={Math.abs(deg) === 10 ? 8 : 14}
              y1={-deg * PITCH_PX_PER_DEG}
              y2={-deg * PITCH_PX_PER_DEG}
              className="stroke-foreground/50"
              strokeWidth="0.75"
            />
          ))}
        </g>
      </g>
      <circle r="46" className="fill-none stroke-border" strokeWidth="1.5" />
      <path d="M-26 0 H-9 L-5 5 M26 0 H9 L5 5" className="fill-none stroke-caution" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle r="1.6" className="fill-caution" />
    </svg>
  );
}
