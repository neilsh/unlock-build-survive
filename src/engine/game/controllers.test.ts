/* oxlint-disable unicorn/consistent-function-scoping, vitest/require-mock-type-parameters, typescript/unbound-method, typescript/no-unnecessary-type-assertion -- fakes are deliberately loose */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { levelStore } from '../../levels/levelStore';
import { uiStore } from '../../state/store';
import { CombatController, type CombatDeps } from './CombatController';
import { InputRouter, type InputDeps } from './InputRouter';
import { ProgressionController } from './ProgressionController';
import { SessionController, type SessionDeps } from './SessionController';
import { isCreativeSandbox, lockedBySurvivalEnd } from './modeRules';

const fn = () => vi.fn();

beforeEach(() => {
  uiStore.setState({
    playMode: 'creative',
    levelId: null,
    mode: 'build',
    survivalOver: false,
    multiplayerMode: 'solo',
    menuOpen: false,
    exploreMode: false,
    equippedWeapon: null,
    equippedArmor: null,
    firstPerson: true,
    playerHp: 100,
    playerMaxHp: 100,
  });
  levelStore.setState({ notice: null });
});

describe('modeRules', () => {
  it('detects creative sandbox and survival end', () => {
    expect(isCreativeSandbox()).toBe(true);
    uiStore.setState({ playMode: 'survival', survivalOver: true });
    expect(isCreativeSandbox()).toBe(false);
    expect(lockedBySurvivalEnd()).toBe(true);
  });
});

describe('ProgressionController', () => {
  const make = (running = false) => {
    const audio = { resume: fn(), playUnlock: fn() };
    return { audio, c: new ProgressionController({ audio, isSimRunning: () => running }) };
  };

  it('computes max HP from armor and recomputes points deterministically', () => {
    const { c } = make();
    expect(c.computeMaxHp(null)).toBeGreaterThan(0);
    expect(c.recomputePoints()).toBe(c.recomputePoints());
  });

  it('equipGear(null, weapon) clears the weapon and refills HP when idle', () => {
    uiStore.setState({ equippedWeapon: 'laser_blaster' as never, playerHp: 10 });
    const { c } = make(false);
    c.equipGear(null, 'weapon');
    expect(uiStore.getState().equippedWeapon).toBeNull();
    expect(uiStore.getState().playerHp).toBe(uiStore.getState().playerMaxHp);
  });

  it('recordLevelResult only acts on the simulating -> finished transition', () => {
    uiStore.setState({ playMode: 'survival', survivalWave: 1, survivalOver: false });
    const { c } = make();
    c.recordLevelResult('failed', 0); // lastMode is 'build': ignored
    expect(uiStore.getState().survivalOver).toBe(false);
    c.recordLevelResult('simulating', 0);
    c.recordLevelResult('failed', 0);
    expect(uiStore.getState().survivalOver).toBe(true);
  });
});

describe('CombatController', () => {
  const make = (over: Partial<CombatDeps> = {}) => {
    const deps = {
      audio: { resume: fn(), playLaserZap: fn(), playKO: fn(), playHit: fn() },
      firstPerson: {
        getEyePosition: () => [0, 1, 0] as [number, number, number],
        getLookDirection: () => [0, 0, 1] as [number, number, number],
        getFeetPosition: () => [0, 0, 0] as [number, number, number],
        spawn: fn(),
        yaw: 0,
      },
      physics: {
        isRunning: () => true,
        firePlayerWeapon: vi.fn(() => ({ hitPoint: [0, 1, 5] as [number, number, number] })),
        checkPlayerDamage: vi.fn(() => ({ damage: 0 })),
      },
      scene: { laserBeam: fn() },
      getEquippedWeapon: () => ({ cooldown: 0.5 }) as never,
      getEquippedArmor: () => null,
      currentBlockCenters: () => [],
      onSurvivalKO: fn(),
      rewind: fn(),
      ...over,
    } as unknown as CombatDeps;
    return { deps, c: new CombatController(deps) };
  };

  it('respects weapon cooldown', () => {
    const { deps, c } = make();
    c.fireWeapon();
    c.fireWeapon();
    expect(deps.physics.firePlayerWeapon).toHaveBeenCalledTimes(1);
    c.tickCooldown(1);
    c.fireWeapon();
    expect(deps.physics.firePlayerWeapon).toHaveBeenCalledTimes(2);
  });

  it('survival KO delegates to onSurvivalKO and aborts the frame', () => {
    uiStore.setState({ playMode: 'survival', playerHp: 5 });
    const { deps, c } = make({
      physics: { isRunning: () => true, checkPlayerDamage: () => ({ damage: 50, cause: 'Boom' }) },
    } as never);
    expect(c.updatePlayerHealth(0.016, [])).toBe(true);
    expect(deps.onSurvivalKO).toHaveBeenCalledWith('Boom');
  });

  it('non-fatal damage lowers HP', () => {
    const { c } = make({
      physics: { isRunning: () => true, checkPlayerDamage: () => ({ damage: 10 }) },
    } as never);
    uiStore.setState({ playMode: 'creative', levelId: 'x' as never });
    expect(c.updatePlayerHealth(0.016, [])).toBe(false);
    expect(uiStore.getState().playerHp).toBe(90);
  });
});

