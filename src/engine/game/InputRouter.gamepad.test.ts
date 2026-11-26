/* oxlint-disable vitest/require-mock-type-parameters -- fakes are deliberately loose */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uiStore } from '../../state/store';
import type { GamepadSnapshot } from '../GamepadManager';
import { InputRouter } from './InputRouter';

const idle: GamepadSnapshot = {
  connected: true,
  id: 'fake',
  moveX: 0,
  moveY: 0,
  lookX: 0,
  lookY: 0,
  jumpHeld: false,
  fireHeld: false,
  primaryPressed: false,
  secondaryPressed: false,
  actionXPressed: false,
  toggleFirstPerson: false,
  toggleDisaster: false,
  menuPressed: false,
  confirmPressed: false,
  navUp: false,
  navDown: false,
  navLeft: false,
  navRight: false,
  backOrUndo: false,
  prevShoulder: false,
  nextShoulder: false,
};
const none: GamepadSnapshot = { ...idle, connected: false, id: null };
const pad = (patch: Partial<GamepadSnapshot>): GamepadSnapshot => ({ ...idle, ...patch });

function make(opts: { poll?: GamepadSnapshot; pair?: [GamepadSnapshot, GamepadSnapshot]; modal?: boolean }) {
  const deps = {
    audio: { resume: vi.fn() },
    build: {
      getConstraints: () => null,
      hasActiveBrace: () => false,
      cancelBrace: vi.fn(),
      toggleDoorAtCrosshair: vi.fn(() => false),
      applyToolAtCrosshair: vi.fn(),
      eraseAtCrosshair: vi.fn(),
    },
    firstPerson: { setGamepadInput: vi.fn(), lookAngles: vi.fn() },
    gamepad: {
      poll: vi.fn(() => opts.poll ?? none),
      pollPair: vi.fn(() => ({ primary: opts.pair?.[0] ?? none, secondary: opts.pair?.[1] ?? none })),
    },
    menuNav: { move: vi.fn(), confirm: vi.fn(), cancel: vi.fn() },
    openMenu: vi.fn(),
    resumeGame: vi.fn(),
    isModalOpen: () => opts.modal ?? false,
    setTool: vi.fn(),
    setMaterial: vi.fn(),
    setDisaster: vi.fn(),
    equipGear: vi.fn(),
    fireWeapon: vi.fn(),
    toggleDisaster: vi.fn(),
    rewind: vi.fn(),
    undo: vi.fn(),
  };
  return { deps, r: new InputRouter(deps) };
}

beforeEach(() => {
  uiStore.setState({
    playMode: 'creative',
    levelId: null,
    mode: 'build',
    survivalOver: false,
    multiplayerMode: 'solo',
    menuOpen: false,
    hasStarted: true,
    exploreMode: false,
    tool: 'block',
    material: 'wood',
  });
});

