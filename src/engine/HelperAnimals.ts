/**
 * Procedural critters that sit on top of animal-helper blocks (beaver, owl, spider). They pop in when
 * the block is placed, follow it while a disaster runs, and play a short reaction when the sim reports
 * that the helper did something. Pure Three.js and headless-safe: no React, DOM or Rapier.
 *
 * One scene is shared by both split-screen viewports, so both players see the animals.
 */
import * as THREE from 'three';
import type { BlockData, Vec3 } from '../types/blueprint';
import { cellToWorld } from '../types/blueprint';
import type { HelperKind } from '../types/materials';
import { getMaterialDef } from '../types/materials';

/** Never draw more than this many critters, so huge zoos stay smooth. */
export const MAX_HELPER_ANIMALS = 24;
/** Critters stand on the block's top face (centre + 1). */
const PERCH_HEIGHT = 1;
const POP_SECONDS = 0.35;
const REACT_SECONDS = 0.6;

export interface HelperAnimalPose {
  id: string;
  pos: Vec3;
}

/** Parts animated per kind: tail (beaver), wings (owl), legs and web ring (spider). */
interface AnimalParts {
  /** Eyeballs scaled flat for a blink (each carries its open height in userData.baseY). */
  eyes?: THREE.Object3D[];
  /** Ears that twitch now and then. */
  ears?: THREE.Object3D[];
  tail?: THREE.Object3D;
  wings?: THREE.Object3D[];
  legs?: THREE.Object3D[];
  web?: THREE.Object3D;
}

interface Animal {
  id: string;
  kind: HelperKind;
  group: THREE.Group;
  parts: AnimalParts;
  base: Vec3;
  age: number;
  /** Seconds left in the current reaction, 0 when idle. */
  react: number;
  yaw: number;
  targetYaw: number;
  phase: number;
}

const isHelper = (m: string): m is HelperKind => m === 'beaver' || m === 'owl' || m === 'spider';

export class HelperAnimals {
  private readonly animals = new Map<string, Animal>();
  private readonly root = new THREE.Group();
  private readonly geoms: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly sphere = this.geo(new THREE.SphereGeometry(1, 14, 10));
  private readonly box = this.geo(new THREE.BoxGeometry(1, 1, 1));
  private readonly cone = this.geo(new THREE.ConeGeometry(1, 1, 10));
  private readonly cyl = this.geo(new THREE.CylinderGeometry(1, 1, 1, 8));
  private readonly matFur = this.mat(0x8d5a2b);
  private readonly matBelly = this.mat(0xe0b878);
  private readonly matTail = this.mat(0x4e342e);
  private readonly matTooth = this.mat(0xfffde7);
  private readonly matFeather = this.mat(0x8d6e63);
  private readonly matOwlFace = this.mat(0xefe4d0);
  private readonly matBeak = this.mat(0xff9800);
  private readonly matEye = this.mat(0xffc107);
  private readonly matPupil = this.mat(0x111111);
  private readonly matSpider = this.mat(0x263238);
  private readonly matSpiderMark = this.mat(0xe53935);
  private readonly matPink = this.mat(0xf4a6a6);
  private readonly matWhite = this.mat(0xffffff);
  private readonly matClaw = this.mat(0x4b3b32);
  private readonly matWhisker = this.mat(0xf5f0e6);
  private readonly matBellyOwl = this.mat(0xf3e9d2);
  private readonly matSpiderBand = this.mat(0x546e7a);
  private readonly matWeb = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly whisker = this.geo(new THREE.CylinderGeometry(0.006, 0.004, 1, 4));
  private readonly webGeom = this.geo(new THREE.RingGeometry(0.4, 1, 8, 1));

  constructor(parent: THREE.Object3D) {
    this.mats.push(this.matWeb);
    this.root.name = 'helper-animals';
    parent.add(this.root);
  }

  get count(): number {
    return this.animals.size;
  }