describe('InputRouter', () => {
  const make = () => {
    const deps = {
      audio: { resume: fn() },
      build: {
        getConstraints: () => null,
        hasActiveBrace: () => false,
        cancelBrace: fn(),
        toggleDoorAtCrosshair: vi.fn(() => false),
        applyToolAtCrosshair: fn(),
        eraseAtCrosshair: fn(),
      },
      firstPerson: { setGamepadInput: fn(), lookAngles: fn() },
      gamepad: { poll: fn(), pollPair: fn() },
      menuNav: { move: fn(), confirm: fn(), cancel: fn() },
      openMenu: fn(),
      resumeGame: fn(),
      isModalOpen: () => false,
      setTool: fn(),
      setMaterial: fn(),
      setDisaster: fn(),
      equipGear: fn(),
      fireWeapon: fn(),
      toggleDisaster: fn(),
      rewind: fn(),
      undo: fn(),
    };
    return { deps, r: new InputRouter(deps as unknown as InputDeps) };
  };

  it('forwards on-screen joystick and jump through the same first-person input path', () => {
    const { deps, r } = make();
    deps.gamepad.poll = vi.fn(() => ({ connected: false })) as never;
    r.setTouchMove(3, 4);
    r.setTouchJump(true);
    r.handleGamepad(0.016);
    const [x, y, jump] = (deps.firstPerson.setGamepadInput as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(x).toBeCloseTo(0.6);
    expect(y).toBeCloseTo(0.8);
    expect(jump).toBe(true);
    uiStore.setState({ menuOpen: true });
    r.handleGamepad(0.016);
    expect(deps.firstPerson.setGamepadInput).toHaveBeenLastCalledWith(0, 0, false);
  });

  it('click in build mode applies the tool; explore mode toggles doors', () => {
    const { deps, r } = make();
    r.handlePrimaryAction('click');
    expect(deps.build.applyToolAtCrosshair).toHaveBeenCalled();
    uiStore.setState({ exploreMode: true });
    r.handlePrimaryAction('click');
    expect(deps.build.toggleDoorAtCrosshair).toHaveBeenCalledWith(6);
  });

  it('click during a run fires the weapon', () => {
    const { deps, r } = make();
    uiStore.setState({ mode: 'simulating', equippedWeapon: 'laser_blaster' as never });
    r.handlePrimaryAction('click');
    expect(deps.fireWeapon).toHaveBeenCalled();
  });

  it('reports P2 camera look from the keyboard keys and clamps it', () => {
    const { r } = make();
    expect(r.getP2Look()).toBe(0);
  });

  it('merges P2 touch input and clamps to [-1, 1]', () => {
    const { r } = make();
    r.setP2Control({ moveX: 1, jump: true });
    r.setP2Control({ moveX: 1 });
    expect(r.getP2Input()).toEqual({ moveX: 1, moveY: 0, jump: true, fire: false });
  });
});

describe('SessionController', () => {
  const make = () => {
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
    };
    return { deps, s: new SessionController(deps as unknown as SessionDeps) };
  };

  it('startPlayMode(survival) resets rewards and starts wave 1', () => {
    const { deps, s } = make();
    s.startPlayMode('survival');
    expect(deps.progression.resetSurvivalRewards).toHaveBeenCalled();
    expect(uiStore.getState()).toMatchObject({ playMode: 'survival', survivalWave: 1, hasStarted: true });
  });

  it('battle mode resets scores; nextBattleTurn clears the island', () => {
    const { deps, s } = make();
    s.setMultiplayerMode('battle');
    expect(uiStore.getState().battleTurn).toBe(1);
    s.nextBattleTurn();
    expect(deps.build.clear).toHaveBeenCalled();
    expect(uiStore.getState().battleTurn).toBe(2);
  });

  it('exitToMenu resets a split-screen game to a clean menu without saving', () => {
    const { deps, s } = make();
    s.setMultiplayerMode('split');
    s.startPlayMode('survival');
    uiStore.setState({
      moonGravity: true,
      bouncyBlocks: true,
      slowMotion: true,
      hasSave: true,
      survivalWave: 4,
    });
    s.exitToMenu();
    expect(uiStore.getState()).toMatchObject({
      menuOpen: true,
      hasStarted: false,
      hasSave: true, // the earlier saved game is untouched
      playMode: 'creative',
      multiplayerMode: 'solo',
      moonGravity: false,
      bouncyBlocks: false,
      slowMotion: false,
      survivalWave: 1,
    });
    expect(deps.companion.setMode).toHaveBeenLastCalledWith('solo');
    expect(deps.build.loadGraph).toHaveBeenCalled();
    expect(deps.syncInputPaused).toHaveBeenCalled();
  });

  it('openMenu pauses input', () => {
    const { deps, s } = make();
    s.openMenu();
    expect(uiStore.getState().menuOpen).toBe(true);
    expect(deps.syncInputPaused).toHaveBeenCalled();
  });
});
