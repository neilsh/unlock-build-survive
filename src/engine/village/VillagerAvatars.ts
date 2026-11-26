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
  private readonly bodyGeo = this.trackGeo(new THREE.CylinderGeometry(0.28, 0.36, 0.7, 10));
  private readonly headGeo = this.trackGeo(new THREE.SphereGeometry(0.26, 12, 10));
  private readonly hatGeo = this.trackGeo(new THREE.ConeGeometry(0.3, 0.3, 10));
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

  private makeFigure(index: number): Figure {
    const group = new THREE.Group();
    const body = new THREE.Group();
    const shirt = this.track(
      new THREE.MeshStandardMaterial({ color: SHIRTS[index % SHIRTS.length], roughness: 0.8 }),
    );
    const torso = new THREE.Mesh(this.bodyGeo, shirt);
    torso.position.y = 0.35;
    const head = new THREE.Mesh(this.headGeo, this.skin);
    head.position.y = 0.95;
    const hat = new THREE.Mesh(this.hatGeo, shirt);
    hat.position.y = 1.28;
    for (const m of [torso, head, hat]) m.castShadow = true;
    body.add(torso, head, hat);
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
    return { group, body, barRoot, fill, fillMat };
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
      fig.body.position.y = moving ? Math.abs(Math.sin(time * (v.state === 'run' ? 16 : 9) + i)) * 0.12 : 0;
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
