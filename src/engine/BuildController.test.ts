import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BuildController } from './BuildController';
import { AudioSynth, ProceduralAssets } from './ProceduralAssets';
import type { SceneManager } from './SceneManager';
import { ISLAND_SIZE, cornerToWorld, strutId } from '../types/blueprint';

function setup() {
  const captured = new Set<number>();
  const dom = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture: (id: number) => captured.add(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    hasPointerCapture: (id: number) => captured.has(id),
  });
  const camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 200);
  camera.position.set(0, 25, 30);
  camera.lookAt(0, 3, 0);
  camera.updateMatrixWorld();
  const islandTop = new THREE.Mesh(new THREE.PlaneGeometry(ISLAND_SIZE, ISLAND_SIZE).rotateX(-Math.PI / 2));
  islandTop.updateMatrixWorld();
  let controls = true;
  const frame: Array<(dt: number) => void> = [];
  const scene = {
    scene: new THREE.Scene(),
    camera,
    buildRoot: new THREE.Group(),
    islandTop,
    domElement: dom,
    onFrame: (cb: (dt: number) => void) => (frame.push(cb), () => {}),
    setControlsEnabled: (e: boolean) => (controls = e),
  } as unknown as SceneManager;
  const bc = new BuildController(scene, new ProceduralAssets(), new AudioSynth());
  const fire = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) => {
    dom.dispatchEvent(
      Object.assign(
        new Event(type),
        { clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true },
        extra,
      ),
    );
  };
  const screen = (p: [number, number, number]) => {
    const v = new THREE.Vector3(...p).project(camera);
    return [((v.x + 1) / 2) * 800, ((1 - v.y) / 2) * 600] as const;
  };
  return { bc, fire, screen, controls: () => controls, frame, scene, captured };
}

