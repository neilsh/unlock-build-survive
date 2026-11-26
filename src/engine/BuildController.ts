/**
 * OWNER: package C (build mode, tools, undo). Contract below is fixed; internals are yours.
 * Build mode renders directly from the BlueprintGraph with no physics. Pieces are drawn instanced
 * (one InstancedMesh per geometry + material type, see InstancedPieces); each piece is a PieceHandle
 * with its own pose and emissive tint, so the physics X-ray can still move and tint pieces one by one.
 * Graph changes must go through `commit`-style methods so undo history stays correct.
 */
import * as THREE from 'three';
import type {
  BlockData,
  BlueprintGraph,
  BuildConstraints,
  MaterialType,
  PresetName,
  StrutData,
  ToolType,
  Vec3,
} from '../types/blueprint';
import {
  blockId,
  cellCorners,
  cellInBounds,
  cellToWorld,
  cloneGraph,
  cornerToWorld,
  emptyGraph,
  getGridCells,
  getIslandSize,
  CELL_SIZE,
  isStrutValid,
  key,
  mirrorCellX,
  mirrorCornerX,
  strutId,
} from '../types/blueprint';
import { PRESETS } from '../types/presets';
import { isBuiltinMaterial } from '../types/materials';
import { canAddBlock, isMaterialAllowed } from '../levels/constraints';
import { InstancedPieces, PieceHandle } from './InstancedPieces';
import type { ProceduralAssets } from './ProceduralAssets';
import type { AudioSynth } from './AudioSynth';
import type { SceneManager } from './SceneManager';

/**
 * Piece lookup the physics sim uses to move/tint pieces. Keyed by BlockData.id / StrutData.id.
 * Handle poses are world transforms (the instanced meshes sit directly under `SceneManager.buildRoot`)
 * and are copied to the GPU just before each render. Handles are plain objects, so headless tests can
 * fill this with `new PieceHandle()`.
 */
export interface MeshRegistry {
  blocks: Map<string, PieceHandle>;
  struts: Map<string, PieceHandle>;
}

const MAX_HISTORY = 100;
/** Max screen distance (px) between the pointer and a corner for the brace tool to snap to it. */
const CORNER_SNAP_PX = 28;
/** Pointer travel (px) beyond which a press counts as a camera drag rather than a click. */
const CLICK_SLOP_PX = 6;

const GOOD = 0x4ade80;
const BAD = 0xf87171;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

type MeshKind = 'block' | 'strut';
interface PieceInfo {
  kind: MeshKind;
  id: string;
}

const sameVec = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const isCustomMaterial = (t: MaterialType) => !isBuiltinMaterial(t);

type PointerType = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointerleave' | 'pointercancel';

export class BuildController {
  readonly meshes: MeshRegistry = { blocks: new Map(), struts: new Map() };
  private graph: BlueprintGraph = emptyGraph();
  private listeners = new Set<() => void>();
  private history: BlueprintGraph[] = [];

  private tool: ToolType = 'block';
  private material: MaterialType = 'wood';
  private mirrorX = false;
  private enabled = true;
  private constraints: BuildConstraints | null = null;

  /** Candidate brace endpoints (ground lattice + block corners), a spatial hash keyed by `key()`. */
  private corners = new Map<string, Vec3>();
  private blocksByCell = new Map<string, BlockData>();
  private blocksById = new Map<string, BlockData>();
  private strutsById = new Map<string, StrutData>();
  private readonly tmpVec = new THREE.Vector3();

  // pointer / preview state
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private pointer: { x: number; y: number } | null = null;
  private pressed: { x: number; y: number; id: number } | null = null;
  private braceStart: Vec3 | null = null;
  private hoverPiece: PieceHandle | null = null;
  private highlightId: string | null = null;

  // ghosts live in the scene (not buildRoot) so they never reach the physics registry
  private readonly ghostRoot = new THREE.Group();
  private readonly blockGhosts: THREE.Mesh[] = [];
  private readonly strutGhosts: THREE.Mesh[] = [];
  private readonly cornerMarker: THREE.Mesh;
  /** Subtle grid over the island footprint at the height the block ghost would land on. */
  private levelGrid: THREE.GridHelper;
  private readonly ghostMats: THREE.MeshBasicMaterial[] = [];
  private readonly ownGeometries: THREE.BufferGeometry[] = [];

