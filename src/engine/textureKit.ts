/**
 * Small 2D-canvas drawing helpers shared by the procedural block/scenery textures. Everything takes
 * a seeded `rnd` so textures stay deterministic; nothing here touches the DOM or the physics sim.
 */
export type Rnd = () => number;
export type Ctx = CanvasRenderingContext2D;

const TAU = Math.PI * 2;

/** Scatters `count` tiny round specks, `light` / `dark` are full rgb triples like "255,255,255". */
export function speckle(
  g: Ctx,
  rnd: Rnd,
  size: number,
  count: number,
  light: string,
  dark: string,
  maxR = 1.6,
  alpha = 0.22,
): void {
  for (let i = 0; i < count; i++) {
    const a = (0.05 + rnd() * alpha).toFixed(2);
    g.fillStyle = `rgba(${rnd() < 0.5 ? light : dark},${a})`;
    g.beginPath();
    g.arc(rnd() * size, rnd() * size, 0.4 + rnd() * maxR, 0, TAU);
    g.fill();
  }
}

/** A domed rivet / bolt head: soft drop shadow, metal body, bright glint. */
export function rivet(g: Ctx, x: number, y: number, r = 5, body = 'rgba(226,232,240,0.9)'): void {
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.arc(x + r * 0.25, y + r * 0.3, r * 1.1, 0, TAU);
  g.fill();
  g.fillStyle = body;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(15,23,42,0.45)';
  g.lineWidth = Math.max(1, r * 0.25);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, TAU);
  g.fill();
}

/** Dark groove with a light lip underneath: reads as a carved seam once bump-mapped. */
export function groove(g: Ctx, x0: number, y0: number, x1: number, y1: number, w = 3): void {
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.2)';
  g.lineWidth = Math.max(1, w * 0.4);
  g.beginPath();
  g.moveTo(x0, y0 + w * 0.7);
  g.lineTo(x1, y1 + w * 0.7);
  g.stroke();
  g.lineCap = 'butt';
}

/** Concentric growth rings, used for knots and cut logs. */
export function rings(
  g: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n: number,
  color: string,
): void {
  g.strokeStyle = color;
  g.lineWidth = 1.2;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    g.beginPath();
    g.ellipse(cx, cy, rx * k, ry * k, 0, 0, TAU);
    g.stroke();
  }
}

/** A short crack that wanders from (x, y). */
export function crack(g: Ctx, rnd: Rnd, x: number, y: number, len: number, color = 'rgba(0,0,0,0.35)'): void {
  g.strokeStyle = color;
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(x, y);
  let a = rnd() * TAU;
  for (let i = 0; i < len; i++) {
    a += (rnd() - 0.5) * 1.2;
    x += Math.cos(a) * 5;
    y += Math.sin(a) * 5;
    g.lineTo(x, y);
  }
  g.stroke();
}

/**
 * Last pass for every block face: fine grain, a soft top-left bevel highlight with a bottom-right
 * shadow, chipped paint along the edges, and a faint vignette. Keeps blocks looking like worn toys.
 */
export function finishFace(g: Ctx, rnd: Rnd, size: number, wear = 1): void {
  const S = size;
  // Fine grain.
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  // Bevel: light on the top/left lip, shade on the bottom/right lip.
  const bw = S * 0.045;
  const hi = g.createLinearGradient(0, 0, 0, bw);
  hi.addColorStop(0, 'rgba(255,255,255,0.32)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hi;
  g.fillRect(0, 0, S, bw);
  const hiL = g.createLinearGradient(0, 0, bw, 0);
  hiL.addColorStop(0, 'rgba(255,255,255,0.22)');
  hiL.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hiL;
  g.fillRect(0, 0, bw, S);
  const lo = g.createLinearGradient(0, S, 0, S - bw);
  lo.addColorStop(0, 'rgba(0,0,0,0.3)');
  lo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = lo;
  g.fillRect(0, S - bw, S, bw);
  const loR = g.createLinearGradient(S, 0, S - bw, 0);
  loR.addColorStop(0, 'rgba(0,0,0,0.24)');
  loR.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = loR;
  g.fillRect(S - bw, 0, bw, S);
  // Edge wear: pale chips where a toy block would rub.
  const chips = Math.round(26 * wear);
  for (let i = 0; i < chips; i++) {
    const edge = Math.floor(rnd() * 4);
    const t = rnd() * S;
    const d = rnd() * 5;
    const [x, y] = edge === 0 ? [t, d] : edge === 1 ? [t, S - d] : edge === 2 ? [d, t] : [S - d, t];
    g.fillStyle = `rgba(255,255,255,${(0.12 + rnd() * 0.2).toFixed(2)})`;
    g.fillRect(x, y, 2 + rnd() * 5, 1 + rnd() * 2);
  }
  // Vignette keeps the middle of a face a touch brighter than its borders.
  const v = g.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.16)');
  g.fillStyle = v;
  g.fillRect(0, 0, S, S);
}
