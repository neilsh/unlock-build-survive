/**
 * Per-material face painters for the toy blocks. Each draws one 256px tile with a seeded RNG, so
 * output is deterministic. `finishFace` (textureKit) adds grain, bevel and edge wear afterwards.
 */
import type { BuiltinMaterialType } from '../types/blueprint';
import { crack, groove, rings, rivet, speckle, type Ctx, type Rnd } from './textureKit';

export const TEXTURE_SIZE = 256;
const TAU = Math.PI * 2;

export type Painter = (g: Ctx, rnd: Rnd, base: string) => void;

function fill(g: Ctx, base: string): void {
  g.fillStyle = base;
  g.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
}

function corners(g: Ctx, inset: number, r: number, body?: string): void {
  const S = TEXTURE_SIZE;
  for (const [x, y] of [
    [inset, inset],
    [S - inset, inset],
    [inset, S - inset],
    [S - inset, S - inset],
  ]) {
    rivet(g, x, y, r, body);
  }
}

export const PAINTERS: Record<BuiltinMaterialType, Painter> = {
  wood(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    const planks = 4;
    const ph = S / planks;
    for (let p = 0; p < planks; p++) {
      const y = p * ph;
      // Each plank gets its own tone so the boards read as separate pieces.
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,225,170,0.12)' : 'rgba(70,35,10,0.12)';
      g.fillRect(0, y, S, ph);
      for (let i = 0; i < 14; i++) {
        const y0 = y + 4 + rnd() * (ph - 8);
        const amp = 1 + rnd() * 3;
        const freq = 0.008 + rnd() * 0.02;
        g.strokeStyle = rnd() < 0.55 ? 'rgba(70,35,12,0.22)' : 'rgba(255,235,190,0.16)';
        g.lineWidth = 0.8 + rnd() * 1.4;
        g.beginPath();
        for (let x = 0; x <= S; x += 6) {
          const yy = y0 + Math.sin(x * freq + i * 1.7 + p) * amp;
          if (x === 0) g.moveTo(x, yy);
          else g.lineTo(x, yy);
        }
        g.stroke();
      }
      if (rnd() < 0.7) {
        const kx = 30 + rnd() * (S - 60);
        const ky = y + ph / 2 + (rnd() - 0.5) * 8;
        g.fillStyle = 'rgba(60,28,8,0.35)';
        g.beginPath();
        g.ellipse(kx, ky, 11, 6, 0, 0, TAU);
        g.fill();
        rings(g, kx, ky, 15, 8, 3, 'rgba(60,28,8,0.3)');
      }
      groove(g, 0, y + ph - 1.5, S, y + ph - 1.5, 3.2);
      for (const nx of [14, S - 14]) rivet(g, nx, y + ph / 2, 2.6, 'rgba(120,120,128,0.9)');
    }
  },
  stone(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    const rows = 4;
    const rh = S / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      const brickW = S / 3;
      const off = r % 2 === 0 ? 0 : -brickW / 2;
      for (let b = 0; b < 4; b++) {
        const x = off + b * brickW;
        g.fillStyle =
          rnd() < 0.5
            ? `rgba(255,255,255,${(0.04 + rnd() * 0.12).toFixed(2)})`
            : `rgba(20,20,28,${(0.04 + rnd() * 0.14).toFixed(2)})`;
        g.fillRect(x + 2, y + 2, brickW - 4, rh - 4);
        groove(g, x, y, x, y + rh, 3.5);
      }
      groove(g, 0, y, S, y, 3.5);
    }
    speckle(g, rnd, S, 700, '255,255,255', '20,20,25', 2.4, 0.28);
    for (let i = 0; i < 3; i++) crack(g, rnd, rnd() * S, rnd() * S, 4 + Math.floor(rnd() * 5));
    // Mossy corners.
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(90,150,70,${(0.08 + rnd() * 0.14).toFixed(2)})`;
      g.beginPath();
      g.arc(rnd() * 70, S - rnd() * 60, 2 + rnd() * 6, 0, TAU);
      g.fill();
    }
  },
  bamboo(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    // Vertical stalks side by side, each with its own tone and fibres.
    const stalks = 4;
    const sw = S / stalks;
    for (let s = 0; s < stalks; s++) {
      const x = s * sw;
      g.fillStyle = rnd() < 0.5 ? 'rgba(200,230,120,0.14)' : 'rgba(20,70,20,0.1)';
      g.fillRect(x, 0, sw, S);
      const hl = g.createLinearGradient(x, 0, x + sw, 0);
      hl.addColorStop(0, 'rgba(0,0,0,0.18)');
      hl.addColorStop(0.3, 'rgba(255,255,220,0.2)');
      hl.addColorStop(1, 'rgba(0,0,0,0.2)');
      g.fillStyle = hl;
      g.fillRect(x, 0, sw, S);
      for (let i = 0; i < 6; i++) {
        g.strokeStyle = 'rgba(30,70,20,0.18)';
        g.lineWidth = 1;
        const fx = x + 6 + rnd() * (sw - 12);
        g.beginPath();
        g.moveTo(fx, 0);
        g.lineTo(fx + (rnd() - 0.5) * 3, S);
        g.stroke();
      }
      groove(g, x, 0, x, S, 3);
    }
    // Nodes: darker ring with a lighter lip, staggered per stalk.
    for (let s = 0; s < stalks; s++) {
      const y = ((s * 0.37 + 0.2) % 1) * S;
      g.fillStyle = 'rgba(40,70,25,0.55)';
      g.fillRect(s * sw, y - 3, sw, 6);
      g.fillStyle = 'rgba(255,255,220,0.3)';
      g.fillRect(s * sw, y + 3, sw, 1.5);
    }
  },
  foam(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    // Bubbly sponge: lit rim on the top-left of each pore, darker pore centre.
    for (let i = 0; i < 90; i++) {
      const r = 3 + rnd() * 9;
      const x = rnd() * S;
      const y = rnd() * S;
      g.fillStyle = `rgba(150,60,90,${(0.08 + rnd() * 0.1).toFixed(2)})`;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, r, Math.PI * 0.9, Math.PI * 1.7);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.beginPath();
      g.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, TAU);
      g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 5;
    g.setLineDash([14, 10]);
    g.strokeRect(12, 12, S - 24, S - 24);
    g.setLineDash([]);
  },
  anchor(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    speckle(g, rnd, S, 300, '255,255,255', '0,0,0', 1.6, 0.18);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 6;
    g.strokeRect(10, 10, S - 20, S - 20);
    // Chain-link emblem above the hazard band.
    g.strokeStyle = 'rgba(226,232,240,0.7)';
    g.lineWidth = 7;
    for (const lx of [S * 0.38, S * 0.62]) {
      g.beginPath();
      g.ellipse(lx, S * 0.4, 26, 16, 0, 0, TAU);
      g.stroke();
    }
    g.fillStyle = '#fbbf24';
    g.fillRect(0, S - 42, S, 42);
    g.fillStyle = '#1e293b';
    for (let x = -40; x < S + 40; x += 36) {
      g.beginPath();
      g.moveTo(x, S);
      g.lineTo(x + 18, S);
      g.lineTo(x + 38, S - 42);
      g.lineTo(x + 20, S - 42);
      g.closePath();
      g.fill();
    }
    corners(g, 26, 7);
  },
  steel(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    // Brushed metal streaks.
    for (let i = 0; i < 110; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.1)';
      g.fillRect(rnd() * 40, rnd() * S, S - rnd() * 40, 0.8 + rnd() * 1.6);
    }
    // Panel seams with a diamond-plate accent in the centre cross.
    groove(g, 6, 6, S - 6, 6, 4);
    groove(g, 6, S - 6, S - 6, S - 6, 4);
    groove(g, 6, 6, 6, S - 6, 4);
    groove(g, S - 6, 6, S - 6, S - 6, 4);
    groove(g, 6, S / 2, S - 6, S / 2, 4);
    corners(g, 22, 5);
    for (const rx of [S * 0.35, S * 0.65]) rivet(g, rx, S / 2 + 18, 3.4);
    // Scuffs.
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.lineWidth = 1;
      const sx = 30 + rnd() * (S - 60);
      const sy = 30 + rnd() * (S - 60);
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx + 12 + rnd() * 18, sy + (rnd() - 0.5) * 6);
      g.stroke();
    }
  },
  shield(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    g.fillStyle = 'rgba(12,74,110,0.38)';
    g.fillRect(14, 14, S - 28, S - 28);
    // Glassy panel with diagonal sheen streaks.
    g.save();
    g.beginPath();
    g.rect(14, 14, S - 28, S - 28);
    g.clip();
    for (const [x, w, a] of [
      [40, 26, 0.2],
      [92, 10, 0.26],
      [150, 34, 0.12],
    ]) {
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + w, 0);
      g.lineTo(x + w - 120, S);
      g.lineTo(x - 120, S);
      g.closePath();
      g.fill();
    }
    g.restore();
    g.strokeStyle = '#bae6fd';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(S / 2, S / 2, 62, 0, TAU);
    g.stroke();
    g.lineWidth = 3;
    g.setLineDash([8, 7]);
    g.beginPath();
    g.arc(S / 2, S / 2, 48, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    g.lineWidth = 4;
    g.beginPath();
    g.arc(S / 2, S / 2, 34, 0, TAU);
    g.stroke();
    // Hex energy cells inside the inner ring.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      g.fillStyle = 'rgba(224,242,254,0.55)';
      g.beginPath();
      g.arc(S / 2 + Math.cos(a) * 24, S / 2 + Math.sin(a) * 24, 4, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#e0f2fe';
    g.beginPath();
    g.arc(S / 2, S / 2, 12, 0, TAU);
    g.fill();
    speckle(g, rnd, S, 60, '255,255,255', '255,255,255', 1, 0.3);
    corners(g, 24, 4, 'rgba(186,230,253,0.9)');
  },
  laser(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    g.fillStyle = 'rgba(69,10,10,0.45)';
    g.fillRect(16, 16, S - 32, S - 32);
    // Heat-sink fins at the top and bottom.
    for (let x = 26; x < S - 20; x += 14) {
      g.fillStyle = 'rgba(0,0,0,0.38)';
      g.fillRect(x, 20, 6, 22);
      g.fillRect(x, S - 42, 6, 22);
      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.fillRect(x + 6, 20, 1.5, 22);
      g.fillRect(x + 6, S - 42, 1.5, 22);
    }
    g.strokeStyle = '#fecaca';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(S / 2, 50);
    g.lineTo(S / 2, S - 50);
    g.moveTo(24, S / 2);
    g.lineTo(S - 24, S / 2);
    g.stroke();
    const glow = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, 46);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.35, 'rgba(254,240,138,0.95)');
    glow.addColorStop(1, 'rgba(254,240,138,0)');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(S / 2, S / 2, 46, 0, TAU);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(S / 2, S / 2, 11, 0, TAU);
    g.fill();
    speckle(g, rnd, S, 80, '255,200,200', '40,0,0', 1.2, 0.2);
    corners(g, 24, 4);
  },
  rubber(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    // Tyre-tread chevrons, each with a lit edge so the ridges stand proud.
    for (let row = 0; row < 8; row++) {
      const y = row * 32;
      for (const [dir, x0] of [
        [1, S / 2],
        [-1, S / 2],
      ] as const) {
        g.strokeStyle = 'rgba(30,16,12,0.38)';
        g.lineWidth = 9;
        g.beginPath();
        g.moveTo(x0, y + 4);
        g.lineTo(x0 + dir * (S / 2), y + 22);
        g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.18)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x0, y + 11);
        g.lineTo(x0 + dir * (S / 2), y + 29);
        g.stroke();
      }
    }
    speckle(g, rnd, S, 260, '255,255,255', '0,0,0', 1.2, 0.14);
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.lineWidth = 4;
    g.strokeRect(10, 10, S - 20, S - 20);
  },
  pontoon(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    g.fillStyle = '#f97316';
    g.fillRect(0, 32, S, 36);
    g.fillRect(0, S - 68, S, 36);
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(0, 46, S, 8);
    g.fillRect(0, S - 54, S, 8);
    // Rope loops down the middle band, and a sun-faded gradient.
    g.strokeStyle = 'rgba(120,80,30,0.7)';
    g.lineWidth = 4;
    for (let x = 18; x < S; x += 20) {
      g.beginPath();
      g.arc(x, S / 2, 9, Math.PI, 0, true);
      g.stroke();
    }
    speckle(g, rnd, S, 200, '255,255,255', '30,60,90', 1.4, 0.15);
    for (const [rx, ry] of [
      [28, 18],
      [S - 28, 18],
      [28, S - 18],
      [S - 28, S - 18],
    ]) {
      rivet(g, rx, ry, 5, '#a16207');
    }
  },
  carbon(g, _rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    // Twill weave: tilted tiles with alternating highlights.
    const step = 16;
    for (let y = 0; y < S; y += step) {
      for (let x = 0; x < S; x += step) {
        const even = ((x + y) / step) % 2 === 0;
        const grad = even
          ? g.createLinearGradient(x, y, x + step, y)
          : g.createLinearGradient(x, y, x, y + step);
        grad.addColorStop(0, 'rgba(255,255,255,0.22)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.02)');
        grad.addColorStop(1, 'rgba(0,0,0,0.38)');
        g.fillStyle = grad;
        g.fillRect(x, y, step - 1, step - 1);
      }
    }
    g.strokeStyle = 'rgba(226,232,240,0.28)';
    g.lineWidth = 4;
    g.strokeRect(6, 6, S - 12, S - 12);
    corners(g, 22, 4);
  },
  titanium(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    for (let i = 0; i < 110; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(51,65,85,0.1)';
      g.fillRect(0, rnd() * S, S, 0.8 + rnd() * 1.2);
    }
    // Anodised sheen sweeping across the plate.
    const sheen = g.createLinearGradient(0, 0, S, S);
    sheen.addColorStop(0, 'rgba(255,255,255,0.3)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.8, 'rgba(120,160,255,0.14)');
    sheen.addColorStop(1, 'rgba(255,255,255,0.05)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, S, S);
    groove(g, 8, 8, S - 8, 8, 4);
    groove(g, 8, S - 8, S - 8, S - 8, 4);
    groove(g, 8, 8, 8, S - 8, 4);
    groove(g, S - 8, 8, S - 8, S - 8, 4);
    groove(g, S / 2, 8, S / 2, S - 8, 4);
    corners(g, 24, 4.5);
    for (const y of [S * 0.35, S * 0.65]) {
      rivet(g, S / 2 - 22, y, 3);
      rivet(g, S / 2 + 22, y, 3);
    }
  },
  magnet(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    g.fillStyle = 'rgba(49,16,96,0.35)';
    g.fillRect(18, 18, S - 36, S - 36);
    // Horseshoe-style red/blue poles with white caps and a wound copper coil between them.
    g.fillStyle = '#ef4444';
    g.fillRect(28, 48, 36, S - 96);
    g.fillStyle = '#3b82f6';
    g.fillRect(S - 64, 48, 36, S - 96);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(28, 48, 36, 10);
    g.fillRect(S - 64, 48, 36, 10);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(32, 62, 6, S - 124);
    g.fillRect(S - 60, 62, 6, S - 124);
    g.strokeStyle = '#e9d5ff';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(S / 2, S / 2, 34, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(217,119,6,0.85)';
    g.lineWidth = 2;
    for (let r = 14; r < 32; r += 4) {
      g.beginPath();
      g.arc(S / 2, S / 2, r, 0, TAU);
      g.stroke();
    }
    // Little lightning sparks.
    g.strokeStyle = 'rgba(233,213,255,0.8)';
    g.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const sx = 80 + rnd() * 96;
      const sy = 36 + rnd() * 20 + (i % 2) * (S - 100);
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx + 6, sy + 6);
      g.lineTo(sx - 2, sy + 10);
      g.lineTo(sx + 5, sy + 17);
      g.stroke();
    }
    corners(g, 24, 5);
  },
  diamond(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    const half = S / 2;
    // Eight kite facets fanning from the centre, each lit differently.
    const tones = [
      'rgba(255,255,255,0.4)',
      'rgba(165,243,252,0.3)',
      'rgba(14,116,144,0.22)',
      'rgba(255,255,255,0.18)',
      'rgba(21,94,117,0.3)',
      'rgba(224,255,255,0.35)',
      'rgba(14,116,144,0.16)',
      'rgba(165,243,252,0.22)',
    ];
    const ring: Array<[number, number]> = [
      [0, 0],
      [half, 0],
      [S, 0],
      [S, half],
      [S, S],
      [half, S],
      [0, S],
      [0, half],
    ];
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length];
      g.fillStyle = tones[i];
      g.beginPath();
      g.moveTo(half, half);
      g.lineTo(p[0], p[1]);
      g.lineTo(q[0], q[1]);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1.5;
      g.stroke();
    });
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 3;
    g.strokeRect(S * 0.25, S * 0.25, S * 0.5, S * 0.5);
    for (let i = 0; i < 9; i++) {
      const sx = 20 + rnd() * (S - 40);
      const sy = 20 + rnd() * (S - 40);
      const r = 3 + rnd() * 5;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(sx, sy - r * 2);
      g.lineTo(sx + r * 0.5, sy - r * 0.5);
      g.lineTo(sx + r * 2, sy);
      g.lineTo(sx + r * 0.5, sy + r * 0.5);
      g.lineTo(sx, sy + r * 2);
      g.lineTo(sx - r * 0.5, sy + r * 0.5);
      g.lineTo(sx - r * 2, sy);
      g.lineTo(sx - r * 0.5, sy - r * 0.5);
      g.closePath();
      g.fill();
    }
  },
  beaver(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    // Stacked bark logs with ring-cut ends and gnaw marks.
    const rows = 4;
    for (let i = 0; i < rows; i++) {
      const y = (i / rows) * S;
      g.fillStyle = i % 2 === 0 ? 'rgba(62,39,35,0.28)' : 'rgba(255,224,178,0.12)';
      g.fillRect(0, y, S, S / rows - 4);
      for (let k = 0; k < 14; k++) {
        g.strokeStyle = 'rgba(40,20,5,0.28)';
        g.lineWidth = 1;
        const bx = rnd() * S;
        g.beginPath();
        g.moveTo(bx, y + 4);
        g.lineTo(bx + (rnd() - 0.5) * 6, y + S / rows - 8);
        g.stroke();
      }
      groove(g, 0, y + S / rows - 2, S, y + S / rows - 2, 4);
      g.fillStyle = 'rgba(255,224,178,0.5)';
      g.beginPath();
      g.ellipse(14, y + S / rows / 2 - 2, 9, 12, 0, 0, TAU);
      g.fill();
      rings(g, 14, y + S / rows / 2 - 2, 9, 12, 3, 'rgba(100,60,30,0.5)');
    }
    // Two big buck teeth in the middle.
    g.fillStyle = '#fff8e1';
    g.fillRect(S / 2 - 26, S / 2 - 30, 24, 60);
    g.fillRect(S / 2 + 2, S / 2 - 30, 24, 60);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(S / 2 - 22, S / 2 - 26, 5, 40);
    g.fillRect(S / 2 + 6, S / 2 - 26, 5, 40);
    g.strokeStyle = '#6d4c41';
    g.lineWidth = 4;
    g.strokeRect(S / 2 - 26, S / 2 - 30, 24, 60);
    g.strokeRect(S / 2 + 2, S / 2 - 30, 24, 60);
  },
  owl(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    // Overlapping feather scallops, each with a pale tip and a shaft line.
    for (let y = 18; y < S + 24; y += 22) {
      for (let x = (y / 22) % 2 === 0 ? 0 : 14; x < S + 28; x += 28) {
        g.fillStyle = `rgba(62,39,35,${(0.05 + rnd() * 0.08).toFixed(2)})`;
        g.beginPath();
        g.arc(x, y, 14, 0, Math.PI);
        g.fill();
        g.strokeStyle = 'rgba(62,39,35,0.4)';
        g.lineWidth = 2.5;
        g.stroke();
        g.strokeStyle = 'rgba(255,240,210,0.2)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, y - 2, 11, 0.2, Math.PI - 0.2);
        g.stroke();
      }
    }
    // Facial discs, big round amber eyes with glints, brows, and a beak.
    for (const ex of [S * 0.3, S * 0.7]) {
      g.fillStyle = 'rgba(239,228,208,0.55)';
      g.beginPath();
      g.arc(ex, S * 0.42, 42, 0, TAU);
      g.fill();
      g.fillStyle = '#fffde7';
      g.beginPath();
      g.arc(ex, S * 0.42, 34, 0, TAU);
      g.fill();
      g.fillStyle = '#ffb300';
      g.beginPath();
      g.arc(ex, S * 0.42, 22, 0, TAU);
      g.fill();
      g.fillStyle = '#1b1b1b';
      g.beginPath();
      g.arc(ex, S * 0.42, 10, 0, TAU);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(ex - 5, S * 0.42 - 5, 4, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#ff9800';
    g.beginPath();
    g.moveTo(S / 2 - 14, S * 0.58);
    g.lineTo(S / 2 + 14, S * 0.58);
    g.lineTo(S / 2, S * 0.74);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(120,60,0,0.6)';
    g.lineWidth = 2;
    g.stroke();
  },
  spider(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    g.fillStyle = 'rgba(20,30,10,0.3)';
    g.fillRect(14, 14, S - 28, S - 28);
    // A white spider web: spokes plus sagging ring threads, with dew drops on the rings.
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2.6;
    const cx = S / 2;
    const cy = S / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * 118, cy + Math.sin(a) * 118);
      g.stroke();
    }
    g.lineWidth = 2;
    for (const r of [26, 52, 78, 100, 118]) {
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * TAU;
        const a1 = ((i + 1) / 8) * TAU;
        const p0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
        const p1 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r];
        const am = (a0 + a1) / 2;
        g.moveTo(p0[0], p0[1]);
        g.quadraticCurveTo(cx + Math.cos(am) * r * 0.9, cy + Math.sin(am) * r * 0.9, p1[0], p1[1]);
      }
      g.stroke();
    }
    for (let i = 0; i < 24; i++) {
      const a = rnd() * TAU;
      const r = 26 + rnd() * 92;
      g.fillStyle = 'rgba(200,230,255,0.8)';
      g.beginPath();
      g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.8, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#e53935';
    g.beginPath();
    g.arc(cx, cy, 11, 0, TAU);
    g.fill();
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(cx, cy, 5, 0, TAU);
    g.fill();
  },
  door(g, rnd, base) {
    const S = TEXTURE_SIZE;
    fill(g, base);
    // Vertical plank grain across the whole door.
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = rnd() < 0.5 ? 'rgba(60,30,10,0.18)' : 'rgba(255,230,180,0.12)';
      g.lineWidth = 0.8 + rnd();
      const x0 = rnd() * S;
      g.beginPath();
      g.moveTo(x0, 0);
      for (let y = 0; y <= S; y += 16) g.lineTo(x0 + Math.sin(y * 0.03 + i) * 2, y);
      g.stroke();
    }
    g.strokeStyle = 'rgba(55,30,12,0.55)';
    g.lineWidth = 14;
    g.strokeRect(7, 7, S - 14, S - 14);
    g.fillStyle = 'rgba(55,30,12,0.22)';
    g.fillRect(36, 28, S - 72, S * 0.34);
    g.fillRect(36, S * 0.54, S - 72, S * 0.34);
    g.strokeStyle = 'rgba(255,235,205,0.22)';
    g.lineWidth = 3;
    g.strokeRect(36, 28, S - 72, S * 0.34);
    g.strokeRect(36, S * 0.54, S - 72, S * 0.34);
    // Iron hinges on the left, and a brass knob with a keyhole plate on the right.
    for (const hy of [S * 0.2, S * 0.78]) {
      g.fillStyle = 'rgba(30,30,36,0.85)';
      g.fillRect(8, hy - 8, 34, 16);
      rivet(g, 16, hy, 3, 'rgba(160,160,170,0.9)');
      rivet(g, 34, hy, 3, 'rgba(160,160,170,0.9)');
    }
    g.fillStyle = 'rgba(30,20,10,0.5)';
    g.fillRect(S - 52, S * 0.52 - 18, 28, 44);
    g.fillStyle = '#fbbf24';
    g.beginPath();
    g.arc(S - 38, S * 0.52, 12, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.arc(S - 42, S * 0.52 - 4, 3.5, 0, TAU);
    g.fill();
    g.strokeStyle = '#78350f';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(S - 38, S * 0.52, 12, 0, TAU);
    g.stroke();
  },
  ladder(g, rnd, base) {
    const S = TEXTURE_SIZE;
    g.fillStyle = 'rgba(40,24,10,1)';
    g.fillRect(0, 0, S, S);
    g.fillStyle = base;
    for (const x of [S * 0.16, S * 0.74]) g.fillRect(x, 0, S * 0.1, S);
    const rungs = 5;
    for (let i = 0; i < rungs; i++) {
      const y = ((i + 0.5) / rungs) * S - 8;
      g.fillStyle = base;
      g.fillRect(S * 0.16, y, S * 0.68, 16);
      g.fillStyle = 'rgba(255,230,180,0.25)';
      g.fillRect(S * 0.16, y, S * 0.68, 4);
      g.fillStyle = 'rgba(40,20,5,0.35)';
      g.fillRect(S * 0.16, y + 13, S * 0.68, 3);
      // Pegs where each rung is fixed into the rails.
      for (const x of [S * 0.21, S * 0.79]) rivet(g, x, y + 8, 3, 'rgba(110,70,30,0.95)');
    }
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = 'rgba(60,30,10,0.3)';
      g.lineWidth = 1;
      const x = (rnd() < 0.5 ? S * 0.16 : S * 0.74) + rnd() * S * 0.1;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + (rnd() - 0.5) * 3, S);
      g.stroke();
    }
  },
};
