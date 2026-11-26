/* oxlint-disable unicorn/consistent-function-scoping, vitest/require-mock-type-parameters, typescript/unbound-method -- fakes are deliberately loose */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { levelStore } from '../../levels/levelStore';
import { HUT, graphOf, type BlockSpec } from '../../levels/villageFixtures';
import { START_POPULATION } from '../../levels/village';
import { uiStore } from '../../state/store';
import {
  GRID_CELLS,
  VILLAGE_GRID_CELLS,
  getGridCells,
  setIslandCells,
  type Vec3,
} from '../../types/blueprint';
import type { VillagerView } from '../village/VillagerAvatars';
import { SessionController } from './SessionController';
import { isCreativeSandbox } from './modeRules';
import { VillageController } from './VillageController';

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
  });
  setIslandCells(VILLAGE_GRID_CELLS);
  uiStore.setState({
    playMode: 'village',
    levelId: null,
    mode: 'build',
    villageOver: false,
    villageCleared: false,
    villageRound: 1,
    villageBestRound: 0,
    multiplayerMode: 'solo',
  });
  levelStore.setState({ notice: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setIslandCells(GRID_CELLS);
});

function make(blocks: BlockSpec[] = HUT) {
  let graph = graphOf(blocks);
  let fallen = new Set<string>();
  const view: VillagerView = { sync: vi.fn(), setVisible: vi.fn(), dispose: vi.fn() };
  const viewers: Vec3[] = [[0, 0, 0]];
  const c = new VillageController({
    view,
    getGraph: () => graph,
    getFallenIds: () => fallen,
    getFallenPositions: () => [],
    getViewers: () => viewers,
  });
  return {
    c,
    view,
    viewers,
    setGraph: (g: ReturnType<typeof graphOf>) => (graph = g),
    setFallen: (f: Set<string>) => (fallen = f),
  };
}

const runFor = (c: VillageController, seconds: number): boolean => {
  for (let t = 0; t < seconds; t += 1 / 30) if (c.tick(1 / 30)) return true;
  return false;
};

describe('VillageController', () => {
  it('enter() spawns the starting villagers, shows them and publishes counts and beds', () => {
    const { c, view } = make();
    c.enter();
    expect(view.setVisible).toHaveBeenCalledWith(true);
    expect(uiStore.getState()).toMatchObject({
      villageRound: 1,
      villagePopulation: START_POPULATION,
      villageAlive: START_POPULATION,
      villageBeds: 2,
      villageOver: false,
    });
    runFor(c, 1);
    expect(view.sync).toHaveBeenCalled();
  });

  it('a sheltered village clears the round and remembers the best round', () => {
    const { c } = make();
    c.enter(1, 2);
    c.onDisasterStarted('medium');
    expect(c.isRunning()).toBe(true);
    expect(runFor(c, 8)).toBe(false);
    c.onRunFinished();
    expect(uiStore.getState()).toMatchObject({
      villageCleared: true,
      villageOver: false,
      villageBestRound: 1,
    });
    expect(memory.get('disaster-village:village:v1')).toBe('1');
  });

  it('any villager knocked out loses the village', () => {
    const { c } = make([]);
    c.enter(1, 2);
    c.onDisasterStarted('medium');
    expect(runFor(c, 10)).toBe(true);
    expect(uiStore.getState().villageOver).toBe(true);
    expect(uiStore.getState().villageFailReason).toMatch(/villager/i);
    expect(c.isRunning()).toBe(false);
    expect(c.currentRound()).toBeNull();
  });

  it('projectile impacts and fallen roofs feed into villager damage', () => {
    const { c, setFallen } = make();
    c.enter(1, 1);
    c.onDisasterStarted('gentle');
    runFor(c, 5);
    const v = c.getSim().getVillagers()[0];
    if (!v) throw new Error('no villager');
    const before = v.hp;
    c.onImpact(v.x, v.z);
    expect(v.hp).toBeLessThan(before);
    setFallen(new Set(['b:5,1,5']));
    runFor(c, 1);
    expect(v.state).not.toBe('sheltered');
  });

  it('nextRound adds a newcomer only when a bed is free and heals everyone', () => {
    const { c, setGraph } = make();
    c.enter(1, 2); // two villagers, two beds: no spare bed
    c.nextRound();
    expect(uiStore.getState()).toMatchObject({ villageRound: 2, villagePopulation: 2 });
    // a second hut gives two more beds
    setGraph(graphOf([...HUT, [8, 0, 9], [10, 0, 9], [9, 0, 8], [9, 1, 9]]));
    c.onBuildChanged();
    expect(uiStore.getState().villageBeds).toBe(4);
    c.nextRound();
    expect(uiStore.getState()).toMatchObject({ villageRound: 3, villagePopulation: 3, villageAlive: 3 });
  });

  it('onRewind mid-run heals and stands everyone back up', () => {
    const { c } = make([]);
    c.enter(1, 1);
    c.onDisasterStarted('medium');
    runFor(c, 5);
    expect(c.getSim().getVillagers()[0]?.hp).toBeLessThan(100);
    c.onRewind();
    expect(c.isRunning()).toBe(false);
    expect(c.getSim().getVillagers()[0]?.hp).toBe(100);
    expect(uiStore.getState()).toMatchObject({ villageAlive: 1, villageCleared: false });
  });

  it('after a loss, restart() brings the villagers back for a new try', () => {
    const { c } = make([]);
    c.enter(1, 1);
    c.onDisasterStarted('strong');
    runFor(c, 10);
    expect(uiStore.getState().villageOver).toBe(true);
    c.onRewind();
    expect(uiStore.getState().villageOver).toBe(true);
    c.restart();
    expect(c.getSim().firstDead()).toBeNull();
    expect(uiStore.getState()).toMatchObject({ villageOver: false, villageAlive: START_POPULATION });
  });

  it('building a wall in build mode updates beds; restart goes back to round 1', () => {
    const { c, setGraph } = make([]);
    c.enter();
    expect(uiStore.getState().villageBeds).toBe(0);
    setGraph(graphOf(HUT));
    c.onBuildChanged();
    expect(uiStore.getState().villageBeds).toBe(2);
    uiStore.setState({ villageRound: 5 });
    c.restart();
    expect(uiStore.getState()).toMatchObject({ villageRound: 1, villagePopulation: START_POPULATION });
  });

  it('sandbox: nobody loses, rounds are off, and rewind stands knocked-out villagers back up', () => {
    const { c } = make([]);
    c.enter(1, 2, true);
    c.onDisasterStarted('strong');
    expect(runFor(c, 10)).toBe(false);
    expect(c.getSim().firstDead()).not.toBeNull();
    expect(uiStore.getState().villageOver).toBe(false);
    c.onRunFinished();
    expect(uiStore.getState().villageCleared).toBe(false);
    expect(memory.has('disaster-village:village:v1')).toBe(false);
    c.onRewind();
    expect(c.getSim().firstDead()).toBeNull();
    expect(uiStore.getState().villageAlive).toBe(2);
    c.restart();
    expect(uiStore.getState().villagePopulation).toBe(6);
  });

  it('does nothing while inactive and hides villagers on leave', () => {
    const { c, view } = make();
    expect(c.tick(1)).toBe(false);
    expect(view.sync).not.toHaveBeenCalled();
    c.enter();
    c.leave();
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(c.isActive()).toBe(false);
  });
});