describe('BuildController', () => {
  it('places, rejects, undoes and clears blocks', () => {
    const { bc } = setup();
    expect(bc.placeBlock([1, 0, 1], 'wood')).toBe(true);
    expect(bc.placeBlock([1, 0, 1], 'stone')).toBe(false);
    expect(bc.placeBlock([8, 0, 0], 'wood')).toBe(false);
    expect(bc.meshes.blocks.size).toBe(1);
    expect(bc.canUndo()).toBe(true);
    bc.clear();
    expect(bc.getGraph().blocks).toHaveLength(0);
    expect(bc.meshes.blocks.size).toBe(0);
    bc.undo();
    expect(bc.getGraph().blocks).toHaveLength(1);
    bc.undo();
    expect(bc.getGraph().blocks).toHaveLength(0);
    expect(bc.canUndo()).toBe(false);
  });

  it('validates struts and keeps the registry in sync', () => {
    const { bc } = setup();
    expect(bc.addStrut([0, 0, 0], [1, 2, 0], 'wood')).toBe(false); // top end unanchored
    bc.placeBlock([0, 0, 0], 'wood');
    bc.placeBlock([0, 1, 0], 'wood');
    expect(bc.addStrut([1, 0, 0], [0, 2, 0], 'bamboo')).toBe(true);
    expect(bc.addStrut([0, 2, 0], [1, 0, 0], 'bamboo')).toBe(false); // duplicate
    expect(bc.meshes.struts.has(strutId([1, 0, 0], [0, 2, 0]))).toBe(true);
    const m = bc.meshes.struts.get(strutId([1, 0, 0], [0, 2, 0]))!;
    expect(m.scale.y).toBeCloseTo(Math.hypot(2, 4));
  });

  it('listeners fire and resetMeshes restores transforms', () => {
    const { bc } = setup();
    let n = 0;
    bc.subscribe(() => n++);
    bc.placeBlock([2, 0, 2], 'stone');
    expect(n).toBe(1);
    const m = bc.meshes.blocks.get('b:2,0,2')!;
    m.position.y += 5;
    m.emissive.setHex(0xff0000);
    bc.resetMeshes();
    expect(m.position.y).toBe(1);
    expect(m.emissive.getHex()).toBe(0);
  });

  it('loadPreset replaces the graph and clears history', () => {
    const { bc } = setup();
    bc.placeBlock([0, 0, 0], 'wood');
    bc.loadPreset('house');
    expect(bc.canUndo()).toBe(false);
    expect(bc.getGraph().blocks).toHaveLength(12);
    expect(bc.meshes.struts.size).toBe(8);
    bc.loadPreset('empty');
    expect(bc.meshes.blocks.size).toBe(0);
  });

  it('erasing a block drops struts that lose their anchor', () => {
    const { bc, fire, screen } = setup();
    bc.placeBlock([3, 0, 3], 'wood');
    bc.placeBlock([3, 1, 3], 'wood');
    bc.addStrut([4, 0, 3], [3, 2, 3], 'wood');
    bc.setTool('erase');
    const p = screen([-1, 3, -1]); // top block centre
    fire('pointerdown', p[0], p[1]);
    fire('pointerup', p[0], p[1]);
    expect(bc.getGraph().blocks.map((x) => x.id)).toEqual(['b:3,0,3']);
    expect(bc.getGraph().struts).toHaveLength(0);
  });

  it('pointer: click places a block with mirror, brace drag adds mirrored struts', () => {
    const { bc, fire, screen, controls } = setup();
    bc.setMirrorX(true);
    const [sx, sy] = screen([-6, 0, 0]); // island point, cell x=1,z=4
    fire('pointermove', sx, sy);
    fire('pointerdown', sx, sy);
    fire('pointerup', sx, sy);
    expect(new Set(bc.getGraph().blocks.map((b) => b.id))).toEqual(new Set(['b:1,0,4', 'b:6,0,4']));

    bc.setTool('brace');
    const a = screen(cornerToWorld([1, 0, 4]));
    const b = screen(cornerToWorld([2, 1, 4]));
    fire('pointerdown', a[0], a[1]);
    expect(controls()).toBe(false);
    fire('pointermove', b[0], b[1]);
    fire('pointerup', b[0], b[1]);
    expect(controls()).toBe(true);
    expect(bc.getGraph().struts).toHaveLength(2);
    bc.undo();
    expect(bc.getGraph().struts).toHaveLength(0);
    expect(bc.getGraph().blocks).toHaveLength(2);
  });

  it('pointer erase and paint, disabled while simulating', () => {
    const { bc, fire, screen } = setup();
    bc.placeBlock([3, 0, 3], 'wood');
    const p = screen([-1, 1, -1]);
    bc.setTool('paint');
    bc.setMaterial('stone');
    bc.setEnabled(false);
    fire('pointerdown', p[0], p[1]);
    fire('pointerup', p[0], p[1]);
    expect(bc.getGraph().blocks[0].material).toBe('wood');
    bc.setEnabled(true);
    fire('pointerdown', p[0], p[1]);
    fire('pointerup', p[0], p[1]);
    expect(bc.getGraph().blocks[0].material).toBe('stone');
    bc.setTool('erase');
    fire('pointerdown', p[0], p[1]);
    fire('pointerup', p[0], p[1]);
    expect(bc.getGraph().blocks).toHaveLength(0);
  });

  it('brace drag captures the pointer; a second finger cancels it', () => {
    const { bc, fire, screen, controls, captured } = setup();
    bc.placeBlock([1, 0, 4], 'wood');
    bc.setTool('brace');
    const a = screen(cornerToWorld([1, 0, 4]));
    const b = screen(cornerToWorld([2, 1, 4]));
    fire('pointerdown', a[0], a[1]);
    expect(captured.has(1)).toBe(true);
    fire('pointerdown', b[0], b[1], { pointerId: 2, isPrimary: false });
    expect(controls()).toBe(true);
    expect(captured.size).toBe(0);
    fire('pointerup', b[0], b[1]);
    expect(bc.getGraph().struts).toHaveLength(0);
  });

  it('shows the level grid at the height a block would land on', () => {
    const { bc, fire, screen, scene } = setup();
    bc.placeBlock([3, 0, 3], 'wood');
    const grid = scene.scene.getObjectsByProperty('type', 'GridHelper')[0];
    const top = screen([-1, 2, -1]); // top face of the block
    fire('pointermove', top[0], top[1]);
    expect(grid.visible).toBe(true);
    expect(grid.position.y).toBe(2);
    bc.setTool('erase');
    expect(grid.visible).toBe(false);
  });
});