describe('InputRouter gamepad: solo', () => {
  it('moves, looks and jumps with the sticks and A', () => {
    const { deps, r } = make({ poll: pad({ moveX: 0.5, moveY: 1, lookX: 1, lookY: -1, jumpHeld: true }) });
    r.handleGamepad(0.5);
    expect(deps.firstPerson.setGamepadInput).toHaveBeenLastCalledWith(0.5, 1, true);
    expect(deps.firstPerson.lookAngles).toHaveBeenCalledWith(1.2, -1);
  });

  it('builds with RT, erases with LT, and cycles tool and material', () => {
    const { deps, r } = make({
      poll: pad({ primaryPressed: true, secondaryPressed: true, actionXPressed: true, nextShoulder: true }),
    });
    r.handleGamepad(0.016);
    expect(deps.build.applyToolAtCrosshair).toHaveBeenCalledTimes(1);
    expect(deps.build.eraseAtCrosshair).toHaveBeenCalledTimes(1);
    expect(deps.setTool).toHaveBeenCalledWith('brace');
    expect(deps.setMaterial).toHaveBeenCalledTimes(1);
  });

  it('Select starts the test, B undoes while building', () => {
    const { deps, r } = make({ poll: pad({ toggleDisaster: true, backOrUndo: true }) });
    r.handleGamepad(0.016);
    expect(deps.toggleDisaster).toHaveBeenCalled();
    expect(deps.undo).toHaveBeenCalled();
  });

  it('Start opens the pause menu and stops movement', () => {
    const { deps, r } = make({ poll: pad({ menuPressed: true, moveX: 1 }) });
    r.handleGamepad(0.016);
    expect(deps.openMenu).toHaveBeenCalled();
    expect(deps.firstPerson.setGamepadInput).toHaveBeenLastCalledWith(0, 0, false);
    expect(deps.build.applyToolAtCrosshair).not.toHaveBeenCalled();
  });

  it('while the menu is open, D-pad/A/B drive menu navigation and gameplay is ignored', () => {
    uiStore.setState({ menuOpen: true });
    const { deps, r } = make({
      poll: pad({
        navDown: true,
        navLeft: true,
        confirmPressed: true,
        backOrUndo: true,
        primaryPressed: true,
      }),
    });
    r.handleGamepad(0.016);
    expect(deps.menuNav.move).toHaveBeenCalledWith('down');
    expect(deps.menuNav.move).toHaveBeenCalledWith('left');
    expect(deps.menuNav.confirm).toHaveBeenCalled();
    expect(deps.menuNav.cancel).toHaveBeenCalled();
    expect(deps.build.applyToolAtCrosshair).not.toHaveBeenCalled();
    expect(deps.undo).not.toHaveBeenCalled();
  });

  it('Start resumes a started game from the menu, but not before the game has started', () => {
    uiStore.setState({ menuOpen: true, hasStarted: true });
    const a = make({ poll: pad({ menuPressed: true }) });
    a.r.handleGamepad(0.016);
    expect(a.deps.resumeGame).toHaveBeenCalled();
    uiStore.setState({ hasStarted: false });
    const b = make({ poll: pad({ menuPressed: true }) });
    b.r.handleGamepad(0.016);
    expect(b.deps.resumeGame).not.toHaveBeenCalled();
  });

  it('navigates modals and uses Start to close them', () => {
    const { deps, r } = make({ poll: pad({ navUp: true, menuPressed: true }), modal: true });
    r.handleGamepad(0.016);
    expect(deps.menuNav.move).toHaveBeenCalledWith('up');
    expect(deps.menuNav.cancel).toHaveBeenCalled();
    expect(deps.openMenu).not.toHaveBeenCalled();
  });
});

describe('InputRouter gamepad: two players', () => {
  beforeEach(() => {
    uiStore.setState({ multiplayerMode: 'split' });
  });

  it('a single pad drives only Player 2', () => {
    const { deps, r } = make({
      pair: [pad({ moveX: 1, jumpHeld: true, lookX: 0.5, primaryPressed: true }), none],
    });
    r.handleGamepad(0.016);
    expect(deps.firstPerson.setGamepadInput).toHaveBeenLastCalledWith(0, 0, false);
    expect(deps.build.applyToolAtCrosshair).not.toHaveBeenCalled();
    expect(r.getP2Input()).toMatchObject({ moveX: 1, jump: true });
    expect(r.getP2Look()).toBe(0.5);
    expect(r.takeP2Actions()).toEqual(['place']);
  });

  it('with two pads, pad 1 drives Player 1 and pad 2 drives Player 2', () => {
    const { deps, r } = make({
      pair: [
        pad({ moveY: 1, jumpHeld: true, primaryPressed: true }),
        pad({ moveX: -1, secondaryPressed: true, actionXPressed: true, nextShoulder: true }),
      ],
    });
    r.handleGamepad(0.016);
    expect(deps.firstPerson.setGamepadInput).toHaveBeenLastCalledWith(0, 1, true);
    expect(deps.build.applyToolAtCrosshair).toHaveBeenCalledTimes(1);
    expect(r.getP2Input().moveX).toBe(-1);
    expect(r.takeP2Actions()).toEqual(['erase', 'nextTool', 'nextMaterial']);
  });

  it('Start on either pad opens the menu', () => {
    const { deps, r } = make({ pair: [idle, pad({ menuPressed: true })] });
    r.handleGamepad(0.016);
    expect(deps.openMenu).toHaveBeenCalled();
  });

  it('clears P2 gamepad input when the pad disconnects', () => {
    const { r } = make({ pair: [pad({ moveX: 1 }), none] });
    r.handleGamepad(0.016);
    expect(r.getP2Input().moveX).toBe(1);
    const off = make({ pair: [none, none] });
    off.r.handleGamepad(0.016);
    expect(off.r.getP2Input().moveX).toBe(0);
  });
});