  private readonly unsubFrame: () => void;
  private readonly dom: HTMLElement | null;
  private readonly unlisten: Array<() => void> = [];
  /** Which graph piece each handle renders. */
  private readonly pieces = new WeakMap<PieceHandle, PieceInfo>();
  private readonly openDoors = new Set<string>();
  private readonly blockBatches: InstancedPieces;
  private readonly strutBatches: InstancedPieces;
  /** Scene before-render hook that was installed before ours; ours chains to it and restores it. */
  private readonly prevBeforeRender: THREE.Object3D['onBeforeRender'];
  private readonly beforeRender: THREE.Object3D['onBeforeRender'];
  private crosshairMode = false;
  /** Player 2's brace anchor (split-screen); Player 1's is `braceStart`. */
  private p2BraceStart: Vec3 | null = null;
  /** When set, crosshair rays and corner picks use this camera instead of the main one. */
  private rayCamera: THREE.PerspectiveCamera | null = null;
  private time = 0;

  constructor(
    private readonly sceneMgr: SceneManager,
    assets: ProceduralAssets,
    private readonly audio: AudioSynth,
  ) {
    const mk = (color: number) => {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false });
      this.ghostMats.push(m);
      return m;
    };
    const good = mk(GOOD);
    mk(BAD);
    const markerGeo = new THREE.SphereGeometry(0.28, 12, 12);
    this.ownGeometries.push(markerGeo);
    this.cornerMarker = new THREE.Mesh(markerGeo, good);
    this.cornerMarker.visible = false;
    this.ghostRoot.add(this.cornerMarker);
    this.levelGrid = this.makeLevelGrid();
    this.ghostRoot.add(this.levelGrid);
    for (let i = 0; i < 2; i++) {
      const bg = new THREE.Mesh(assets.getBlockGeometry(), good);
      const sg = new THREE.Mesh(assets.getStrutGeometry(), good);
      bg.visible = sg.visible = false;
      this.blockGhosts.push(bg);
      this.strutGhosts.push(sg);
      this.ghostRoot.add(bg, sg);
    }
    sceneMgr.scene.add(this.ghostRoot);

    const createMaterial = (t: MaterialType) => assets.createMaterial(t);
    this.blockBatches = new InstancedPieces(sceneMgr.buildRoot, assets.getBlockGeometry(), createMaterial);
    this.strutBatches = new InstancedPieces(sceneMgr.buildRoot, assets.getStrutGeometry(), createMaterial);
    // Physics moves handles in its own frame callback, which may run after ours, so upload in the
    // scene's before-render hook: it fires inside renderer.render() before any culling or shadow pass.
    const scene = sceneMgr.scene;
    this.prevBeforeRender = scene.onBeforeRender.bind(scene);
    this.beforeRender = (...args) => {
      this.prevBeforeRender(...args);
      this.flushInstances();
    };
    scene.onBeforeRender = this.beforeRender;

    this.rebuildIndices();
    this.rebuildCorners();
    this.unsubFrame = sceneMgr.onFrame((dt) => this.onFrame(dt));

    // Capture phase so the brace tool can claim a drag before orbit controls see it.
    const dom = typeof sceneMgr.domElement?.addEventListener === 'function' ? sceneMgr.domElement : null;
    this.dom = dom;
    if (dom) {
      this.listen(dom, 'pointerdown', (e) => this.onPointerDown(e), true);
      this.listen(dom, 'pointermove', (e) => this.onPointerMove(e), false);
      this.listen(dom, 'pointerup', (e) => this.onPointerUp(e), false);
      this.listen(dom, 'pointerleave', () => this.onPointerLeave(), false);
      this.listen(dom, 'pointercancel', () => this.cancelDrag(), false);
    }
  }

  // ------------------------------------------------------------------ public API

  /** Current graph (treat as read-only). */
  getGraph(): BlueprintGraph {
    return this.graph;
  }

  /** Replace the graph (presets). Clears undo history. */
  loadPreset(name: PresetName): void {
    this.loadGraph(PRESETS[name]());
  }
  loadGraph(g: BlueprintGraph): void {
    this.graph = cloneGraph(g);
    this.history = [];
    this.afterGraphChange();
  }

  /**
   * Programmatic edits (used by the debug API and tests). They ignore mirror mode, which applies only
   * to pointer tools, and return false when the edit is rejected (see validity rules in blueprint.ts).
   */
  placeBlock(cell: Vec3, material: MaterialType): boolean {
    return this.commit((g) => this.addBlockTo(g, cell, material));
  }
  addStrut(a: Vec3, b: Vec3, material: MaterialType): boolean {
    return this.commit((g) => this.addStrutTo(g, a, b, material));
  }

  setTool(t: ToolType): void {
    this.tool = t;
    this.cancelDrag();
    this.updatePreview();
  }
  setMaterial(m: MaterialType): void {
    this.material = m;
    this.updatePreview();
  }
  refreshCustomMaterials(): void {
    this.blockBatches.invalidate(isCustomMaterial);
    this.strutBatches.invalidate(isCustomMaterial);
  }
  setMirrorX(on: boolean): void {
    this.mirrorX = on;
    this.updatePreview();
  }
  undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.graph = prev;
    this.afterGraphChange();
  }
  clear(): void {
    this.commit((g) => {
      if (!g.blocks.length && !g.struts.length) return false;
      g.blocks = [];
      g.struts = [];
      return true;
    });
  }
  canUndo(): boolean {
    return this.history.length > 0;
  }

  /**
   * Limits for challenge levels (max block count, allowed materials). Undefined fields mean no limit;
   * `null` clears all constraints. Enforced for every edit path (pointer tools, mirror, programmatic):
   * a block over the limit or a piece in a disallowed material is simply rejected. Pieces already on the
   * island (such as a level's starting build) are never removed.
   */
  setConstraints(c: BuildConstraints | null): void {
    this.constraints = c;
  }

  getConstraints(): BuildConstraints | null {
    return this.constraints;
  }

  /** Pointer tools are disabled while a disaster is running. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.cancelDrag();
    this.pointer = enabled ? this.pointer : null;
    this.updatePreview();
  }

  /** Enables center-screen crosshair raycasting and disables pointer-coordinate building. */
  setCrosshairMode(on: boolean): void {
    this.crosshairMode = on;
    this.cancelDrag();
    this.updatePreview();
  }

  /**
   * Runs a crosshair action as Player 2 (split-screen): with their own tool, material and brace anchor,
   * aimed through their camera's centre. Player 1's state is restored afterwards.
   */
  runAsPlayer2<T>(
    camera: THREE.PerspectiveCamera,
    p2: { tool: ToolType; material: MaterialType },
    fn: () => T,
  ): T {
    const saved = { tool: this.tool, material: this.material, brace: this.braceStart };
    this.tool = p2.tool;
    this.material = p2.material;
    this.braceStart = this.p2BraceStart;
    this.rayCamera = camera;
    try {
      return fn();
    } finally {
      this.p2BraceStart = this.braceStart;
      this.tool = saved.tool;
      this.material = saved.material;
      this.braceStart = saved.brace;
      this.rayCamera = null;
      this.updatePreview();
    }
  }

  hasActiveBrace(): boolean {
    return this.braceStart !== null;
  }

  isDoorOpen(id: string): boolean {
    return this.openDoors.has(id);
  }

  getOpenDoorIds(): ReadonlySet<string> {
    return this.openDoors;
  }

  toggleDoor(id: string): boolean {
    const b = this.blocksById.get(id);
    const h = this.meshes.blocks.get(id);
    if (!b || !h || b.material !== 'door') return false;
    if (this.openDoors.has(id)) this.openDoors.delete(id);
    else this.openDoors.add(id);
    this.placeBlockMesh(h, b.cell, b.id);
    this.flushInstances();
    this.audio.playClack();
    this.updatePreview();
    this.notify();
    return true;
  }

  toggleDoorAtCrosshair(maxDistance = Infinity): boolean {
    if (!this.setCenterRay()) return false;
    const door = this.pickDoorAtRay(maxDistance);
    return door ? this.toggleDoor(door.id) : false;
  }

  cancelBrace(): void {
    if (!this.braceStart) return;
    this.braceStart = null;
    this.updatePreview();
  }

  /** Applies the active tool at the center crosshair ray (used in First-Person mode). */
  applyToolAtCrosshair(): boolean {
    if (!this.enabled) return false;
    let ok = false;
    switch (this.tool) {
      case 'block': {
        if (!this.setCenterRay()) return false;
        const door = this.pickDoorAtRay();
        if (door) return this.toggleDoor(door.id);
        const cell = this.pickPlacementCell();
        if (cell && this.placeBlockWithMirror(cell)) {
          this.audio.playClack();
          ok = true;
        }
        break;
      }
      case 'brace': {
        const corner = this.pickCenterCorner();
        if (!corner) return false;
        if (!this.braceStart) {
          this.braceStart = corner;
          ok = true;
        } else if (!sameVec(this.braceStart, corner)) {
          const start = this.braceStart;
          this.braceStart = null;
          ok = this.placeBraceWithMirror(start, corner);
        }
        break;
      }
      case 'paint': {
        if (!this.setCenterRay()) return false;
        const m = this.pickPiece(['block', 'strut']);
        if (m && this.paintWithMirror(m)) {
          this.audio.playClack();
          ok = true;
        }
        break;
      }
      case 'erase': {
        if (!this.setCenterRay()) return false;
        const m = this.pickPiece(['block', 'strut']);
        if (m && this.eraseWithMirror(m)) {
          this.audio.playClack();
          ok = true;
        }
        break;
      }
    }
    this.updatePreview();
    return ok;
  }

  /** Cancels an active brace drag or erases the piece aimed at by the center crosshair. */
  eraseAtCrosshair(): boolean {
    if (!this.enabled) return false;
    if (this.braceStart) {
      this.braceStart = null;
      this.updatePreview();
      return true;
    }
    if (!this.setCenterRay()) return false;
    const m = this.pickPiece(['block', 'strut']);
    if (!m || !this.eraseWithMirror(m)) return false;
    this.audio.playClack();
    this.updatePreview();
    return true;
  }

  /** Snap every mesh back to its exact blueprint transform and clear tints (rewind). */
  resetMeshes(): void {
    for (const b of this.graph.blocks) {
      const m = this.meshes.blocks.get(b.id);
      if (m) this.placeBlockMesh(m, b.cell, b.id);
    }
    for (const s of this.graph.struts) {
      const m = this.meshes.struts.get(s.id);
      if (m) this.placeStrutMesh(m, s.a, s.b);
    }
    for (const m of this.allPieces()) this.setEmissive(m, 0x000000);
    this.hoverPiece = null;
    this.flushInstances();
    this.notify();
  }
  /** Pulsing red glow on the piece that broke first, or null to clear. */
  highlight(id: string | null): void {
    if (this.highlightId && this.highlightId !== id) {
      const old = this.findPiece(this.highlightId);
      if (old) this.setEmissive(old, 0x000000);
    }
    this.highlightId = id;
  }

  /** Called after any graph or mesh change. Returns unsubscribe. */
  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  dispose(): void {
    this.unsubFrame();
    this.unlisten.forEach((off) => off());
    this.unlisten.length = 0;
    this.sceneMgr.setControlsEnabled(true);
    if (this.sceneMgr.scene.onBeforeRender === this.beforeRender)
      this.sceneMgr.scene.onBeforeRender = this.prevBeforeRender;
    this.blockBatches.dispose();
    this.strutBatches.dispose();
    this.meshes.blocks.clear();
    this.meshes.struts.clear();
    this.sceneMgr.scene.remove(this.ghostRoot);
    this.ghostMats.forEach((m) => m.dispose());
    this.levelGrid.dispose();
    this.ownGeometries.forEach((g) => g.dispose());
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ graph editing

  /** Run `fn` on a copy of the graph; if it reports a change, push one undo step and commit it. */
  private commit(fn: (g: BlueprintGraph) => boolean): boolean {
    const next = cloneGraph(this.graph);
    if (!fn(next)) return false;
    this.history.push(this.graph);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.graph = next;
    this.afterGraphChange();
    return true;
  }

  private addBlockTo(g: BlueprintGraph, cell: Vec3, material: MaterialType): boolean {
    if (!cellInBounds(cell) || g.blocks.some((b) => sameVec(b.cell, cell))) return false;
    if (!isMaterialAllowed(this.constraints, material) || !canAddBlock(this.constraints, g.blocks.length)) {
      return false;
    }
    g.blocks.push({ id: blockId(cell), cell: [...cell], material });
    return true;
  }

  private addStrutTo(g: BlueprintGraph, a: Vec3, b: Vec3, material: MaterialType): boolean {
    if (!isStrutValid(g, a, b) || !isMaterialAllowed(this.constraints, material)) return false;
    const id = strutId(a, b);
    if (g.struts.some((s) => s.id === id)) return false;
    const [p, q] = key(a) <= key(b) ? [a, b] : [b, a];
    g.struts.push({ id, a: [...p], b: [...q], material });
    return true;
  }

  /** Remove a block, then any strut that lost its anchor. */
  private removeBlockFrom(g: BlueprintGraph, cell: Vec3): boolean {
    const n = g.blocks.length;
    g.blocks = g.blocks.filter((b) => !sameVec(b.cell, cell));
    if (g.blocks.length === n) return false;
    g.struts = g.struts.filter((s) => isStrutValid(g, s.a, s.b));
    return true;
  }

  private paintIn(g: BlueprintGraph, kind: MeshKind, id: string, material: MaterialType): boolean {
    const piece = (kind === 'block' ? g.blocks : g.struts).find((p) => p.id === id);
    if (!piece || piece.material === material || !isMaterialAllowed(this.constraints, material)) return false;
    piece.material = material;
    return true;
  }

  private afterGraphChange(): void {
    this.rebuildIndices();
    this.syncMeshes();
    this.rebuildCorners();
    this.updatePreview();
    this.notify();
  }

  private rebuildIndices(): void {
    this.blocksByCell.clear();
    this.blocksById.clear();
    this.strutsById.clear();
    for (const b of this.graph.blocks) {
      this.blocksByCell.set(key(b.cell), b);
      this.blocksById.set(b.id, b);
    }
    for (const s of this.graph.struts) {
      this.strutsById.set(s.id, s);
    }
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  // ------------------------------------------------------------------ meshes

  private syncMeshes(): void {
    const sync = <T extends { id: string; material: MaterialType }>(
      items: T[],
      reg: Map<string, PieceHandle>,
      batches: InstancedPieces,
      kind: MeshKind,
      place: (h: PieceHandle, item: T) => void,
    ) => {
      const live = new Set(items.map((i) => i.id));
      for (const [id, h] of reg) {
        if (!live.has(id)) {
          if (this.hoverPiece === h) this.hoverPiece = null;
          batches.remove(h);
          reg.delete(id);
        }
      }
      for (const item of items) {
        let h = reg.get(item.id);
        if (!h) {
          h = new PieceHandle();
          this.pieces.set(h, { kind, id: item.id });
          reg.set(item.id, h);
        }
        if (batches.typeOf(h) !== item.material) batches.add(h, item.material);
        place(h, item);
        this.setEmissive(h, 0x000000);
      }
    };
    for (const id of this.openDoors) {
      if (this.blocksById.get(id)?.material !== 'door') {
        this.openDoors.delete(id);
      }
    }
    sync(this.graph.blocks, this.meshes.blocks, this.blockBatches, 'block', (h, b) =>
      this.placeBlockMesh(h, b.cell, b.id),
    );
    sync(this.graph.struts, this.meshes.struts, this.strutBatches, 'strut', (h, s) =>
      this.placeStrutMesh(h, s.a, s.b),
    );
    // Raycasts for the next preview read the instance buffers, so upload now rather than at render.
    this.flushInstances();
  }

  private flushInstances(): void {
    this.blockBatches.flush();
    this.strutBatches.flush();
  }

  private placeBlockMesh(m: PieceHandle, cell: Vec3, id?: string): void {
    const [wx, wy, wz] = cellToWorld(cell);
    if (id && this.openDoors.has(id)) {
      m.position.set(wx - CELL_SIZE * 0.39, wy, wz);
      m.quaternion.identity();
      m.scale.set(0.22, 1, 0.96);
      return;
    }
    m.position.set(wx, wy, wz);
    m.quaternion.identity();
    m.scale.set(1, 1, 1);
  }

  private placeStrutMesh(m: PieceHandle, a: Vec3, b: Vec3): void {
    this.orientStrut(m, new THREE.Vector3(...cornerToWorld(a)), new THREE.Vector3(...cornerToWorld(b)));
  }

  private orientStrut(m: PieceHandle | THREE.Object3D, pa: THREE.Vector3, pb: THREE.Vector3): void {
    const dir = pb.clone().sub(pa);
    const len = dir.length() || 0.001;
    m.position.copy(pa).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(Y_AXIS, dir.divideScalar(len));
    m.scale.set(1, len, 1);
  }

  private allPieces(): PieceHandle[] {
    return [...this.meshes.blocks.values(), ...this.meshes.struts.values()];
  }

  private findPiece(id: string): PieceHandle | undefined {
    return this.meshes.blocks.get(id) ?? this.meshes.struts.get(id);
  }

  private setEmissive(h: PieceHandle, color: number): void {
    h.emissive.setHex(color);
  }

  private onFrame(dt: number): void {
    this.time += dt;
    if (this.crosshairMode && this.enabled) this.updatePreview();
    if (!this.highlightId) return;
    const m = this.findPiece(this.highlightId);
    if (!m) return;
    const pulse = 0.35 + 0.35 * Math.sin(this.time * 8);
    m.emissive.setRGB(pulse + 0.3, 0, 0);
  }

  private makeLevelGrid(): THREE.GridHelper {
    const grid = new THREE.GridHelper(getIslandSize(), getGridCells(), 0xffffff, 0xffffff);
    for (const gridMat of [grid.material].flat()) {
      gridMat.transparent = true;
      gridMat.opacity = 0.25;
      gridMat.depthWrite = false;
    }
    grid.visible = false;
    return grid;
  }

  /** Re-fits the placement grid and ground corners after the island size changed (see `setIslandCells`). */
  refreshIsland(): void {
    this.ghostRoot.remove(this.levelGrid);
    this.levelGrid.dispose();
    this.levelGrid = this.makeLevelGrid();
    this.ghostRoot.add(this.levelGrid);
    this.rebuildCorners();
  }

  private rebuildCorners(): void {
    const c = new Map<string, Vec3>();
    for (let x = 0; x <= getGridCells(); x++)
      for (let z = 0; z <= getGridCells(); z++) c.set(key([x, 0, z]), [x, 0, z]);
    for (const b of this.graph.blocks) for (const k of cellCorners(b.cell)) c.set(key(k), k);
    this.corners = c;
  }

  // ------------------------------------------------------------------ pointer handling

  private listen(dom: HTMLElement, type: PointerType, fn: (e: PointerEvent) => void, capture: boolean): void {
    dom.addEventListener(type, fn, capture);
    this.unlisten.push(() => dom.removeEventListener(type, fn, capture));
  }

  private setRay(x: number, y: number): boolean {
    const rect = this.dom?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return false;
    this.ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    return this.aimRayFromNdc();
  }

  private setCenterRay(): boolean {
    this.ndc.set(0, 0);
    return this.aimRayFromNdc();
  }

  private aimRayFromNdc(): boolean {
    const cam = this.rayCamera ?? this.sceneMgr.camera;
    cam.updateMatrixWorld();
    // Meshes added since the last render have a stale matrixWorld, which raycasting reads.
    this.sceneMgr.buildRoot.updateMatrixWorld(true);
    this.sceneMgr.islandTop.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, cam);
    return true;
  }

  private pickCenterCorner(): Vec3 | null {
    const cam = this.rayCamera ?? this.sceneMgr.camera;
    cam.updateMatrixWorld();
    const v = this.tmpVec;
    let best: Vec3 | null = null;
    let bestScore = Infinity;
    for (const k of this.corners.values()) {
      v.set(...cornerToWorld(k)).project(cam);
      if (v.z > 1 || v.z < -1) continue;
      const d = Math.hypot(v.x, v.y);
      const score = d + v.z * 0.1;
      if (d <= 0.12 && score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    return best;
  }

  /** Nearest snap corner to the pointer in screen space, or null. */
  private pickCorner(x: number, y: number): Vec3 | null {
    const rect = this.dom?.getBoundingClientRect();
    if (!rect) return null;
    const cam = this.sceneMgr.camera;
    cam.updateMatrixWorld();
    const v = this.tmpVec;
    let best: Vec3 | null = null;
    let bestScore = Infinity;
    for (const k of this.corners.values()) {
      v.set(...cornerToWorld(k)).project(cam);
      if (v.z > 1 || v.z < -1) continue; // outside the view frustum's depth range
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(sx - x, sy - y);
      // Prefer nearer-to-camera corners on ties by adding a tiny depth term.
      const score = d + v.z * 0.5;
      if (d <= CORNER_SNAP_PX && score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    return best;
  }

  /** Cell a new block would go into for the current pointer, or null. */
  private pickPlacementCell(): Vec3 | null {
    const hits = this.raycaster.intersectObjects(
      [...this.blockBatches.meshes(), this.sceneMgr.islandTop],
      false,
    );
    const hit = hits[0];
    if (!hit) return null;
    const piece = this.blockBatches.handleAt(hit);
    const info = piece && this.pieces.get(piece);
    if (piece && info) {
      const base = this.blocksById.get(info.id);
      if (!base || !hit.face) return null;
      // Face normals are in geometry space: rotate by the instance, then by the batch mesh.
      const n = hit.face.normal
        .clone()
        .applyQuaternion(piece.quaternion)
        .transformDirection(hit.object.matrixWorld);
      const axis = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
      const i = axis.indexOf(Math.max(...axis));
      const cell: Vec3 = [...base.cell];
      cell[i] += Math.sign([n.x, n.y, n.z][i]);
      return cell;
    }
    const half = getIslandSize() / 2;
    const cx = Math.floor((hit.point.x + half) / CELL_SIZE);
    const cz = Math.floor((hit.point.z + half) / CELL_SIZE);
    return [cx, 0, cz];
  }

  private pickPiece(kinds: MeshKind[]): PieceHandle | null {
    const sets = [
      ...(kinds.includes('block') ? [this.blockBatches] : []),
      ...(kinds.includes('strut') ? [this.strutBatches] : []),
    ];
    const hit = this.raycaster.intersectObjects(
      sets.flatMap((p) => p.meshes()),
      false,
    )[0];
    if (!hit) return null;
    for (const p of sets) {
      const h = p.handleAt(hit);
      if (h) return h;
    }
    return null;
  }

  private pickDoorAtRay(maxDistance = Infinity): { id: string; handle: PieceHandle } | null {
    const hits = this.raycaster.intersectObjects(this.blockBatches.meshes(), false);
    const hit = hits[0];
    if (!hit || hit.distance > maxDistance) return null;
    const handle = this.blockBatches.handleAt(hit);
    const info = handle && this.pieces.get(handle);
    if (!handle || !info || info.kind !== 'block') return null;
    const block = this.blocksById.get(info.id);
    if (!block || block.material !== 'door') return null;
    return { id: block.id, handle };
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.crosshairMode || !this.enabled || e.button > 0) return;
    // A second finger means pinch/orbit, never a click or brace: drop whatever the first one started.
    if (!e.isPrimary) return this.cancelDrag();
    this.pointer = { x: e.clientX, y: e.clientY };
    if (this.tool === 'brace') {
      const corner = this.pickCorner(e.clientX, e.clientY);
      if (corner) {
        this.braceStart = corner;
        this.sceneMgr.setControlsEnabled(false);
        // Keep receiving moves/up even if the drag leaves the canvas, so controls are always re-enabled.
        try {
          this.dom?.setPointerCapture?.(e.pointerId);
        } catch {
          // Synthetic events (tests, debug tooling) have no active pointer to capture.
        }
        e.stopImmediatePropagation();
      }
    }
    this.pressed = { x: e.clientX, y: e.clientY, id: e.pointerId };
    this.updatePreview();
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.crosshairMode || !this.enabled || !e.isPrimary) return;
    this.pointer = { x: e.clientX, y: e.clientY };
    this.updatePreview();
  }

  private onPointerLeave(): void {
    if (this.crosshairMode) return;
    this.pointer = null;
    this.updatePreview();
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.crosshairMode || !e.isPrimary) return;
    const pressed = this.pressed;
    this.releaseCapture();
    this.pressed = null;
    if (!this.enabled || !pressed) return this.cancelDrag();
    this.pointer = { x: e.clientX, y: e.clientY };
    if (this.tool === 'brace') {
      const start = this.braceStart;
      const end = this.pickCorner(e.clientX, e.clientY);
      this.cancelDrag();
      if (start && end) this.placeBraceWithMirror(start, end);
      return;
    }
    const moved = Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y);
    if (moved > CLICK_SLOP_PX || !this.setRay(e.clientX, e.clientY)) return;
    switch (this.tool) {
      case 'block': {
        const door = this.pickDoorAtRay();
        if (door) {
          this.toggleDoor(door.id);
          break;
        }
        const cell = this.pickPlacementCell();
        if (cell && this.placeBlockWithMirror(cell)) this.audio.playClack();
        break;
      }
      case 'erase': {
        const m = this.pickPiece(['block', 'strut']);
        if (m && this.eraseWithMirror(m)) this.audio.playClack();
        break;
      }
      case 'paint': {
        const m = this.pickPiece(['block', 'strut']);
        if (m && this.paintWithMirror(m)) this.audio.playClack();
        break;
      }
    }
    this.updatePreview();
  }

  private releaseCapture(): void {
    const id = this.pressed?.id;
    if (id !== undefined && this.dom?.hasPointerCapture?.(id)) this.dom.releasePointerCapture(id);
  }

  private cancelDrag(): void {
    this.releaseCapture();
    if (this.braceStart) this.sceneMgr.setControlsEnabled(true);
    this.braceStart = null;
    this.p2BraceStart = null;
    this.pressed = null;
    this.updatePreview();
  }

  private placeBlockWithMirror(cell: Vec3): boolean {
    return this.commit((g) => {
      let ok = this.addBlockTo(g, cell, this.material);
      if (this.mirrorX) {
        const m = mirrorCellX(cell);
        if (!sameVec(m, cell)) ok = this.addBlockTo(g, m, this.material) || ok;
      }
      return ok;
    });
  }

  private placeBraceWithMirror(a: Vec3, b: Vec3): boolean {
    const ok = this.commit((g) => {
      let added = this.addStrutTo(g, a, b, this.material);
      if (this.mirrorX)
        added = this.addStrutTo(g, mirrorCornerX(a), mirrorCornerX(b), this.material) || added;
      return added;
    });
    if (ok) this.audio.playBraceStretch();
    return ok;
  }

  private eraseWithMirror(m: PieceHandle): boolean {
    const info = this.pieces.get(m);
    if (!info) return false;
    const piece = this.blocksById.get(info.id);
    const strut = this.strutsById.get(info.id);
    return this.commit((g) => {
      let changed = false;
      if (info.kind === 'block' && piece) {
        changed = this.removeBlockFrom(g, piece.cell);
        if (this.mirrorX) changed = this.removeBlockFrom(g, mirrorCellX(piece.cell)) || changed;
      } else if (strut) {
        const ids = new Set([strut.id]);
        if (this.mirrorX) ids.add(strutId(mirrorCornerX(strut.a), mirrorCornerX(strut.b)));
        const n = g.struts.length;
        g.struts = g.struts.filter((s) => !ids.has(s.id));
        changed = g.struts.length !== n;
      }
      return changed;
    });
  }

  private paintWithMirror(m: PieceHandle): boolean {
    const info = this.pieces.get(m);
    if (!info) return false;
    const piece = this.blocksById.get(info.id);
    const strut = this.strutsById.get(info.id);
    return this.commit((g) => {
      let changed = this.paintIn(g, info.kind, info.id, this.material);
      if (this.mirrorX) {
        const mid = piece
          ? blockId(mirrorCellX(piece.cell))
          : strut
            ? strutId(mirrorCornerX(strut.a), mirrorCornerX(strut.b))
            : null;
        if (mid && mid !== info.id) changed = this.paintIn(g, info.kind, mid, this.material) || changed;
      }
      return changed;
    });
  }

  // ------------------------------------------------------------------ previews

  private updatePreview(): void {
    for (const g of [...this.blockGhosts, ...this.strutGhosts, this.cornerMarker, this.levelGrid])
      g.visible = false;
    if (this.hoverPiece) {
      if (this.pieces.get(this.hoverPiece)?.id !== this.highlightId)
        this.setEmissive(this.hoverPiece, 0x000000);
      this.hoverPiece = null;
    }
    if (!this.enabled || (!this.crosshairMode && (!this.dom || !this.pointer))) return;

    if (this.tool === 'block') {
      const rayOk = this.crosshairMode
        ? this.setCenterRay()
        : this.pointer
          ? this.setRay(this.pointer.x, this.pointer.y)
          : false;
      if (!rayOk) return;
      const door = this.pickDoorAtRay();
      if (door) {
        this.hoverPiece = door.handle;
        this.setEmissive(door.handle, 0x443311);
        return;
      }
      const cell = this.pickPlacementCell();
      if (!cell) return;
      const cells = [cell];
      if (this.mirrorX && !sameVec(mirrorCellX(cell), cell)) cells.push(mirrorCellX(cell));
      cells.forEach((c, i) => {
        const ghost = this.blockGhosts[i];
        const valid =
          cellInBounds(c) &&
          !this.blocksByCell.has(key(c)) &&
          isMaterialAllowed(this.constraints, this.material) &&
          canAddBlock(this.constraints, this.graph.blocks.length + i);
        ghost.material = this.ghostMat(valid);
        ghost.position.set(...cellToWorld(c));
        ghost.visible = true;
      });
      // Lift the ground-level grid a hair so it doesn't z-fight with the island top.
      this.levelGrid.position.y = Math.max(cell[1] * CELL_SIZE, 0.02);
      this.levelGrid.visible = cellInBounds(cell);
    } else if (this.tool === 'brace') {
      const hover = this.crosshairMode
        ? this.pickCenterCorner()
        : this.pointer
          ? this.pickCorner(this.pointer.x, this.pointer.y)
          : null;
      const start = this.braceStart;
      if (start) {
        const end = hover ?? start;
        const pairs: Array<[Vec3, Vec3]> = [[start, end]];
        if (this.mirrorX) pairs.push([mirrorCornerX(start), mirrorCornerX(end)]);
        pairs.forEach(([a, b], i) => {
          if (sameVec(a, b)) return;
          const ghost = this.strutGhosts[i];
          const valid =
            isStrutValid(this.graph, a, b) &&
            !this.strutsById.has(strutId(a, b)) &&
            isMaterialAllowed(this.constraints, this.material);
          ghost.material = this.ghostMat(valid);
          this.orientStrut(
            ghost,
            new THREE.Vector3(...cornerToWorld(a)),
            new THREE.Vector3(...cornerToWorld(b)),
          );
          ghost.visible = true;
        });
      }
      const marked = hover ?? start;
      if (marked) {
        this.cornerMarker.position.set(...cornerToWorld(marked));
        this.cornerMarker.material = this.ghostMat(true);
        this.cornerMarker.visible = true;
      }
    } else {
      const rayOk = this.crosshairMode
        ? this.setCenterRay()
        : this.pointer
          ? this.setRay(this.pointer.x, this.pointer.y)
          : false;
      if (!rayOk) return;
      const m = this.pickPiece(['block', 'strut']);
      if (!m) return;
      this.hoverPiece = m;
      this.setEmissive(m, this.tool === 'erase' ? 0x992222 : 0x444444);
    }
  }

  private ghostMat(valid: boolean): THREE.MeshBasicMaterial {
    return this.ghostMats[valid ? 0 : 1];
  }
}
