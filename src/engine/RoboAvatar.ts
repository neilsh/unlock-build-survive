/**
 * Toy robot avatar shared by Player 2 / the AI Robo-Buddy and the visible Player 1 body: rounded
 * chunky parts, glowing eyes, ear-muffs, chest lights, a backpack thruster, hands and boots. Limbs
 * hang from shoulder/hip pivots so they swing naturally; idle motion (breathing, blinking, antenna
 * pulse) is cosmetic only. Pure Three.js & headless-safe: no React or DOM imports.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export interface RoboPalette {
  body: number;
  accent: number;
  visorGlow: number;
}

const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 2, r);

type V3 = [number, number, number];

function put(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: V3,
  scale: V3 = [1, 1, 1],
  shadow = false,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}

export class RoboAvatar {
  readonly group = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly accentMat: THREE.MeshStandardMaterial;
  private readonly visorMat: THREE.MeshStandardMaterial;
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly eyes: THREE.Mesh[] = [];
  private readonly bulb: THREE.Mesh;
  private readonly thruster: THREE.Mesh;

  constructor(palette: RoboPalette) {
    this.bodyMat = this.makeMat(palette.body, 0.4, 0.25);
    this.accentMat = this.makeMat(palette.accent, 0.3, 0.3);
    this.visorMat = this.makeMat(0xfef08a, 0.2, 0.1, palette.visorGlow, 0.9);
    const darkMat = this.makeMat(0x1e293b, 0.55, 0.3);
    const metalMat = this.makeMat(0xcbd5e1, 0.3, 0.7);
    const faceMat = this.makeMat(0x0f172a, 0.25, 0.2);
    const lightG = this.makeMat(0x22c55e, 0.3, 0, 0x22c55e, 0.9);
    const lightY = this.makeMat(0xfacc15, 0.3, 0, 0xfacc15, 0.9);
    const lightR = this.makeMat(0xef4444, 0.3, 0, 0xef4444, 0.9);

    const sphere = this.trackGeo(new THREE.SphereGeometry(1, 14, 10));
    const cyl = this.trackGeo(new THREE.CylinderGeometry(1, 1, 1, 12));

    // Torso with chest panel, status lights, belly vent and belt.
    this.torso = put(
      this.group,
      this.trackGeo(rbox(0.68, 0.76, 0.44, 0.1)),
      this.bodyMat,
      [0, 0.92, 0],
      [1, 1, 1],
      true,
    );
    put(this.group, this.trackGeo(rbox(0.44, 0.26, 0.05, 0.03)), faceMat, [0, 1.04, -0.22]);
    put(this.group, sphere, lightG, [-0.12, 1.04, -0.255], [0.04, 0.04, 0.02]);
    put(this.group, sphere, lightY, [0, 1.04, -0.255], [0.04, 0.04, 0.02]);
    put(this.group, sphere, lightR, [0.12, 1.04, -0.255], [0.04, 0.04, 0.02]);
    const vent = this.trackGeo(rbox(0.3, 0.025, 0.03, 0.01));
    for (let i = 0; i < 3; i++) put(this.group, vent, darkMat, [0, 0.8 - i * 0.06, -0.225]);
    put(this.group, this.trackGeo(rbox(0.72, 0.09, 0.48, 0.03)), this.accentMat, [0, 0.58, 0]);
    put(this.group, this.trackGeo(rbox(0.12, 0.08, 0.04, 0.015)), metalMat, [0, 0.58, -0.245]);

    // Backpack with a glowing thruster nozzle.
    put(this.group, this.trackGeo(rbox(0.4, 0.5, 0.18, 0.05)), darkMat, [0, 0.95, 0.31], [1, 1, 1], true);
    this.thruster = put(this.group, cyl, this.visorMat, [0, 0.62, 0.31], [0.07, 0.06, 0.07]);

    // Head: rounded shell, dark face plate, two glowing eyes, mouth grille, ear-muffs, antenna.
    this.head = put(
      this.group,
      this.trackGeo(rbox(0.58, 0.5, 0.5, 0.12)),
      this.accentMat,
      [0, 1.58, 0],
      [1, 1, 1],
      true,
    );
    put(this.group, this.trackGeo(rbox(0.46, 0.26, 0.06, 0.04)), faceMat, [0, 1.6, -0.25]);
    for (const x of [-0.11, 0.11]) {
      this.eyes.push(put(this.group, sphere, this.visorMat, [x, 1.62, -0.285], [0.065, 0.065, 0.03]));
    }
    const tooth = this.trackGeo(rbox(0.04, 0.03, 0.03, 0.01));
    for (let i = -1; i <= 1; i++) put(this.group, tooth, metalMat, [i * 0.07, 1.46, -0.255]);
    for (const x of [-0.31, 0.31]) {
      const muff = put(this.group, cyl, metalMat, [x, 1.58, 0], [0.1, 0.05, 0.1]);
      muff.rotation.z = Math.PI / 2;
      put(this.group, sphere, this.accentMat, [x * 1.07, 1.58, 0], [0.04, 0.09, 0.09]);
    }
    put(this.group, cyl, darkMat, [0, 1.92, 0], [0.025, 0.14, 0.025]);
    this.bulb = put(this.group, sphere, this.visorMat, [0, 2.08, 0], [0.08, 0.08, 0.08]);

    // Arms: shoulder ball, upper arm, cuff and a round hand, all hanging from the pivot.
    const upperArm = this.trackGeo(rbox(0.19, 0.32, 0.2, 0.06));
    const cuff = this.trackGeo(rbox(0.21, 0.07, 0.22, 0.03));
    for (const [arm, side] of [
      [this.leftArm, -1],
      [this.rightArm, 1],
    ] as const) {
      arm.position.set(side * 0.46, 1.2, 0);
      put(arm, sphere, metalMat, [0, 0, 0], [0.12, 0.12, 0.12], true);
      put(arm, upperArm, this.accentMat, [0, -0.2, 0], [1, 1, 1], true);
      put(arm, cuff, darkMat, [0, -0.38, 0]);
      put(arm, sphere, metalMat, [0, -0.5, 0], [0.11, 0.11, 0.11], true);
      this.group.add(arm);
    }
    // Legs: hip pivot, thigh, knee ball, and a boot.
    const thigh = this.trackGeo(rbox(0.2, 0.34, 0.22, 0.06));
    const boot = this.trackGeo(rbox(0.24, 0.12, 0.34, 0.05));
    for (const [leg, side] of [
      [this.leftLeg, -1],
      [this.rightLeg, 1],
    ] as const) {
      leg.position.set(side * 0.18, 0.54, 0);
      put(leg, thigh, darkMat, [0, -0.18, 0], [1, 1, 1], true);
      put(leg, sphere, metalMat, [0, -0.36, 0], [0.09, 0.09, 0.09]);
      put(leg, boot, this.accentMat, [0, -0.46, -0.04], [1, 1, 1], true);
      this.group.add(leg);
    }
    this.group.visible = false;
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private makeMat(
    color: number,
    roughness: number,
    metalness: number,
    emissive = 0x000000,
    emissiveIntensity = 0,
  ): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });
    this.materials.push(m);
    return m;
  }

  setPalette(palette: RoboPalette): void {
    this.bodyMat.color.setHex(palette.body);
    this.accentMat.color.setHex(palette.accent);
    this.visorMat.emissive.setHex(palette.visorGlow);
  }

  /** Assigns the avatar's meshes to a render layer (used to hide a body from its owner's camera). */
  setLayer(layer: number): void {
    this.group.traverse((o) => o.layers.set(layer));
  }

  /**
   * Swings limbs; `swing` is the arm/leg rotation in radians. `time` (seconds, any clock) drives the
   * cosmetic idle motion: breathing, an occasional blink, a pulsing antenna and thruster glow.
   */
  setSwing(swing: number, time: number = performance.now() / 1000): void {
    this.leftArm.rotation.x = swing;
    this.rightArm.rotation.x = -swing;
    this.leftLeg.rotation.x = -swing;
    this.rightLeg.rotation.x = swing;
    const breath = Math.sin(time * 2.2);
    this.torso.scale.y = 1 + breath * 0.012;
    this.head.position.y = 1.58 + breath * 0.008;
    this.head.rotation.y = Math.sin(time * 0.7) * 0.05;
    const blink = (time * 0.35) % 1 > 0.96 ? 0.1 : 1;
    for (const e of this.eyes) e.scale.y = 0.065 * blink;
    const pulse = 0.65 + 0.35 * Math.sin(time * 5);
    this.bulb.scale.setScalar(0.08 * (0.9 + pulse * 0.2));
    this.thruster.scale.y = 0.06 * (0.8 + pulse * 0.4);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
