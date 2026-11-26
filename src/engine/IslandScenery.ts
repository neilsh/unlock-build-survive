/**
 * Decorative island dressing: richer grass and dirt textures, rim scenery (trees, bushes, mushrooms,
 * flowers, grass tufts, pebbles, boulders) and hanging rocks under the island. Everything is
 * procedural, deterministic (seeded) and purely visual: nothing here touches the physics sim.
 * Repeated props are InstancedMeshes sharing one geometry/material each, so the whole set costs a
 * dozen draw calls. Meshes are plain children of the returned group, so the caller can dispose them
 * by traversing it.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../utils/rng';

type Rnd = () => number;
const TAU = Math.PI * 2;

function canvasTexture(size: number, paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas context unavailable');
  paint(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Soft grass: tone patches, blade strokes, clover dots, a few dirt specks. One tile per 8x8 units. */
export function grassTexture(): THREE.CanvasTexture {
  const size = 256;
  const t = canvasTexture(size, (g) => {
    g.fillStyle = '#7ed957';
    g.fillRect(0, 0, size, size);
    const r = mulberry32(7);
    // Large soft tone patches so the lawn is not one flat green.
    for (let i = 0; i < 26; i++) {
      const x = r() * size;
      const y = r() * size;
      const rad = 22 + r() * 40;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      const dark = r() < 0.5;
      grad.addColorStop(0, dark ? 'rgba(40,130,60,0.22)' : 'rgba(200,255,130,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Blades: short slanted strokes, light and dark.
    g.lineCap = 'round';
    for (let i = 0; i < 1100; i++) {
      const x = r() * size;
      const y = r() * size;
      const lean = (r() - 0.5) * 5;
      g.strokeStyle = r() > 0.5 ? 'rgba(200,255,140,0.5)' : 'rgba(40,130,50,0.4)';
      g.lineWidth = 1 + r() * 1.2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + lean, y - 3 - r() * 5);
      g.stroke();
    }
    // Clover/daisy dots and a few bare-earth specks.
    for (let i = 0; i < 40; i++) {
      g.fillStyle =
        i % 3 === 0 ? 'rgba(255,255,255,0.8)' : i % 3 === 1 ? 'rgba(255,214,90,0.8)' : 'rgba(120,70,40,0.35)';
      g.beginPath();
      g.arc(r() * size, r() * size, 0.8 + r() * 1.2, 0, TAU);
      g.fill();
    }
  });
  // ExtrudeGeometry UVs are in world units, so this is one 8x8-unit tile per repeat.
  t.repeat.set(1 / 8, 1 / 8);
  return t;
}

/** Layered earth for the island's side wall and underside: strata bands, pebbles, root threads. */
export function dirtTexture(): THREE.CanvasTexture {
  const size = 256;
  const t = canvasTexture(size, (g) => {
    g.fillStyle = '#8b5a3c';
    g.fillRect(0, 0, size, size);
    const r = mulberry32(19);
    const bands = [
      'rgba(110,70,40,0.5)',
      'rgba(170,120,80,0.4)',
      'rgba(70,45,28,0.45)',
      'rgba(200,150,100,0.3)',
    ];
    let y = 0;
    while (y < size) {
      const h = 10 + r() * 26;
      g.fillStyle = bands[Math.floor(r() * bands.length)];
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 3);
      g.lineTo(size, y + h);
      g.lineTo(0, y + h);
      g.closePath();
      g.fill();
      y += h;
    }
    for (let i = 0; i < 160; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(220,200,170,0.5)' : 'rgba(40,25,15,0.4)';
      g.beginPath();
      g.ellipse(r() * size, r() * size, 1 + r() * 3.5, 1 + r() * 2.2, r() * 3, 0, TAU);
      g.fill();
    }
    g.strokeStyle = 'rgba(60,35,20,0.55)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      let x = r() * size;
      let yy = 0;
      g.moveTo(x, yy);
      while (yy < size) {
        x += (r() - 0.5) * 10;
        yy += 12;
        g.lineTo(x, yy);
      }
      g.stroke();
    }
  });
  t.repeat.set(1 / 6, 1 / 6);
  return t;
}

interface Placement {
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx: number;
  sy?: number;
  sz?: number;
}

function instanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  items: readonly Placement[],
  colors?: readonly THREE.ColorRepresentation[],
  shadow = false,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  const o = new THREE.Object3D();
  const c = new THREE.Color();
  items.forEach((p, i) => {
    o.position.set(p.x, p.y, p.z);
    o.rotation.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
    o.scale.set(p.sx, p.sy ?? p.sx, p.sz ?? p.sx);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    if (colors) mesh.setColorAt(i, c.set(colors[i % colors.length]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  // Instances spread over the whole rim; the default bounding sphere is the single base geometry's.
  mesh.frustumCulled = false;
  return mesh;
}

/** Random point on the rim ring just outside the build area (the build area is `size` wide). */
function rimPoint(r: Rnd, size: number, inner: number, outer: number): [number, number] {
  const side = Math.floor(r() * 4);
  const along = (r() - 0.5) * (size + 1.6);
  const out = size / 2 + inner + r() * (outer - inner);
  return (
    [
      [along, out],
      [along, -out],
      [out, along],
      [-out, along],
    ] as [number, number][]
  )[side];
}

function tuftGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const blade = new THREE.ConeGeometry(0.045, 0.34 + (i % 3) * 0.08, 4);
    blade.translate(0, 0.2, 0);
    blade.rotateZ((i - 2) * 0.28);
    blade.rotateY(i * 1.3);
    parts.push(blade);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

function flowerHeadGeometry(): THREE.BufferGeometry {
  // Five round petals around a centre, merged so one instance is one flower head.
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const petal = new THREE.SphereGeometry(0.075, 6, 5);
    petal.scale(1, 0.45, 1);
    const a = (i / 5) * TAU;
    petal.translate(Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09);
    parts.push(petal);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

function std(color: THREE.ColorRepresentation, roughness = 0.85, flat = false): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: flat });
}

/** Builds the scenery around an island whose build area is `size` world units wide. */
export function buildIslandScenery(size: number): THREE.Group {
  const root = new THREE.Group();
  root.name = 'island-scenery';
  const r = mulberry32(42);
  const half = size / 2;

  // Grass tufts hugging the rim.
  const tufts: Placement[] = [];
  const tuftColors = ['#6fcf4a', '#59b83c', '#8be05a', '#4aa83a'];
  for (let i = 0; i < 90; i++) {
    const [x, z] = rimPoint(r, size, 0.1, 1.3);
    tufts.push({ x, y: 0, z, ry: r() * TAU, sx: 0.8 + r() * 0.9, sy: 0.8 + r() * 1 });
  }
  root.add(instanced(tuftGeometry(), std('#ffffff', 0.9), tufts, tuftColors));

  // Flowers: a thin stem plus a five-petal head with a bright centre.
  const flowers: Placement[] = [];
  const heads: Placement[] = [];
  const centers: Placement[] = [];
  const petalColors = ['#ff8fb1', '#ffd23f', '#ffffff', '#c792ff', '#ff9e5e'];
  const headColors: THREE.ColorRepresentation[] = [];
  for (let i = 0; i < 46; i++) {
    const [x, z] = rimPoint(r, size, 0.25, 1.25);
    const h = 0.22 + r() * 0.18;
    flowers.push({ x, y: h / 2, z, sx: 1, sy: h });
    heads.push({ x, y: h + 0.02, z, ry: r() * TAU, sx: 0.9 + r() * 0.4, rx: (r() - 0.5) * 0.3 });
    centers.push({ x, y: h + 0.06, z, sx: 0.05 });
    headColors.push(petalColors[i % petalColors.length]);
  }
  root.add(
    instanced(new THREE.CylinderGeometry(0.012, 0.016, 1, 5), std('#3f9a3a'), flowers),
    instanced(flowerHeadGeometry(), std('#ffffff', 0.55), heads, headColors),
    instanced(new THREE.SphereGeometry(1, 6, 5), std('#ffb703', 0.5), centers),
  );

  // Mushrooms: spotted red caps on pale stems.
  const stems: Placement[] = [];
  const caps: Placement[] = [];
  const spots: Placement[] = [];
  for (let i = 0; i < 9; i++) {
    const [x, z] = rimPoint(r, size, 0.3, 1.2);
    const s = 0.7 + r() * 0.7;
    stems.push({ x, y: 0.1 * s, z, sx: 0.06 * s, sy: 0.2 * s, sz: 0.06 * s });
    caps.push({ x, y: 0.2 * s, z, sx: 0.16 * s, sy: 0.12 * s, sz: 0.16 * s });
    for (let k = 0; k < 3; k++) {
      const a = r() * TAU;
      spots.push({
        x: x + Math.cos(a) * 0.09 * s,
        y: 0.2 * s + 0.09 * s,
        z: z + Math.sin(a) * 0.09 * s,
        sx: 0.025 * s,
        sy: 0.012 * s,
        sz: 0.025 * s,
      });
    }
  }
  root.add(
    instanced(new THREE.CylinderGeometry(1, 1, 1, 8), std('#f4ead2'), stems, undefined, true),
    instanced(
      new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2),
      std('#e53935', 0.6),
      caps,
      undefined,
      true,
    ),
    instanced(new THREE.SphereGeometry(1, 6, 4), std('#ffffff', 0.6), spots),
  );

  // Boulders and pebbles: jittered low-poly rocks with per-instance tone.
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const pos = rockGeo.attributes.position;
  const jit = mulberry32(5);
  for (let i = 0; i < pos.count; i++) {
    const k = 0.82 + jit() * 0.3;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.8, pos.getZ(i) * k);
  }
  rockGeo.computeVertexNormals();
  const rocks: Placement[] = [];
  const rockColors = ['#9aa3ad', '#8a929c', '#aab2bb', '#7d868f'];
  for (let i = 0; i < 12; i++) {
    const a = r() * TAU;
    const d = half + 0.2 + r() * 0.9;
    const s = 0.25 + r() * 0.4;
    rocks.push({
      x: Math.cos(a) * d,
      y: -0.1 + s * 0.1,
      z: Math.sin(a) * d,
      ry: r() * TAU,
      sx: s,
      sy: s * 0.8,
    });
  }
  for (let i = 0; i < 34; i++) {
    const [x, z] = rimPoint(r, size, 0.2, 1.3);
    const s = 0.05 + r() * 0.08;
    rocks.push({ x, y: s * 0.3, z, ry: r() * TAU, sx: s, sy: s * 0.7 });
  }
  root.add(instanced(rockGeo, std('#ffffff', 0.9, true), rocks, rockColors, true));

  // Trees at the four corners: chunky trunk with stacked round canopies, plus a couple of bushes.
  const corner = half + 0.55;
  const trunks: Placement[] = [];
  const crowns: Placement[] = [];
  const crownColors: THREE.ColorRepresentation[] = [];
  const greens = ['#3f9b46', '#4caf50', '#2e8b57', '#66bb6a'];
  const treeSpots: [number, number][] = [
    [-corner, -corner],
    [corner, -corner],
    [-corner, corner * 0.2],
    [corner, corner * 0.35],
  ];
  treeSpots.forEach(([x, z], i) => {
    const h = 1.6 + r() * 0.7;
    trunks.push({ x, y: h / 2, z, sx: 0.18, sy: h, sz: 0.18 });
    const g = greens[i % greens.length];
    for (let k = 0; k < 3; k++) {
      const s = 0.95 - k * 0.2;
      crowns.push({
        x: x + (r() - 0.5) * 0.15,
        y: h + 0.2 + k * 0.55,
        z: z + (r() - 0.5) * 0.15,
        sx: s,
        sy: s * 0.85,
      });
      crownColors.push(g);
    }
  });
  const bushes: Placement[] = [];
  const bushColors: THREE.ColorRepresentation[] = [];
  for (let i = 0; i < 6; i++) {
    const [x, z] = rimPoint(r, size, 0.4, 1.2);
    const s = 0.28 + r() * 0.22;
    bushes.push({ x, y: s * 0.5, z, sx: s, sy: s * 0.75 });
    bushColors.push(greens[i % greens.length]);
    bushes.push({ x: x + s * 0.7, y: s * 0.35, z: z + s * 0.3, sx: s * 0.7, sy: s * 0.5 });
    bushColors.push(greens[(i + 1) % greens.length]);
  }
  const blob = new THREE.IcosahedronGeometry(1, 1);
  root.add(
    instanced(new THREE.CylinderGeometry(0.75, 1, 1, 7), std('#7a5230', 0.95), trunks, undefined, true),
    instanced(blob, std('#ffffff', 0.85, true), crowns, crownColors, true),
    instanced(blob, std('#ffffff', 0.85, true), bushes, bushColors, true),
  );

  // Hanging rocks under the island, so it reads as a floating chunk of earth.
  const hang: Placement[] = [];
  const hangColors = ['#7d6350', '#6b5444', '#8a6f5a'];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + r() * 0.4;
    const d = half * (0.3 + r() * 0.5);
    const len = 2 + r() * 3;
    hang.push({
      x: Math.cos(a) * d,
      y: -4.2 - len * 0.5,
      z: Math.sin(a) * d,
      rx: Math.PI,
      sx: 0.5 + r() * 0.5,
      sy: len,
      sz: 0.5 + r() * 0.5,
    });
  }
  root.add(instanced(new THREE.ConeGeometry(1, 1, 6), std('#ffffff', 1, true), hang, hangColors, true));

  return root;
}