describe('SessionController village flow', () => {
  const fn = () => vi.fn();
  const makeSession = (blocks: BlockSpec[] = []) => {
    const { c } = make(blocks);
    const deps = {
      audio: { resume: fn(), playUnlock: fn() },
      assets: { setCustomMaterials: fn() },
      build: {
        setConstraints: fn(),
        loadGraph: fn(),
        setMaterial: fn(),
        getGraph: fn(),
        clear: fn(),
        refreshCustomMaterials: fn(),
      },
      companion: { setMode: fn() },
      firstPerson: { spawn: fn(), setArrowKeysEnabled: fn() },
      progression: { computeMaxHp: () => 100, resetSurvivalRewards: fn() },
      currentBlockCenters: () => [],
      ensureBuildMode: fn(),
      rewind: fn(),
      syncBuildEnabled: fn(),
      syncInputPaused: fn(),
      village: c,
      setIsland: fn().mockImplementation((cells: number) => setIslandCells(cells)),
    };
    return { deps, c, s: new SessionController(deps) };
  };

  it('startPlayMode(village) switches to the big island with the village block limit', () => {
    setIslandCells(GRID_CELLS);
    const { deps, c, s } = makeSession();
    s.startPlayMode('village');
    expect(getGridCells()).toBe(VILLAGE_GRID_CELLS);
    expect(deps.build.setConstraints).toHaveBeenLastCalledWith({ maxBlocks: 90 });
    expect(c.isActive()).toBe(true);
    expect(uiStore.getState()).toMatchObject({
      playMode: 'village',
      levelId: null,
      hasStarted: true,
      menuOpen: false,
      villageRound: 1,
    });
  });

  it('startPlayMode(villageCreative) is a limitless sandbox on the big island', () => {
    setIslandCells(GRID_CELLS);
    const { deps, c, s } = makeSession();
    s.startPlayMode('villageCreative');
    expect(getGridCells()).toBe(VILLAGE_GRID_CELLS);
    expect(deps.build.setConstraints).toHaveBeenLastCalledWith(null);
    expect(c.isActive()).toBe(true);
    expect(uiStore.getState()).toMatchObject({
      playMode: 'villageCreative',
      levelId: null,
      hasStarted: true,
    });
    expect(isCreativeSandbox()).toBe(true);
    expect(uiStore.getState().villagePopulation).toBe(6);
  });

  it('leaving village for survival, a level or the menu restores the 8x8 island and clears the build', () => {
    for (const leave of [
      (s: SessionController) => s.startPlayMode('survival'),
      (s: SessionController) => s.startPlayMode('creative'),
      (s: SessionController) => s.selectLevel(null),
      (s: SessionController) => s.exitToMenu(),
    ]) {
      setIslandCells(GRID_CELLS);
      const { deps, c, s } = makeSession();
      s.startPlayMode('village');
      deps.build.loadGraph.mockClear();
      leave(s);
      expect(getGridCells()).toBe(GRID_CELLS);
      expect(c.isActive()).toBe(false);
      expect(deps.build.loadGraph).toHaveBeenCalled();
    }
  });
});
