/** Pure-CSS toy-block scene shown behind the main menu before a game starts. */
const TOWERS: ReadonlyArray<{ left: string; blocks: number; color: string }> = [
  { left: '8%', blocks: 4, color: 'bg-amber-400' },
  { left: '16%', blocks: 2, color: 'bg-rose-400' },
  { left: '74%', blocks: 3, color: 'bg-emerald-400' },
  { left: '83%', blocks: 5, color: 'bg-indigo-400' },
  { left: '91%', blocks: 2, color: 'bg-amber-400' },
];

const CLOUDS: ReadonlyArray<{ top: string; size: string; duration: string; delay: string }> = [
  { top: '10%', size: 'h-10 w-28', duration: '70s', delay: '-10s' },
  { top: '22%', size: 'h-12 w-36', duration: '95s', delay: '-55s' },
  { top: '35%', size: 'h-8 w-24', duration: '60s', delay: '-30s' },
];

export function MenuBackdrop() {
  return (
    <div
      data-testid="menu-backdrop"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden bg-gradient-to-b from-sky-400 via-sky-200 to-amber-100"
    >
      <div className="absolute right-[12%] top-[8%] size-24 rounded-full bg-amber-200 shadow-[0_0_80px_30px_rgba(253,230,138,0.8)]" />
      {CLOUDS.map((c) => (
        <div
          key={c.top}
          className={`ubs-cloud absolute rounded-full bg-white/90 ${c.size}`}
          style={{ top: c.top, animationDuration: c.duration, animationDelay: c.delay }}
        />
      ))}
      <div className="absolute -bottom-16 -left-[10%] h-64 w-[70%] rounded-[50%] bg-emerald-400" />
      <div className="absolute -bottom-20 -right-[10%] h-72 w-[75%] rounded-[50%] bg-emerald-500" />
      {TOWERS.map((t) => (
        <div key={t.left} className="absolute bottom-6 flex flex-col-reverse" style={{ left: t.left }}>
          {Array.from({ length: t.blocks }, (_, i) => (
            <div
              key={i}
              className={`ubs-block size-9 rounded-sm ring-2 ring-black/15 ${t.color}`}
              style={{ animationDelay: `${i * 0.25}s` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
