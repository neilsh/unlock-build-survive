/**
 * OWNER: package B (renderer, island, lights, camera). Contract below is fixed; internals are yours.
 * Frame loop: SceneManager owns requestAnimationFrame and calls registered callbacks with the raw
 * frame delta in seconds. It must dispose all WebGL resources in `dispose()`.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Azimuth, DisasterType, ProjectileKind, Vec3 } from '../types/blueprint';
import { ISLAND_SIZE } from '../types/blueprint';
import { mulberry32 } from '../utils/rng';
import { DisasterEffects, type CustomDisasterFx } from './Effects';

// Low enough that the bottom HUD bar does not cover the island's front edge.
const TARGET = new THREE.Vector3(0, 1.5, 0);
const DEFAULT_POLAR = THREE.MathUtils.degToRad(58);
const DEFAULT_RADIUS = 34;
const TWEEN_SECONDS = 0.7;
const MAX_FRAME_DT = 0.1;
const WATER_SEGMENTS = 40;
const WATER_SIZE = 90;
const WATER_HIDDEN_BELOW = -1;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function grassTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas context unavailable');
  g.fillStyle = '#7ed957';
  g.fillRect(0, 0, size, size);
  const r = mulberry32(7);
  for (let i = 0; i < 1400; i++) {
    const light = r() > 0.5;
    g.fillStyle = light ? 'rgba(190,255,120,0.35)' : 'rgba(60,150,60,0.3)';
    g.fillRect(r() * size, r() * size, 2 + r() * 3, 2 + r() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // ExtrudeGeometry UVs are in world units, so this is one 8x8-unit tile per repeat.
  t.repeat.set(1 / 8, 1 / 8);
  t.anisotropy = 4;
  return t;
}

function roundedRect(w: number, r: number): THREE.Shape {
  const h = w / 2;
  const s = new THREE.Shape();
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r);
  s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r);
  s.quadraticCurveTo(-h, -h, -h + r, -h);
  return s;
}

interface Tween {
  from: number;
  to: number;
  t: number;
}

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  /** Player 2's camera, rendered into the right half of the canvas while split-screen is on. */
  readonly camera2 = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  /** Parent group for blocks and struts, so everything can be cleared in one place. */
  readonly buildRoot = new THREE.Group();
  /** Flat top face of the island (y = 0). Raycast against this for placing on the ground. */
  readonly islandTop = new THREE.Mesh(
    new THREE.PlaneGeometry(ISLAND_SIZE, ISLAND_SIZE).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  readonly domElement: HTMLCanvasElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly callbacks = new Set<(dt: number) => void>();
  private readonly clouds: THREE.Mesh[] = [];
  private readonly water: THREE.Mesh;
  private readonly waterBase: Float32Array;
  private readonly effects: DisasterEffects;
  private readonly timer = new THREE.Timer();
  private rafId = 0;
  private time = 0;
  private tween: Tween | null = null;
  private orbitMode = true;
  private readonly savedOrbitPos = new THREE.Vector3();
  private readonly savedOrbitTarget = new THREE.Vector3();
  private disposed = false;
  private splitScreen = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.domElement = document.createElement('canvas');
    this.domElement.style.display = 'block';
    this.domElement.style.width = '100%';
    this.domElement.style.height = '100%';
    this.domElement.style.touchAction = 'none';
    container.appendChild(this.domElement);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.domElement, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap was removed in recent three; PCF honours shadow.radius for soft edges.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    const background = new THREE.Color('#9bdcff');
    const fog = new THREE.Fog('#c9ecff', 70, 150);
    this.scene.background = background;
    this.scene.fog = fog;
    this.scene.add(this.buildRoot, this.islandTop);

    this.buildLights();
    this.buildIsland();
    this.buildClouds();
    this.water = this.buildWater();
    this.waterBase = Float32Array.from(this.water.geometry.attributes.position.array);
    this.effects = new DisasterEffects(this.scene, { background, fog });

    this.camera.position
      .set(0, 0, DEFAULT_RADIUS)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), -(Math.PI / 2 - DEFAULT_POLAR));
    this.camera.position.add(TARGET);
    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.target.copy(TARGET);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 55;
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(15);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(85);
    this.controls.update();
    this.savedOrbitPos.copy(this.camera.position);
    this.savedOrbitTarget.copy(this.controls.target);
    // A drag by the player wins over a preset tween in progress.
    this.controls.addEventListener('start', this.cancelTween);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.timer.connect(document);
    this.rafId = requestAnimationFrame(this.loop);
  }

  /** Register a per-frame callback. Returns an unsubscribe function. */
  onFrame(cb: (dtSeconds: number) => void): () => void {
    this.callbacks.add(cb);
    return () => {
      this.callbacks.delete(cb);
    };
  }

  /** Smoothly tween the camera azimuth around the island centre (see `Azimuth` for directions). */
  setAzimuth(degrees: Azimuth): void {
    const to = THREE.MathUtils.degToRad(degrees);
    const from = this.controls.getAzimuthalAngle();
    // Shortest way round, so 270 -> 0 goes forward rather than spinning back through 180.
    let delta = (to - from) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    this.tween = { from, to: from + delta, t: 0 };
  }

  /** Enable/disable OrbitControls (disabled while the player drags a brace, or in First-Person). */
  setControlsEnabled(enabled: boolean): void {
    this.controls.enabled = this.orbitMode && enabled;
  }

  /** Orbits and zooms the camera around the island target by spherical deltas (used by gamepad). */
  orbitBy(deltaAzimuth: number, deltaPolar: number, deltaDistance = 0): void {
    if (!this.orbitMode || !this.controls.enabled) return;
    this.cancelTween();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta += deltaAzimuth;
    sph.phi = Math.max(
      this.controls.minPolarAngle,
      Math.min(this.controls.maxPolarAngle, sph.phi + deltaPolar),
    );
    sph.radius = Math.max(
      this.controls.minDistance,
      Math.min(this.controls.maxDistance, sph.radius + deltaDistance),
    );
    this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(sph));
    this.controls.update();
  }

  /** Switches between Orbit camera (true) and First-Person camera (false). */
  setOrbitMode(on: boolean): void {
    if (this.orbitMode === on) return;
    this.orbitMode = on;
    if (!on) {
      this.savedOrbitPos.copy(this.camera.position);
      this.savedOrbitTarget.copy(this.controls.target);
      this.cancelTween();
      this.controls.enabled = false;
    } else {
      this.camera.position.copy(this.savedOrbitPos);
      this.controls.target.copy(this.savedOrbitTarget);
      this.camera.rotation.order = 'XYZ';
      this.controls.enabled = true;
      this.controls.update();
    }
  }

  /**
   * Per-frame disaster visuals: quake shake and dust, wind streaks and leaves, flood splashes, hail
   * puffs and a gentle sky tint. Called every physics step with `intensity` 0..1, and with 0 when the
   * run ends or is rewound (0 means off: all effects are removed at once). As a safety net the effects
   * also switch themselves off shortly after the calls stop. Honours `prefers-reduced-motion`.
   */
  setDisasterFx(disaster: DisasterType, intensity: number, customMeta?: CustomDisasterFx): void {
    this.effects.setDisaster(disaster, intensity, customMeta);
  }

  /** A hail stone hit the ground or a building at this world point (bottom of the stone). */
  hailImpact(x: number, y: number, z: number): void {
    this.effects.hailImpact(x, y, z);
  }

  /** Any disaster projectile hit the ground or a building at this world point. */
  projectileImpact(kind: ProjectileKind, x: number, y: number, z: number): void {
    this.effects.projectileImpact(kind, x, y, z);
  }

  /** Flashes a glowing laser beam from `from` to `to`. */
  laserBeam(from: Vec3, to: Vec3): void {
    this.effects.laserBeam(from, to);
  }

  /** Level of the animated flood plane (world y). Hidden when below -1. */
  setWaterLevel(y: number): void {
    this.effects.setWaterLevel(y);
    this.water.visible = y >= WATER_HIDDEN_BELOW;
    this.water.position.y = y;
  }

  /** World position the ground-anchored kinematic body should be seeded from (island centre). */
  islandCenter(): Vec3 {
    return [0, 0, 0];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.callbacks.clear();
    this.controls.removeEventListener('start', this.cancelTween);
    this.controls.dispose();
    this.timer.dispose();
    this.effects.dispose();

    const textures = new Set<THREE.Texture>();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Light) obj.dispose(); // frees shadow map render targets
      if (!(obj instanceof THREE.Mesh)) return;
      const mesh: THREE.Mesh = obj;
      geometries.add(mesh.geometry);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        materials.add(m);
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());

    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.domElement.remove();
  }

  // ---------------------------------------------------------------- frame loop

  private readonly cancelTween = () => {
    this.tween = null;
  };

  private readonly loop = (timestamp: number) => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), MAX_FRAME_DT);
    this.time += dt;

    if (this.orbitMode) {
      this.stepTween(dt);
      this.controls.update();
    }
    this.animateScenery(dt);
    this.effects.update(dt);

    for (const cb of this.callbacks) cb(dt);
    // Shake is a render-only offset so OrbitControls never sees it.
    const shake = this.effects.shakeOffset;
    this.camera.position.add(shake);
    if (this.splitScreen) {
      const size = this.renderer.getSize(new THREE.Vector2());
      const half = Math.floor(size.x / 2);
      this.renderer.setScissorTest(true);
      this.renderViewport(this.camera, 0, half, size.y);
      this.camera2.position.add(shake);
      this.renderViewport(this.camera2, half, size.x - half, size.y);
      this.camera2.position.sub(shake);
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, size.x, size.y);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.camera.position.sub(shake);
  };

  private renderViewport(cam: THREE.PerspectiveCamera, x: number, w: number, h: number): void {
    this.renderer.setViewport(x, 0, w, h);
    this.renderer.setScissor(x, 0, w, h);
    this.renderer.render(this.scene, cam);
  }

  private stepTween(dt: number): void {
    const tw = this.tween;
    if (!tw) return;
    tw.t = Math.min(1, tw.t + dt / TWEEN_SECONDS);
    const angle = tw.from + (tw.to - tw.from) * easeInOut(tw.t);
    const offset = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta = angle;
    this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(sph));
    this.camera.lookAt(this.controls.target);
    if (tw.t >= 1) this.tween = null;
  }

  private animateScenery(dt: number): void {
    for (const c of this.clouds) {
      c.position.x += dt * (0.4 + c.scale.x * 0.05);
      if (c.position.x > 70) c.position.x = -70;
    }
    if (this.water.visible) {
      const pos = this.water.geometry.attributes.position;
      const base = this.waterBase;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const z = base[i * 3 + 2];
        pos.setY(i, Math.sin(x * 0.35 + this.time * 2.2) * 0.12 + Math.cos(z * 0.3 + this.time * 1.7) * 0.1);
      }
      pos.needsUpdate = true;
      this.water.geometry.computeVertexNormals();
    }
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.updateAspects();
  }

  private updateAspects(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const aspect = (this.splitScreen ? w / 2 : w) / h;
    for (const cam of [this.camera, this.camera2]) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
  }

  /** Splits the canvas into two side-by-side views: `camera` (Player 1, left) and `camera2` (right). */
  setSplitScreen(on: boolean): void {
    if (this.splitScreen === on) return;
    this.splitScreen = on;
    this.updateAspects();
  }

  isSplitScreen(): boolean {
    return this.splitScreen;
  }

  /** Points Player 2's camera at `target` from `eye` (world space). */
  setSecondaryView(eye: Vec3, target: Vec3): void {
    this.camera2.position.set(eye[0], eye[1], eye[2]);
    this.camera2.lookAt(target[0], target[1], target[2]);
  }

  // ---------------------------------------------------------------- scenery

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#9ad07a', 1.1));
    const sun = new THREE.DirectionalLight('#fff4d6', 2.4);
    sun.position.set(14, 26, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const half = ISLAND_SIZE * 0.9;
    Object.assign(sun.shadow.camera, {
      left: -half,
      right: half,
      top: half,
      bottom: -half,
      near: 1,
      far: 70,
    });
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
  }

  private buildIsland(): void {
    const w = ISLAND_SIZE + 3;
    // Grass slab: rounded square, top face at y = 0.
    const slab = new THREE.Mesh(
      new THREE.ExtrudeGeometry(roundedRect(w, 2.5), {
        depth: 0.9,
        bevelEnabled: true,
        bevelThickness: 0.25,
        bevelSize: 0.25,
        bevelSegments: 3,
        curveSegments: 8,
      }),
      new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.95 }),
    );
    slab.rotation.x = -Math.PI / 2;
    // Extrude spans z in [-0.25, depth + 0.25] (bevel included); after rotation that is +y, so lift down by the top.
    slab.position.y = -(0.9 + 0.25);
    slab.receiveShadow = true;

    // Dirt underside: inverted low-poly cone.
    const dirt = new THREE.Mesh(
      new THREE.ConeGeometry(w * 0.62, 9, 7, 1),
      new THREE.MeshStandardMaterial({ color: '#8b5a3c', roughness: 1, flatShading: true }),
    );
    dirt.rotation.x = Math.PI;
    dirt.rotation.y = 0.4;
    dirt.position.y = -1.15 - 4.5;
    dirt.castShadow = true;

    const r = mulberry32(42);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.9, flatShading: true });
    const rocks = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + r() * 0.35, 0), rockMat);
      const a = r() * Math.PI * 2;
      const d = ISLAND_SIZE / 2 + 0.2 + r() * 0.8;
      rock.position.set(Math.cos(a) * d, -0.2 - r() * 0.2, Math.sin(a) * d);
      rock.rotation.set(r() * 3, r() * 3, r() * 3);
      rock.castShadow = true;
      rock.receiveShadow = true;
      rocks.add(rock);
    }

    // A few flowers on the rim, outside the 16x16 build area.
    const flowerGeo = new THREE.SphereGeometry(0.14, 8, 6);
    const colors = ['#ff8fb1', '#ffd23f', '#ffffff', '#c792ff'];
    const flowerMats = colors.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    const flowers = new THREE.Group();
    for (let i = 0; i < 24; i++) {
      const f = new THREE.Mesh(flowerGeo, flowerMats[i % flowerMats.length]);
      const side = Math.floor(r() * 4);
      const along = (r() - 0.5) * (ISLAND_SIZE + 1);
      const out = ISLAND_SIZE / 2 + 0.35 + r() * 0.5;
      const [x, z] = [
        [along, out],
        [along, -out],
        [out, along],
        [-out, along],
      ][side];
      f.position.set(x, 0.14, z);
      flowers.add(f);
    }

    this.scene.add(slab, dirt, rocks, flowers);
  }

  private buildClouds(): void {
    const r = mulberry32(99);
    const geo = new THREE.SphereGeometry(1, 12, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 1,
      transparent: true,
      opacity: 0.95,
    });
    for (let i = 0; i < 7; i++) {
      const cloud = new THREE.Mesh(geo, mat);
      cloud.scale.set(5 + r() * 5, 1.3 + r() * 0.7, 2.5 + r() * 2);
      cloud.position.set((r() - 0.5) * 140, 16 + r() * 14, -30 - r() * 40);
      this.clouds.push(cloud);
      this.scene.add(cloud);
    }
  }

  private buildWater(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, WATER_SEGMENTS, WATER_SEGMENTS).rotateX(
      -Math.PI / 2,
    );
    const mat = new THREE.MeshStandardMaterial({
      color: '#3fa7ff',
      transparent: true,
      opacity: 0.7,
      roughness: 0.15,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.position.y = -2;
    this.scene.add(mesh);
    return mesh;
  }
}
