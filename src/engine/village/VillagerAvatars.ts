/**
 * three.js models for Village Island villagers: a little procedural toy figure per villager (body,
 * head, hat) plus a billboard HP bar that only shows when a player is close. No external assets.
 */
import * as THREE from 'three';
import type { Vec3 } from '../../types/blueprint';
import { HP_BAR_RANGE } from '../../levels/village';
import type { Villager } from './VillageSim';

/** What the controller needs from the renderer; tests substitute a plain recorder. */
export interface VillagerView {
  sync(villagers: readonly Villager[], viewers: readonly Vec3[], time: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const SHIRTS = [0xef4444, 0x3b82f6, 0xf59e0b, 0x10b981, 0xa855f7, 0xec4899, 0x14b8a6, 0xf97316];
const SKINS = [0xffd7b0, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524];
const HAIRS = [0x3e2723, 0x6d4c41, 0xf9a825, 0x212121, 0xbf360c];
const PANTS = [0x374151, 0x1e3a8a, 0x4e342e, 0x14532d];
const BAR_W = 1.1;
const BAR_H = 0.14;

/** True when any viewer stands within `range` of the villager (horizontal + height, world units). */
export function isNearAnyViewer(
  v: Pick<Villager, 'x' | 'z'>,
  viewers: readonly Vec3[],
  range = HP_BAR_RANGE,
) {
  return viewers.some((p) => Math.hypot(p[0] - v.x, p[2] - v.z) <= range);
}

/** HP bar colour: green when healthy, amber when hurt, red when nearly out. */
export function hpColor(fraction: number): number {
  return fraction > 0.6 ? 0x22c55e : fraction > 0.3 ? 0xf59e0b : 0xef4444;
}

interface Figure {
  group: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  arms: [THREE.Group, THREE.Group];
  legs: [THREE.Group, THREE.Group];
  eyes: THREE.Mesh[];
  barRoot: THREE.Group;
  fill: THREE.Sprite;
  fillMat: THREE.SpriteMaterial;
}

export class VillagerAvatars implements VillagerView {
  private readonly root = new THREE.Group();
  private readonly figures: Figure[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly skin = this.track(new THREE.MeshStandardMaterial({ color: 0xffd7b0, roughness: 0.7 }));
  private readonly bodyGeo = this.trackGeo(new THREE.CylinderGeometry(0.26, 0.33, 0.52, 12));
  private readonly headGeo = this.trackGeo(new THREE.SphereGeometry(0.26, 14, 12));
  private readonly hatGeo = this.trackGeo(new THREE.ConeGeometry(0.3, 0.3, 10));
  private readonly sphere = this.trackGeo(new THREE.SphereGeometry(1, 10, 8));
  private readonly limbGeo = this.trackGeo(new THREE.CylinderGeometry(0.075, 0.065, 0.3, 8));
  private readonly beltGeo = this.trackGeo(new THREE.CylinderGeometry(0.335, 0.335, 0.07, 12));
  private readonly brimGeo = this.trackGeo(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 14));
  private readonly capGeo = this.trackGeo(
    new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  );
  private readonly eyeMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.3 }));
  private readonly cheekMat = this.track(new THREE.MeshStandardMaterial({ color: 0xff8a80, roughness: 0.8 }));
  private readonly shoeMat = this.track(new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.7 }));
  private readonly beltMat = this.track(new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.6 }));
  private readonly buckleMat = this.track(
    new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.3, metalness: 0.6 }),
  );
  private readonly barBg = this.track(new THREE.SpriteMaterial({ color: 0x111827, depthTest: false }));

  constructor(private readonly scene: THREE.Scene) {
    this.root.visible = false;
    this.scene.add(this.root);
  }

  private track<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private add(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    scale: [number, number, number] = [1, 1, 1],
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.scale.set(...scale);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  private makeFigure(index: number): Figure {
    const group = new THREE.Group();
    const body = new THREE.Group();
    const shirt = this.track(
      new THREE.MeshStandardMaterial({ color: SHIRTS[index % SHIRTS.length], roughness: 0.8 }),
    );
    const skin =
      index === 0
        ? this.skin
        : this.track(new THREE.MeshStandardMaterial({ color: SKINS[index % SKINS.length], roughness: 0.7 }));
    const hair = this.track(
      new THREE.MeshStandardMaterial({ color: HAIRS[(index * 3) % HAIRS.length], roughness: 0.9 }),
    );
    const pants = this.track(
      new THREE.MeshStandardMaterial({ color: PANTS[index % PANTS.length], roughness: 0.85 }),
    );

    // Torso, belt with a brass buckle, and a little satchel strap.
    this.add(body, this.bodyGeo, shirt, [0, 0.58, 0]);
    this.add(body, this.beltGeo, this.beltMat, [0, 0.36, 0]);
    this.add(body, this.sphere, this.buckleMat, [0, 0.36, 0.33], [0.05, 0.05, 0.025]);
    // Arms and legs hang from pivots so they can swing while walking.
    const arms: THREE.Group[] = [];
    const legs: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.34, 0.76, 0);
      this.add(arm, this.limbGeo, shirt, [0, -0.13, 0]);
      this.add(arm, this.sphere, skin, [0, -0.3, 0], [0.08, 0.08, 0.08]);
      body.add(arm);
      arms.push(arm);
      const leg = new THREE.Group();
      leg.position.set(side * 0.13, 0.33, 0);
      this.add(leg, this.limbGeo, pants, [0, -0.14, 0]);
      this.add(leg, this.sphere, this.shoeMat, [0, -0.29, 0.04], [0.1, 0.07, 0.15]);
      body.add(leg);
      legs.push(leg);
    }

    // Head: face (eyes, cheeks, nose) toward +Z, with hair or a hat depending on the villager.
    const head = new THREE.Group();
    head.position.y = 0.97;
    this.add(head, this.headGeo, skin, [0, 0, 0]);
    const eyes: THREE.Mesh[] = [];
    for (const x of [-0.09, 0.09]) {
      eyes.push(this.add(head, this.sphere, this.eyeMat, [x, 0.03, 0.235], [0.035, 0.045, 0.03]));
      this.add(head, this.sphere, this.cheekMat, [x * 1.6, -0.07, 0.21], [0.05, 0.035, 0.02]);
    }
    this.add(head, this.sphere, skin, [0, -0.02, 0.265], [0.04, 0.04, 0.04]);
    const style = index % 4;
    if (style === 0) {
      this.add(head, this.hatGeo, shirt, [0, 0.31, 0]);
      this.add(head, this.sphere, hair, [0, 0.03, -0.19], [0.24, 0.2, 0.12]);
    } else if (style === 1) {
      this.add(head, this.capGeo, shirt, [0, 0.07, 0]);
      this.add(head, this.brimGeo, shirt, [0, 0.09, 0.14], [0.7, 1, 0.75]);
    } else if (style === 2) {
      this.add(head, this.sphere, hair, [0, 0.1, -0.02], [0.28, 0.2, 0.27]);
      this.add(head, this.sphere, hair, [0, 0.3, 0], [0.1, 0.1, 0.1]);
    } else {
      this.add(head, this.capGeo, hair, [0, 0.04, -0.02]);
      this.add(head, this.sphere, shirt, [0, 0.31, 0], [0.09, 0.09, 0.09]);
      this.add(head, this.brimGeo, shirt, [0, 0.12, 0], [1.02, 2.2, 1.02]);
    }
    body.add(head);
    group.add(body);

    const barRoot = new THREE.Group();
    barRoot.position.y = 1.75;
    const bg = new THREE.Sprite(this.barBg);
    bg.scale.set(BAR_W + 0.08, BAR_H + 0.06, 1);
    bg.renderOrder = 10;
    const fillMat = this.track(new THREE.SpriteMaterial({ color: 0x22c55e, depthTest: false }));
    const fill = new THREE.Sprite(fillMat);
    fill.center.set(0, 0.5);
    fill.position.x = -BAR_W / 2;
    fill.scale.set(BAR_W, BAR_H, 1);
    fill.renderOrder = 11;
    barRoot.add(bg, fill);
    barRoot.visible = false;
    group.add(barRoot);
    this.root.add(group);
    return {
      group,
      body,
      head,
      arms: [arms[0], arms[1]],
      legs: [legs[0], legs[1]],
      eyes,
      barRoot,
      fill,
      fillMat,
    };
  }

  sync(villagers: readonly Villager[], viewers: readonly Vec3[], time: number): void {
    while (this.figures.length < villagers.length) this.figures.push(this.makeFigure(this.figures.length));
    this.figures.forEach((fig, i) => {
      const v = villagers[i];
      fig.group.visible = v !== undefined;
      if (!v) return;
      fig.body.visible = v.state !== 'sheltered';
      fig.group.position.set(v.x, 0, v.z);
      fig.group.rotation.y = v.heading;
      const moving = v.state === 'walk' || v.state === 'run';
      const rate = v.state === 'run' ? 16 : 9;
      fig.body.position.y = moving ? Math.abs(Math.sin(time * rate + i)) * 0.12 : 0;
      // Walk cycle: opposite arm/leg swing. Idle: slow breathing, head glances, and the odd blink.
      const swing = moving ? Math.sin(time * rate + i) * (v.state === 'run' ? 0.9 : 0.55) : 0;
      fig.arms[0].rotation.x = swing + (moving ? 0 : Math.sin(time * 1.8 + i) * 0.03);
      fig.arms[1].rotation.x = -swing - (moving ? 0 : Math.sin(time * 1.8 + i) * 0.03);
      fig.legs[0].rotation.x = -swing;
      fig.legs[1].rotation.x = swing;
      fig.head.rotation.y = moving ? 0 : Math.sin(time * 0.6 + i * 2) * 0.35;
      fig.head.position.y = 0.97 + (moving ? 0 : Math.sin(time * 2 + i) * 0.006);
      const blink = (time * 0.3 + i * 0.37) % 1 > 0.95 ? 0.1 : 1;
      for (const e of fig.eyes) e.scale.y = 0.045 * blink;
      fig.body.rotation.x = v.state === 'down' ? -Math.PI / 2 : 0;
      fig.body.position.z = v.state === 'down' ? 0.3 : 0;
      const fraction = v.maxHp > 0 ? v.hp / v.maxHp : 0;
      // The bar ignores depth, so it shows even for a villager tucked inside a house.
      fig.barRoot.visible = isNearAnyViewer(v, viewers);
      fig.fill.scale.x = Math.max(0.001, BAR_W * fraction);
      fig.fillMat.color.setHex(hpColor(fraction));
    });
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
