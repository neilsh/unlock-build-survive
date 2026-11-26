/**
 * Headless checks for the disaster add-ons: each one only changes the run when its option is set,
 * and with no options the simulation is identical (same RNG order, same bodies).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { DisasterType } from '../types/blueprint';
import { DISASTER_SECONDS, cellToWorld } from '../types/blueprint';
import { PRESETS } from '../types/presets';
import type { MeshRegistry } from './BuildController';
import { PieceHandle } from './InstancedPieces';
import { PhysicsSim, type SimOptions } from './PhysicsSim';

function meshesFor(g: ReturnType<typeof PRESETS.house>): MeshRegistry {
  const reg: MeshRegistry = { blocks: new Map(), struts: new Map() };
  for (const b of g.blocks) {
    const h = new PieceHandle();
    h.position.set(...cellToWorld(b.cell));
    reg.blocks.set(b.id, h);
  }
  return reg;
}

async function run(disaster: DisasterType, options: SimOptions | undefined, frames: number) {
  const g = PRESETS.house();
  const root = new THREE.Group();
  const sim = new PhysicsSim();
  sim.setEffectsRoot(root);
  let hits = 0;
  sim.setEvents({ onHailImpact: () => hits++ });
  await sim.start(g, meshesFor(g), disaster, 3, undefined, options);
  let peakProjectiles = 0;
  let peakScale = 0;
  for (let f = 0; f < frames && sim.isRunning(); f++) {
    sim.update(1 / 60);
    peakProjectiles = Math.max(peakProjectiles, root.children.length);
    for (const c of root.children) peakScale = Math.max(peakScale, c.scale.x);
  }
  const result = {
    telemetry: sim.getTelemetry(),
    positions: sim.getProjectilePositions(),
    peakProjectiles,
    peakScale,
    hits,
  };
  sim.stop();
  return result;
}

describe('disaster add-ons in the physics sim', () => {
  it('neutral options behave exactly like no options (no RNG or body changes)', async () => {
    const a = await run('hail', undefined, 150);
    const b = await run('hail', {}, 150);
    expect(b).toEqual(a);
    const c = await run('hail', { spawnRateMultiplier: 1, projectileScale: 1, timeScale: 1 }, 150);
    expect(c).toEqual(a);
  });

  it('Double Trouble spawns more hail than normal, but stays capped', async () => {
    const normal = await run('hail', undefined, 60 * 8);
    const doubled = await run('hail', { spawnRateMultiplier: 2 }, 60 * 8);
    expect(doubled.peakProjectiles).toBeGreaterThan(normal.peakProjectiles);
    expect(doubled.hits).toBeGreaterThan(normal.hits);
    expect(doubled.peakProjectiles).toBeLessThanOrEqual(140 + 10); // cap + a few non-projectile children
  });

  it('Giant Hail makes projectiles bigger without changing how many fall', async () => {
    const normal = await run('hail', undefined, 150);
    const giant = await run('hail', { projectileScale: 1.6 }, 150);
    expect(giant.peakScale).toBeCloseTo(normal.peakScale * 1.6, 5);
    expect(giant.peakProjectiles).toBe(normal.peakProjectiles);
  });

  it('Slow-Mo makes the disaster clock tick slower than real time', async () => {
    const normal = await run('hail', undefined, 60);
    const slow = await run('hail', { timeScale: 0.4 }, 60);
    expect(slow.telemetry.timeRemaining).toBeGreaterThan(normal.telemetry.timeRemaining);
    expect(DISASTER_SECONDS - slow.telemetry.timeRemaining).toBeLessThan(
      (DISASTER_SECONDS - normal.telemetry.timeRemaining) * 0.5,
    );
  });

  it('Bouncy Blocks runs a full earthquake cleanly with finite results', async () => {
    const r = await run('earthquake', { blockRestitution: 0.85 }, 60 * 10);
    expect(Number.isFinite(r.telemetry.standingRatio)).toBe(true);
    expect(r.telemetry.mode === 'survived' || r.telemetry.mode === 'failed').toBe(true);
  });
});
