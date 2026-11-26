const W = 160;
const H = 40;

/** Tiny line chart of how much of the building was standing over time (0 to 1). */
export function StandingSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const step = W / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(H - Math.min(1, Math.max(0, v)) * H).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      data-testid="standing-sparkline"
      role="img"
      aria-label="How much of your building was standing over time"
      viewBox={`-2 -2 ${W + 4} ${H + 4}`}
      width={W}
      height={H}
      className="overflow-visible compact:hidden"
    >
      <line x1="0" y1="0" x2={W} y2="0" className="stroke-sky-200" strokeDasharray="4 3" />
      <polyline
        points={points}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-emerald-500"
      />
    </svg>
  );
}