  has(id: string): boolean {
    return this.animals.has(id);
  }

  /** Makes the set of critters match the helper blocks in `blocks` (cheap to call repeatedly). */
  sync(blocks: readonly BlockData[]): void {
    const wanted = new Map<string, { kind: HelperKind; cell: Vec3 }>();
    for (const b of blocks) {
      if (wanted.size >= MAX_HELPER_ANIMALS) break;
      const special = getMaterialDef(b.material).special;
      if (special && isHelper(special) && b.material === special) {
        wanted.set(b.id, { kind: special, cell: b.cell });
      }
    }
    for (const [id, a] of this.animals) {
      const w = wanted.get(id);
      if (!w || w.kind !== a.kind) this.remove(id, a);
    }
    for (const [id, w] of wanted) {
      const world = cellToWorld(w.cell);
      const base: Vec3 = [world[0], world[1] + PERCH_HEIGHT, world[2]];
      const existing = this.animals.get(id);
      if (existing) {
        existing.base = base;
        continue;
      }
      this.add(id, w.kind, base);
    }
  }

  /** Starts a reaction (tail slap, swoop, web pulse). `target` is the swatted hazard for owls. */
  react(id: string, target: Vec3 | null): void {
    const a = this.animals.get(id);
    if (!a) return;
    a.react = REACT_SECONDS;
    if (target) a.targetYaw = Math.atan2(target[0] - a.base[0], target[2] - a.base[2]);
  }

  /**
   * Advances animation. `live` gives block poses during a run (critters ride their blocks); null puts
   * every critter back on its cell.
   */
  update(dt: number, live: readonly HelperAnimalPose[] | null): void {
    const step = Math.max(0, Math.min(dt, 0.05));
    const poses = live ? new Map(live.map((p) => [p.id, p.pos])) : null;
    for (const a of this.animals.values()) {
      a.age += step;
      a.phase += step;
      a.react = Math.max(0, a.react - step);
      const pos = poses?.get(a.id);
      if (pos) a.group.position.set(pos[0], pos[1] + PERCH_HEIGHT, pos[2]);
      else a.group.position.set(a.base[0], a.base[1], a.base[2]);
      let turn = a.targetYaw - a.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      a.yaw += turn * Math.min(1, step * 10);
      a.group.rotation.y = a.yaw;
      const t = Math.min(1, a.age / POP_SECONDS);
      const pop = t < 1 ? 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2 : 1;
      a.group.scale.setScalar(Math.max(0.001, t * pop));
      this.animate(a);
    }
  }

  dispose(): void {
    this.animals.clear();
    this.root.removeFromParent();
    for (const g of this.geoms) g.dispose();
    for (const m of this.mats) m.dispose();
  }

  // ------------------------------------------------------------------ internals

  private animate(a: Animal): void {
    const r = a.react / REACT_SECONDS; // 1 -> 0 over the reaction
    const idle = Math.sin(a.phase * 2.4 + a.id.length);
    a.group.position.y += Math.abs(idle) * 0.04;
    const { tail, wings, legs, web, eyes, ears } = a.parts;
    if (eyes) {
      const blink = (a.phase * 0.28 + (hash(a.id) % 10) / 10) % 1 > 0.955 ? 0.12 : 1;
      for (const e of eyes) e.scale.y = Number(e.userData.baseY) * blink;
    }
    if (ears) {
      const twitch = Math.max(0, Math.sin(a.phase * 1.3 + a.id.length)) ** 12;
      ears.forEach((ear, i) => {
        ear.rotation.z = (i === 0 ? 1 : -1) * twitch * 0.5;
      });
    }
    if (tail) {
      // Tail slap: the flat tail swings down hard and pops back up.
      tail.rotation.x = -0.35 + Math.sin(a.phase * 2) * 0.05 + (r > 0 ? Math.sin(r * Math.PI * 3) * 0.7 : 0);
    }
    if (wings) {
      const flap = r > 0 ? Math.sin(a.phase * 40) * 0.9 : Math.sin(a.phase * 1.5) * 0.04;
      wings.forEach((w, i) => {
        w.rotation.z = i === 0 ? -0.2 - flap : 0.2 + flap;
      });
      a.group.position.y += r * 0.5;
    }
    if (legs && web) {
      web.visible = r > 0;
      web.scale.setScalar(0.6 + (1 - r) * 3.2);
      const wig = r > 0 ? Math.sin(a.phase * 30) * 0.25 : Math.sin(a.phase * 3) * 0.04;
      legs.forEach((leg, i) => {
        leg.rotation.z = (i % 2 === 0 ? 1 : -1) * wig;
      });
    }
  }

