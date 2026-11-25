/**
 * Blocky robot avatar model shared by Player 2 / the AI Robo-Buddy and the visible Player 1 body.
 * Pure Three.js & headless-safe: no React or DOM imports.
 */
import * as THREE from 'three';

export interface RoboPalette {
  body: number;
  accent: number;
  visorGlow: number;
}

export class RoboAvatar {
  readonly group = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly accentMat: THREE.MeshStandardMaterial;
  private readonly visorMat: THREE.MeshStandardMaterial;
  private readonly leftArm: THREE.Mesh;
  private readonly rightArm: THREE.Mesh;
  private readonly leftLeg: THREE.Mesh;
  private readonly rightLeg: THREE.Mesh;

  constructor(palette: RoboPalette) {
    this.bodyMat = this.makeMat(palette.body, 0.35, 0.2);
    this.accentMat = this.makeMat(palette.accent, 0.25, 0.3);
    this.visorMat = this.makeMat(0xfef08a, 0.2, 0.1, palette.visorGlow, 0.7);
    const darkMat = this.makeMat(0x1e293b, 0.6, 0.1);

    const torsoGeo = this.trackGeo(new THREE.BoxGeometry(0.68, 0.76, 0.44));
    const headGeo = this.trackGeo(new THREE.BoxGeometry(0.56, 0.48, 0.48));
    const visorGeo = this.trackGeo(new THREE.BoxGeometry(0.42, 0.18, 0.08));
    const antGeo = this.trackGeo(new THREE.CylinderGeometry(0.03, 0.04, 0.26, 8));
    const bulbGeo = this.trackGeo(new THREE.SphereGeometry(0.08, 10, 10));
    const limbGeo = this.trackGeo(new THREE.BoxGeometry(0.2, 0.52, 0.22));

    const torso = new THREE.Mesh(torsoGeo, this.bodyMat);
    torso.position.y = 0.9;
    torso.castShadow = true;

    const head = new THREE.Mesh(headGeo, this.accentMat);
    head.position.y = 1.56;
    head.castShadow = true;

    const visor = new THREE.Mesh(visorGeo, this.visorMat);
    visor.position.set(0, 1.58, -0.23);

    const antenna = new THREE.Mesh(antGeo, darkMat);
    antenna.position.set(0, 1.92, 0);

    const bulb = new THREE.Mesh(bulbGeo, this.visorMat);
    bulb.position.set(0, 2.07, 0);

    this.leftArm = new THREE.Mesh(limbGeo, this.accentMat);
    this.leftArm.position.set(-0.46, 0.9, 0);
    this.leftArm.castShadow = true;

    this.rightArm = new THREE.Mesh(limbGeo, this.accentMat);
    this.rightArm.position.set(0.46, 0.9, 0);
    this.rightArm.castShadow = true;

    this.leftLeg = new THREE.Mesh(limbGeo, darkMat);
    this.leftLeg.position.set(-0.18, 0.26, 0);
    this.leftLeg.castShadow = true;

    this.rightLeg = new THREE.Mesh(limbGeo, darkMat);
    this.rightLeg.position.set(0.18, 0.26, 0);
    this.rightLeg.castShadow = true;

    this.group.add(
      torso,
      head,
      visor,
      antenna,
      bulb,
      this.leftArm,
      this.rightArm,
      this.leftLeg,
      this.rightLeg,
    );
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

  /** Swings limbs; `swing` is the arm/leg rotation in radians. */
  setSwing(swing: number): void {
    this.leftArm.rotation.x = swing;
    this.rightArm.rotation.x = -swing;
    this.leftLeg.rotation.x = -swing;
    this.rightLeg.rotation.x = swing;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