describe('BuildController constraints', () => {
  it('rejects blocks over the limit but keeps existing ones and allows undo', () => {
    const { bc } = setup();
    bc.setConstraints({ maxBlocks: 2 });
    expect(bc.placeBlock([0, 0, 0], 'wood')).toBe(true);
    expect(bc.placeBlock([1, 0, 0], 'wood')).toBe(true);
    expect(bc.placeBlock([2, 0, 0], 'wood')).toBe(false);
    expect(bc.getGraph().blocks).toHaveLength(2);
    bc.undo();
    expect(bc.placeBlock([2, 0, 0], 'wood')).toBe(true);
  });

  it('rejects disallowed materials for blocks and struts', () => {
    const { bc } = setup();
    bc.setConstraints({ materials: ['bamboo'] });
    expect(bc.placeBlock([0, 0, 0], 'stone')).toBe(false);
    expect(bc.placeBlock([0, 0, 0], 'bamboo')).toBe(true);
    expect(bc.addStrut([0, 0, 0], [1, 1, 0], 'wood')).toBe(false);
    expect(bc.addStrut([0, 0, 0], [1, 1, 0], 'bamboo')).toBe(true);
  });

  it('lifts every limit when cleared and never removes pieces that are already placed', () => {
    const { bc } = setup();
    bc.setConstraints({ maxBlocks: 1, materials: ['wood'] });
    bc.placeBlock([0, 0, 0], 'wood');
    bc.setConstraints(null);
    expect(bc.getConstraints()).toBeNull();
    expect(bc.placeBlock([1, 0, 0], 'stone')).toBe(true);
    bc.setConstraints({ maxBlocks: 1 });
    expect(bc.getGraph().blocks).toHaveLength(2);
    expect(bc.placeBlock([2, 0, 0], 'wood')).toBe(false);
  });

  it('colors the block ghost invalid when maxBlocks is reached or material is disallowed', () => {
    const { bc, fire, screen, scene } = setup();
    bc.setConstraints({ maxBlocks: 1, materials: ['wood'] });
    const [sx, sy] = screen([-6, 0, 0]);
    fire('pointermove', sx, sy);
    const visibleGhost = () =>
      scene.scene.children
        .flatMap((c) => c.children)
        .find(
          (o): o is THREE.Mesh =>
            o instanceof THREE.Mesh && o.visible && o.geometry.type === 'RoundedBoxGeometry',
        );

    const ghost1 = visibleGhost()!;
    expect((ghost1.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x4ade80);

    bc.placeBlock([0, 0, 0], 'wood');
    fire('pointermove', sx, sy);
    const ghost2 = visibleGhost()!;
    expect((ghost2.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xf87171);

    bc.setConstraints({ maxBlocks: 5, materials: ['stone'] });
    fire('pointermove', sx, sy);
    const ghost3 = visibleGhost()!;
    expect((ghost3.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xf87171);
  });
});

/** Instanced meshes in `root` that draw something. */
const instanced = (root: THREE.Object3D) =>
  root.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.visible);

describe('BuildController instancing', () => {
  it('draws a full 8x8x4 build with one instanced mesh per material', () => {
    const { bc, scene } = setup();
    const types = ['wood', 'stone', 'bamboo', 'foam'] as const;
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 8; x++)
        for (let z = 0; z < 8; z++) bc.placeBlock([x, y, z], types[(x + y + z) % 4]);
    const meshes = instanced(scene.buildRoot);
    expect(meshes).toHaveLength(4);
    expect(meshes.reduce((n, m) => n + m.count, 0)).toBe(256);
    // No per-piece meshes are left in the build root.
    expect(scene.buildRoot.children.every((c) => c instanceof THREE.InstancedMesh)).toBe(true);
  });

  it('copies handle pose and tint into the instance buffers before each render', () => {
    const { bc, scene } = setup();
    bc.placeBlock([2, 0, 2], 'wood');
    const h = bc.meshes.blocks.get('b:2,0,2')!;
    h.position.y = 7;
    h.emissive.setRGB(1, 0.5, 0);
    h.emissiveIntensity = 0.5;
    const s = scene.scene;
    s.onBeforeRender(
      undefined as never,
      s,
      scene.camera,
      null as never,
      undefined as never,
      undefined as never,
    );
    const [mesh] = instanced(scene.buildRoot);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).y).toBe(7);
    const c = new THREE.Color();
    mesh.getColorAt(0, c);
    expect([c.r, c.g, c.b]).toEqual([0.5, 0.25, 0]);
  });

  it('repaint moves a piece between batches and erase frees its slot', () => {
    const { bc, fire, screen, scene } = setup();
    bc.placeBlock([3, 0, 3], 'wood');
    bc.placeBlock([4, 0, 3], 'wood');
    const p = screen([-1, 1, -1]); // block [3,0,3]
    bc.setTool('paint');
    bc.setMaterial('foam');
    fire('pointerdown', p[0], p[1]);
    fire('pointerup', p[0], p[1]);
    expect(bc.getGraph().blocks.find((b) => b.id === 'b:3,0,3')?.material).toBe('foam');
    expect(instanced(scene.buildRoot).map((m) => [m.name, m.count])).toEqual([
      ['pieces:wood', 1],
      ['pieces:foam', 1],
    ]);
    bc.setTool('erase');
    fire('pointerdown', p[0], p[1]);
    fire('pointerup', p[0], p[1]);
    expect(bc.getGraph().blocks.map((b) => b.id)).toEqual(['b:4,0,3']);
    expect(instanced(scene.buildRoot).map((m) => m.name)).toEqual(['pieces:wood']);
  });

  it('dispose removes the instanced meshes and unhooks the scene', () => {
    const { bc, scene } = setup();
    bc.placeBlock([0, 0, 0], 'wood');
    const h = bc.meshes.blocks.get('b:0,0,0')!;
    const [mesh] = instanced(scene.buildRoot);
    bc.dispose();
    expect(scene.buildRoot.children).toHaveLength(0);
    h.position.y = 9;
    scene.scene.onBeforeRender(
      undefined as never,
      scene.scene,
      scene.camera,
      null as never,
      undefined as never,
      undefined as never,
    );
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).y).toBe(1);
  });

  it('supports First-Person crosshair building and erasing while ignoring raw pointer clicks', () => {
    const { bc, fire, screen, scene } = setup();
    bc.setCrosshairMode(true);

    // Raw pointer clicks are ignored in crosshair mode (pointer is used for look drag)
    const p = screen([0, 0, 0]);
    fire('pointerdown', p[0], p[1]);
    fire('pointerup', p[0], p[1]);
    expect(bc.getGraph().blocks).toHaveLength(0);

    // Aim First-Person camera at cell [4, 0, 4] center on the island and place + erase via crosshair
    scene.camera.position.set(1, 1.55, 7);
    scene.camera.lookAt(1, 0, 1);
    scene.camera.updateMatrixWorld();

    expect(bc.applyToolAtCrosshair()).toBe(true);
    expect(bc.getGraph().blocks).toHaveLength(1);

    expect(bc.eraseAtCrosshair()).toBe(true);
    expect(bc.getGraph().blocks).toHaveLength(0);
  });

  it('places a door block that opens and closes when clicked and clears open state on erase', () => {
    const { bc, scene } = setup();
    bc.setCrosshairMode(true);
    bc.setMaterial('door');
    scene.camera.position.set(1, 1.55, 7);
    scene.camera.lookAt(1, 0, 1);
    scene.camera.updateMatrixWorld();

    expect(bc.applyToolAtCrosshair()).toBe(true);
    const id = 'b:4,0,4';
    expect(bc.getGraph().blocks).toHaveLength(1);
    expect(bc.getGraph().blocks[0]?.material).toBe('door');
    expect(bc.isDoorOpen(id)).toBe(false);

    // Click the door -> opens and shrinks/slides to the side
    expect(bc.applyToolAtCrosshair()).toBe(true);
    expect(bc.isDoorOpen(id)).toBe(true);
    const h = bc.meshes.blocks.get(id)!;
    expect(h.scale.x).toBeLessThan(0.5);

    // Aim at the open door leaf and click -> closes
    scene.camera.lookAt(h.position.x, h.position.y, h.position.z);
    scene.camera.updateMatrixWorld();
    expect(bc.applyToolAtCrosshair()).toBe(true);
    expect(bc.isDoorOpen(id)).toBe(false);
    expect(h.scale.x).toBe(1);

    // Open again, then erase -> open state is pruned
    expect(bc.applyToolAtCrosshair()).toBe(true);
    expect(bc.isDoorOpen(id)).toBe(true);
    scene.camera.lookAt(h.position.x, h.position.y, h.position.z);
    scene.camera.updateMatrixWorld();
    expect(bc.eraseAtCrosshair()).toBe(true);
    expect(bc.getGraph().blocks).toHaveLength(0);
    expect(bc.isDoorOpen(id)).toBe(false);
  });

  it('blocks manual crosshair placement and erasing when disabled while allowing quick-builder presets', () => {
    const { bc, scene } = setup();
    bc.setCrosshairMode(true);
    bc.setEnabled(false);

    scene.camera.position.set(1, 1.55, 7);
    scene.camera.lookAt(1, 0, 1);
    scene.camera.updateMatrixWorld();

    expect(bc.applyToolAtCrosshair()).toBe(false);
    expect(bc.getGraph().blocks).toHaveLength(0);

    bc.loadPreset('house');
    expect(bc.getGraph().blocks).toHaveLength(12);
    expect(bc.eraseAtCrosshair()).toBe(false);
    expect(bc.getGraph().blocks).toHaveLength(12);
  });
});