  private add(id: string, kind: HelperKind, base: Vec3): void {
    const group = new THREE.Group();
    group.name = `helper-${kind}`;
    const parts =
      kind === 'beaver'
        ? this.buildBeaver(group)
        : kind === 'owl'
          ? this.buildOwl(group)
          : this.buildSpider(group);
    group.position.set(base[0], base[1], base[2]);
    group.scale.setScalar(0.001);
    this.root.add(group);
    const yaw = (hash(id) % 628) / 100;
    this.animals.set(id, {
      id,
      kind,
      group,
      parts,
      base,
      age: 0,
      react: 0,
      yaw,
      targetYaw: yaw,
      phase: (hash(id) % 100) / 10,
    });
  }

  private remove(id: string, a: Animal): void {
    this.root.remove(a.group);
    this.animals.delete(id);
  }

  private part(
    parent: THREE.Object3D,
    geom: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: Vec3,
    scale: Vec3,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(...pos);
    m.scale.set(...scale);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  /** An eyeball with a white glint, registered for blinking. */
  private eye(g: THREE.Object3D, pos: Vec3, size: number, mat: THREE.Material, eyes: THREE.Object3D[]): void {
    const ball = this.part(g, this.sphere, mat, pos, [size, size, size * 0.6]);
    ball.userData.baseY = size;
    this.part(ball, this.sphere, this.matWhite, [0.3, 0.35, 0.8], [0.3, 0.3, 0.3]);
    eyes.push(ball);
  }

  private whiskers(g: THREE.Object3D, at: Vec3, len: number): void {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const w = this.part(
          g,
          this.whisker,
          this.matWhisker,
          [at[0] + side * len * 0.5, at[1] + (i - 1) * 0.03, at[2]],
          [1, len, 1],
        );
        w.castShadow = false;
        w.rotation.z = side * (Math.PI / 2 + (i - 1) * 0.25);
      }
    }
  }

  private buildBeaver(g: THREE.Group): AnimalParts {
    const eyes: THREE.Object3D[] = [];
    const ears: THREE.Object3D[] = [];
    // Plump body, cream belly, round head with muzzle, ears, glinting eyes, buck teeth and whiskers.
    this.part(g, this.sphere, this.matFur, [0, 0.42, 0], [0.5, 0.42, 0.62]);
    this.part(g, this.sphere, this.matBelly, [0, 0.36, 0.12], [0.4, 0.34, 0.5]);
    this.part(g, this.sphere, this.matFur, [0, 0.78, 0.38], [0.34, 0.3, 0.32]);
    this.part(g, this.sphere, this.matBelly, [0, 0.7, 0.56], [0.2, 0.15, 0.16]);
    for (const x of [-0.2, 0.2]) {
      ears.push(this.part(g, this.sphere, this.matTail, [x, 1.04, 0.3], [0.09, 0.09, 0.07]));
      this.part(g, this.sphere, this.matPink, [x, 1.04, 0.34], [0.05, 0.05, 0.03]);
      this.eye(g, [x * 0.7, 0.86, 0.62], 0.055, this.matPupil, eyes);
    }
    this.part(g, this.sphere, this.matTail, [0, 0.76, 0.7], [0.1, 0.08, 0.08]);
    for (const x of [-0.05, 0.05]) this.part(g, this.box, this.matTooth, [x, 0.62, 0.68], [0.07, 0.15, 0.04]);
    this.whiskers(g, [0, 0.7, 0.62], 0.2);
    // Front paws with claws, and big hind feet.
    for (const x of [-0.16, 0.16]) {
      this.part(g, this.sphere, this.matTail, [x, 0.12, 0.42], [0.09, 0.07, 0.12]);
      this.part(g, this.sphere, this.matTail, [x * 1.5, 0.1, -0.15], [0.11, 0.07, 0.17]);
      for (const c of [-0.03, 0.03]) {
        this.part(g, this.box, this.matClaw, [x + c, 0.1, 0.54], [0.015, 0.025, 0.04]);
      }
    }
    // Flat paddle tail with a crosshatch of scale ridges.
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.2, -0.5);
    g.add(tailPivot);
    this.part(tailPivot, this.box, this.matTail, [0, 0, -0.38], [0.5, 0.08, 0.8]);
    for (let i = 0; i < 6; i++) {
      this.part(tailPivot, this.box, this.matFur, [0, 0.045, -0.12 - i * 0.12], [0.46, 0.012, 0.025]);
    }
    for (const x of [-0.12, 0, 0.12]) {
      this.part(tailPivot, this.box, this.matFur, [x, 0.046, -0.38], [0.02, 0.012, 0.7]);
    }
    return { tail: tailPivot, eyes, ears };
  }

  private buildOwl(g: THREE.Group): AnimalParts {
    const eyes: THREE.Object3D[] = [];
    const ears: THREE.Object3D[] = [];
    this.part(g, this.sphere, this.matFeather, [0, 0.55, 0], [0.42, 0.55, 0.4]);
    this.part(g, this.sphere, this.matOwlFace, [0, 0.48, 0.12], [0.3, 0.38, 0.3]);
    // Rows of pale feather scallops across the chest.
    for (let row = 0; row < 3; row++) {
      for (let i = -1; i <= 1; i++) {
        const x = i * 0.11 + (row % 2 ? 0.055 : 0);
        if (Math.abs(x) > 0.15) continue;
        this.part(
          g,
          this.sphere,
          this.matBellyOwl,
          [x, 0.4 - row * 0.1, 0.34 - row * 0.015],
          [0.065, 0.05, 0.03],
        );
      }
    }
    for (const x of [-0.17, 0.17]) {
      this.part(g, this.sphere, this.matOwlFace, [x, 0.8, 0.28], [0.17, 0.17, 0.08]);
      this.part(g, this.sphere, this.matEye, [x, 0.8, 0.33], [0.11, 0.11, 0.05]);
      this.eye(g, [x, 0.8, 0.37], 0.05, this.matPupil, eyes);
      const brow = this.part(g, this.box, this.matFeather, [x * 1.1, 0.94, 0.32], [0.17, 0.035, 0.05]);
      brow.rotation.z = x > 0 ? 0.35 : -0.35;
      const tuft = this.part(g, this.cone, this.matFeather, [x * 1.3, 1.12, 0.05], [0.1, 0.25, 0.1]);
      tuft.rotation.z = x > 0 ? -0.3 : 0.3;
      ears.push(tuft);
    }
    const beak = this.part(g, this.cone, this.matBeak, [0, 0.7, 0.4], [0.07, 0.16, 0.07]);
    beak.rotation.x = Math.PI / 2;
    const wings: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.38, 0.62, 0);
      g.add(pivot);
      this.part(pivot, this.sphere, this.matFeather, [side * 0.12, -0.12, 0], [0.12, 0.38, 0.28]);
      // Layered flight feathers fanning from the wing.
      for (let i = 0; i < 3; i++) {
        const f = this.part(
          pivot,
          this.sphere,
          this.matTail,
          [side * (0.16 + i * 0.02), -0.3 - i * 0.04, -0.06 + i * 0.07],
          [0.06, 0.2, 0.05],
        );
        f.rotation.z = side * 0.12;
      }
      wings.push(pivot);
    }
    // Feet with three talons each, and a fluffy tail fan behind.
    for (const x of [-0.12, 0.12]) {
      this.part(g, this.box, this.matBeak, [x, 0.04, 0.12], [0.1, 0.08, 0.18]);
      for (const c of [-0.035, 0, 0.035]) {
        this.part(g, this.cone, this.matClaw, [x + c, 0.03, 0.24], [0.015, 0.06, 0.015]).rotation.x =
          Math.PI / 2;
      }
    }
    const tail = this.part(g, this.sphere, this.matTail, [0, 0.2, -0.36], [0.2, 0.06, 0.2]);
    tail.rotation.x = -0.4;
    return { wings, eyes, ears };
  }

  private buildSpider(g: THREE.Group): AnimalParts {
    const eyes: THREE.Object3D[] = [];
    // Striped abdomen with the red hourglass, a head with eight eyes and two fangs.
    this.part(g, this.sphere, this.matSpider, [0, 0.38, -0.22], [0.36, 0.3, 0.42]);
    for (let i = 0; i < 3; i++) {
      this.part(
        g,
        this.sphere,
        this.matSpiderBand,
        [0, 0.38 + i * 0.015, -0.1 - i * 0.14],
        [0.37 - i * 0.04, 0.31, 0.03],
      );
    }
    this.part(g, this.sphere, this.matSpiderMark, [0, 0.55, -0.3], [0.1, 0.03, 0.14]);
    this.part(g, this.sphere, this.matSpider, [0, 0.38, 0.22], [0.24, 0.22, 0.24]);
    for (const x of [-0.09, 0.09]) {
      this.part(g, this.sphere, this.matTooth, [x, 0.46, 0.4], [0.07, 0.07, 0.05]);
      this.eye(g, [x, 0.46, 0.44], 0.03, this.matPupil, eyes);
      this.part(g, this.sphere, this.matTooth, [x * 1.55, 0.5, 0.36], [0.03, 0.03, 0.025]);
      this.part(g, this.sphere, this.matTooth, [x * 0.6, 0.53, 0.38], [0.025, 0.025, 0.02]);
      const fang = this.part(g, this.cone, this.matTooth, [x * 0.55, 0.33, 0.45], [0.025, 0.09, 0.025]);
      fang.rotation.x = Math.PI;
    }
    const legs: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.18, 0.36, -0.24 + i * 0.17);
        pivot.rotation.y = side * (0.3 - i * 0.2);
        g.add(pivot);
        const upper = this.part(
          pivot,
          this.cyl,
          this.matSpider,
          [side * 0.22, 0.08, 0],
          [0.025, 0.44, 0.025],
        );
        upper.rotation.z = side * -1.2;
        const lower = this.part(
          pivot,
          this.cyl,
          this.matSpider,
          [side * 0.46, -0.14, 0],
          [0.025, 0.3, 0.025],
        );
        lower.rotation.z = side * 0.25;
        // Knee joint ball and a pale foot tip.
        this.part(pivot, this.sphere, this.matSpiderBand, [side * 0.4, 0.04, 0], [0.04, 0.04, 0.04]);
        this.part(pivot, this.sphere, this.matTooth, [side * 0.5, -0.28, 0], [0.025, 0.025, 0.025]);
        legs.push(pivot);
      }
    }
    // Expanding web ring shown while the spider works.
    const web = new THREE.Mesh(this.webGeom, this.matWeb);
    web.rotation.x = -Math.PI / 2;
    web.position.y = 0.05;
    web.visible = false;
    g.add(web);
    return { legs, web, eyes };
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geoms.push(g);
    return g;
  }

  private mat(color: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    this.mats.push(m);
    return m;
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
