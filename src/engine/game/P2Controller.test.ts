/* oxlint-disable vitest/require-mock-type-parameters -- fakes are deliberately loose */
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { levelStore } from '../../levels/levelStore';
import { uiStore } from '../../state/store';
import { P2Controller, type P2Deps } from './P2Controller';

const setup = (running = true, damage = 0, impact = false) => {
  const build = {
    runAsPlayer2: vi.fn((_cam: THREE.PerspectiveCamera, _p2: unknown, fn: () => boolean) => fn()),
    applyToolAtCrosshair: vi.fn(() => true),
    eraseAtCrosshair: vi.fn(() => true),
    getConstraints: () => null,
  };
  const companion = { pos: new THREE.Vector3(1, 0, 2), resetPosition: vi.fn() };
  const audio = { playKO: vi.fn(), playHit: vi.fn() };
  const physics = {
    isRunning: () => running,
    checkPlayerDamage: vi.fn(() => ({ damage, cause: 'Boom', impact })),
  };
  const camera = new THREE.PerspectiveCamera();
  const c = new P2Controller({
    audio,
    build: build as unknown as P2Deps['build'],
    companion,
    physics,
    getCamera: () => camera,
  });
  return { c, build, companion, audio, physics, camera };
};

beforeEach(() => {
  uiStore.setState({
    playMode: 'survival',
    levelId: null,
    mode: 'simulating',
    multiplayerMode: 'split',
    exploreMode: false,
    playerHp: 100,
    p2Hp: 100,
    p2MaxHp: 100,
    p2Tool: 'block',
    p2Material: 'wood',
    unlockedMaterials: ['wood', 'stone'],
  });
  levelStore.setState({ notice: null });
});

describe('P2Controller health', () => {
  it('damages only Player 2 and uses the player-2 invulnerability slot', () => {
    const { c, physics } = setup(true, 30, true);
    c.updateHealth(0.016);
    expect(uiStore.getState().p2Hp).toBe(70);
    expect(uiStore.getState().playerHp).toBe(100);
    expect(physics.checkPlayerDamage).toHaveBeenCalledWith([1, 0, 2], 0.016, undefined, 2);
  });

  it('KO resets only P2 to full HP at their start', () => {
    uiStore.setState({ p2Hp: 10 });
    const { c, companion, audio } = setup(true, 50);
    c.updateHealth(0.016);
    expect(uiStore.getState().p2Hp).toBe(100);
    expect(uiStore.getState().playerHp).toBe(100);
    expect(companion.resetPosition).toHaveBeenCalled();
    expect(audio.playKO).toHaveBeenCalled();
  });

  it('refills P2 when no disaster is running and ignores non-split modes', () => {
    uiStore.setState({ p2Hp: 20 });
    setup(false).c.updateHealth(0.016);
    expect(uiStore.getState().p2Hp).toBe(100);
    uiStore.setState({ p2Hp: 20, multiplayerMode: 'coop' });
    setup(true, 5).c.updateHealth(0.016);
    expect(uiStore.getState().p2Hp).toBe(20);
  });
});

describe('P2Controller building', () => {
  beforeEach(() => uiStore.setState({ mode: 'build' }));

  it('cycles P2 tool and material without touching P1 selection', () => {
    uiStore.setState({ tool: 'paint', material: 'bamboo' });
    const { c } = setup();
    c.handleActions(['nextTool', 'nextMaterial']);
    expect(uiStore.getState().p2Tool).toBe('brace');
    expect(uiStore.getState().p2Material).toBe('stone');
    expect(uiStore.getState().tool).toBe('paint');
    expect(uiStore.getState().material).toBe('bamboo');
  });

  it('places and erases through P2 camera with P2 selection', () => {
    uiStore.setState({ p2Tool: 'paint', p2Material: 'stone' });
    const { c, build, camera } = setup();
    c.handleActions(['place', 'erase']);
    expect(build.runAsPlayer2).toHaveBeenCalledTimes(2);
    expect(build.runAsPlayer2.mock.calls[0]?.[0]).toBe(camera);
    expect(build.runAsPlayer2.mock.calls[0]?.[1]).toEqual({ tool: 'paint', material: 'stone' });
    expect(build.applyToolAtCrosshair).toHaveBeenCalledTimes(1);
    expect(build.eraseAtCrosshair).toHaveBeenCalledTimes(1);
  });

  it('ignores build presses outside split-screen build mode', () => {
    const { c, build } = setup();
    uiStore.setState({ mode: 'simulating' });
    c.handleActions(['place']);
    uiStore.setState({ mode: 'build', multiplayerMode: 'coop' });
    c.handleActions(['place']);
    expect(build.runAsPlayer2).not.toHaveBeenCalled();
  });
});
