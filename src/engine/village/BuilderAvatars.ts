/**
 * three.js models for the Village Explore Mode builder crew: little procedural construction workers
 * with a yellow hard hat, orange vest and a hammer that swings while they build. No external assets.
 */
import * as THREE from 'three';
import type { Builder } from './BuilderCrew';

/** What the controller needs from the renderer; tests substitute a plain recorder. */
export interface BuilderView {
  sync(builders: readonly Builder[], time: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const SKINS = [0xffd7b0, 0xe0ac69, 0xc68642, 0xf1c27d];

interface Figure {
  group: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  arms: [THREE.Group, THREE.Group];
  legs: [THREE.Group, THREE.Group];
}

export class BuilderAvatars implements BuilderView {
  private readonly root = new THREE.Group();
  private readonly figures: Figure[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly bodyGeo = this.trackGeo(new THREE.CylinderGeometry(0.27, 0.34, 0.54, 12));
  private readonly headGeo = this.trackGeo(new THREE.SphereGeometry(0.26, 14, 12));
  private readonly sphere = this.trackGeo(new THREE.SphereGeometry(1, 10, 8));
  private readonly limbGeo = this.trackGeo(new THREE.CylinderGeometry(0.075, 0.065, 0.3, 8));
  private readonly domeGeo = this.trackGeo(
    new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  );
  private readonly brimGeo = this.trackGeo(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 14));
  private readonly stripeGeo = this.trackGeo(new THREE.CylinderGeometry(0.345, 0.345, 0.08, 12));
  private readonly handleGeo = this.trackGeo(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 6));
  private readonly hammerHeadGeo = this.trackGeo(new THREE.BoxGeometry(0.2, 0.1, 0.1));
  private readonly hatMat = this.track(new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 }));
  private readonly vestMat = this.track(new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.8 }));
  private readonly stripeMat = this.track(
    new THREE.MeshStandardMaterial({ color: 0xfef9c3, roughness: 0.5, emissive: 0x4d4d33 }),
  );
  private readonly pantsMat = this.track(
    new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.85 }),
  );
  private readonly shoeMat = this.track(new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.7 }));
  private readonly eyeMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.3 }));
  private readonly woodMat = this.track(new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.8 }));
  private readonly steelMat = this.track(
    new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.3, metalness: 0.7 }),
  );

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
    const skin = this.track(
      new THREE.MeshStandardMaterial({ color: SKINS[index % SKINS.length], roughness: 0.7 }),
    );
    this.add(body, this.bodyGeo, this.vestMat, [0, 0.58, 0]);
    this.add(body, this.stripeGeo, this.stripeMat, [0, 0.62, 0]);
    const arms: THREE.Group[] = [];
    const legs: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.35, 0.78, 0);
      this.add(arm, this.limbGeo, this.vestMat, [0, -0.13, 0]);
      this.add(arm, this.sphere, skin, [0, -0.3, 0], [0.08, 0.08, 0.08]);
      if (side === 1) {
        // Hammer in the right hand: wooden handle with a steel head.
        const hammer = new THREE.Group();
        hammer.position.set(0, -0.3, 0.06);
        hammer.rotation.x = Math.PI / 2;
        this.add(hammer, this.handleGeo, this.woodMat, [0, 0.18, 0]);
        this.add(hammer, this.hammerHeadGeo, this.steelMat, [0, 0.38, 0]);
        arm.add(hammer);
      }
      body.add(arm);
      arms.push(arm);
      const leg = new THREE.Group();
      leg.position.set(side * 0.13, 0.33, 0);
      this.add(leg, this.limbGeo, this.pantsMat, [0, -0.14, 0]);
      this.add(leg, this.sphere, this.shoeMat, [0, -0.29, 0.04], [0.1, 0.07, 0.15]);
      body.add(leg);
      legs.push(leg);
    }
    const head = new THREE.Group();
    head.position.y = 0.98;
    this.add(head, this.headGeo, skin, [0, 0, 0]);
    for (const x of [-0.09, 0.09])
      this.add(head, this.sphere, this.eyeMat, [x, 0.03, 0.235], [0.035, 0.045, 0.03]);
    // Hard hat: dome, brim sticking out front, and a ridge on top.
    this.add(head, this.domeGeo, this.hatMat, [0, 0.08, 0]);
    this.add(head, this.brimGeo, this.hatMat, [0, 0.1, 0.1], [0.8, 1, 0.9]);
    this.add(head, this.sphere, this.hatMat, [0, 0.37, 0], [0.06, 0.04, 0.2]);
    body.add(head);
    group.add(body);
    this.root.add(group);
    return { group, body, head, arms: [arms[0], arms[1]], legs: [legs[0], legs[1]] };
  }

  sync(builders: readonly Builder[], time: number): void {
    while (this.figures.length < builders.length) this.figures.push(this.makeFigure(this.figures.length));
    this.figures.forEach((fig, i) => {
      const b = builders[i];
      fig.group.visible = b !== undefined;
      if (!b) return;
      fig.group.position.set(b.x, 0, b.z);
      fig.group.rotation.y = b.heading;
      const walking = b.state === 'walk';
      const building = b.state === 'build';
      fig.body.position.y = walking ? Math.abs(Math.sin(time * 9 + i)) * 0.12 : 0;
      const swing = walking ? Math.sin(time * 9 + i) * 0.55 : 0;
      fig.legs[0].rotation.x = -swing;
      fig.legs[1].rotation.x = swing;
      fig.arms[0].rotation.x = swing;
      // Hammering: the right arm raises and slams down; the body bobs with each hit.
      const hit = Math.sin(time * 10 + i * 1.7);
      fig.arms[1].rotation.x = building ? -1.5 + hit * 0.9 : -swing;
      fig.body.rotation.x = building ? 0.12 + Math.max(0, -hit) * 0.1 : 0;
      fig.head.rotation.y = walking || building ? 0 : Math.sin(time * 0.6 + i * 2) * 0.35;
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
