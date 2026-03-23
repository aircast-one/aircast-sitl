export function Crosshair() {
  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-5">
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        className="drop-shadow-[0_0_2px_rgba(0,255,0,0.4)]"
      >
        <line x1="20" y1="0" x2="20" y2="15" stroke="#0f0" strokeWidth="1" opacity="0.6" />
        <line x1="20" y1="25" x2="20" y2="40" stroke="#0f0" strokeWidth="1" opacity="0.6" />
        <line x1="0" y1="20" x2="15" y2="20" stroke="#0f0" strokeWidth="1" opacity="0.6" />
        <line x1="25" y1="20" x2="40" y2="20" stroke="#0f0" strokeWidth="1" opacity="0.6" />
        <circle cx="20" cy="20" r="3" fill="none" stroke="#0f0" strokeWidth="1" opacity="0.4" />
      </svg>
    </div>
  );
}
