import {
  Bot,
  CloudLightning,
  Columns2,
  Compass,
  DoorOpen,
  FolderOpen,
  Hammer,
  Map as MapIcon,
  Moon,
  Play,
  Save,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  Swords,
  Trophy,
  User,
  Users,
  Zap,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useUIState } from '../state/store';
import { MenuBackdrop } from './MenuBackdrop';
import type { AddonId, GameActions, MultiplayerMode } from '../types/ui';

const EXTRA_ADDONS: ReadonlyArray<{
  id: AddonId;
  label: string;
  desc: string;
  icon: ReactNode;
  activeBg: string;
  iconActiveBg: string;
  iconIdleBg: string;
  pillActiveBg: string;
}> = [
  {
    id: 'moonGravity',
    label: 'Moon Gravity',
    desc: 'Floaty low-gravity jumps & flying blocks!',
    icon: <Moon size={20} aria-hidden="true" />,
    activeBg: 'bg-indigo-100 ring-2 ring-indigo-500',
    iconActiveBg: 'bg-indigo-500 text-white',
    iconIdleBg: 'bg-indigo-100 text-indigo-900',
    pillActiveBg: 'bg-indigo-600 text-white',
  },
  {
    id: 'turboMode',
    label: 'Turbo Parkour',
    desc: 'Run super fast & leap way higher!',
    icon: <Zap size={20} aria-hidden="true" />,
    activeBg: 'bg-amber-100 ring-2 ring-amber-500',
    iconActiveBg: 'bg-amber-500 text-white',
    iconIdleBg: 'bg-amber-100 text-amber-900',
    pillActiveBg: 'bg-amber-600 text-white',
  },
  {
    id: 'megaStorm',
    label: 'Mega Storm',
    desc: 'Longer 14-second super disasters!',
    icon: <CloudLightning size={20} aria-hidden="true" />,
    activeBg: 'bg-rose-100 ring-2 ring-rose-500',
    iconActiveBg: 'bg-rose-500 text-white',
    iconIdleBg: 'bg-rose-100 text-rose-900',
    pillActiveBg: 'bg-rose-600 text-white',
  },
];

const MP_MODES: ReadonlyArray<{
  id: MultiplayerMode;
  label: string;
  desc: string;
  icon: ReactNode;
}> = [
  { id: 'solo', label: 'Solo', desc: 'Play on your own', icon: <User size={18} aria-hidden="true" /> },
  {
    id: 'coop',
    label: '2P Co-op',
    desc: 'Arrows / Pad / Touch P2',
    icon: <Users size={18} aria-hidden="true" />,
  },
  {
    id: 'split',
    label: '2P Split-Screen',
    desc: 'P1 WASD + mouse, P2 Arrows / Pad (, . turns P2 view)',
    icon: <Columns2 size={18} aria-hidden="true" />,
  },
  {
    id: 'battle',
    label: '2P Battle',
    desc: 'Take turns for stars',
    icon: <Swords size={18} aria-hidden="true" />,
  },
  {
    id: 'bot',
    label: 'AI Bot',
    desc: 'Robo-Buddy helps zap',
    icon: <Bot size={18} aria-hidden="true" />,
  },
];

interface MainMenuProps {
  actions: GameActions;
  onOpenChallenges: () => void;
  onOpenShop: () => void;
}

/** Full-screen mode selection & pause menu over the live 3D island. */
export function MainMenu({ actions, onOpenChallenges, onOpenShop }: MainMenuProps) {
  const s = useUIState();
  const [confirmingExit, setConfirmingExit] = useState(false);
  if (!s.menuOpen) return null;

  return (
    <div
      data-testid="main-menu"
      aria-label="Main Menu"
      className={`pointer-events-auto fixed inset-0 z-20 flex items-center justify-center overflow-y-auto p-4 ${s.hasStarted ? 'bg-sky-950/45 backdrop-blur-sm' : ''}`}
    >
      {!s.hasStarted && <MenuBackdrop />}
      <div className="relative flex w-full max-w-3xl flex-col gap-4 rounded-3xl bg-sky-50/95 p-6 text-sky-950 shadow-2xl ring-2 ring-white/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h1 className="text-3xl font-black tracking-tight text-sky-950">UBS</h1>
              <span className="rounded-full bg-amber-200 px-3 py-0.5 text-xs font-black uppercase tracking-wider text-amber-950">
                Unlock · Build · Survive
              </span>
            </div>
            <p className="text-sm font-bold text-sky-800">
              Build your shelter, step inside in 1st person, and brave the storm!
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {s.hasSave && (
              <button
                type="button"
                data-testid="menu-continue"
                onClick={() => actions.continueGame()}
                className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-emerald-400 px-5 py-2.5 text-sm font-black text-emerald-950 shadow-md transition hover:bg-emerald-300 active:scale-95"
              >
                <FolderOpen size={18} aria-hidden="true" />
                Continue
              </button>
            )}
            {s.hasStarted && (
              <button
                type="button"
                data-testid="menu-save"
                onClick={() => actions.saveGame()}
                className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-sky-500 px-5 py-2.5 text-sm font-black text-white shadow-md transition hover:bg-sky-400 active:scale-95"
              >
                <Save size={18} aria-hidden="true" />
                Save
              </button>
            )}
            {s.hasStarted && (
              <button
                type="button"
                data-testid="menu-exit"
                onClick={() => setConfirmingExit(true)}
                className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-rose-100 px-5 py-2.5 text-sm font-black text-rose-900 shadow-md transition hover:bg-rose-200 active:scale-95"
              >
                <DoorOpen size={18} aria-hidden="true" />
                Exit to Menu
              </button>
            )}
            {s.hasStarted && (
              <button
                type="button"
                data-testid="menu-resume"
                onClick={() => actions.resumeGame()}
                className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-amber-300 px-5 py-2.5 text-sm font-black text-amber-950 shadow-md transition hover:bg-amber-200 active:scale-95"
              >
                <Play size={18} fill="currentColor" aria-hidden="true" />
                Resume
              </button>
            )}
          </div>
        </div>

        {s.hasStarted && confirmingExit && (
          <div
            role="alertdialog"
            aria-label="Exit to menu?"
            data-testid="exit-confirm"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-rose-100 p-3 ring-2 ring-rose-400"
          >
            <p className="text-sm font-black text-rose-950">
              Leave this game? Anything you haven&apos;t saved will be lost (your last save stays safe).
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="exit-cancel"
                onClick={() => setConfirmingExit(false)}
                className="min-h-10 rounded-xl bg-white px-4 py-2 text-sm font-black text-sky-950 shadow-sm active:scale-95"
              >
                Keep Playing
              </button>
              <button
                type="button"
                data-testid="exit-confirm-yes"
                onClick={() => {
                  setConfirmingExit(false);
                  actions.exitToMenu();
                }}
                className="min-h-10 rounded-xl bg-rose-500 px-4 py-2 text-sm font-black text-white shadow-sm active:scale-95"
              >
                Exit without saving
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-black uppercase tracking-wide text-sky-800">Add-Ons</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              data-testid="menu-explore-addon"
              aria-pressed={s.exploreMode}
              onClick={() => actions.setExploreMode(!s.exploreMode)}
              className={`flex items-center justify-between gap-2 rounded-2xl px-3.5 py-2.5 text-left shadow-md transition hover:-translate-y-0.5 active:scale-[0.99] ${
                s.exploreMode ? 'bg-teal-100 ring-2 ring-teal-500' : 'bg-white hover:bg-teal-50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-xl shadow-sm ${
                    s.exploreMode ? 'bg-teal-500 text-white' : 'bg-teal-100 text-teal-900'
                  }`}
                >
                  <Compass size={20} aria-hidden="true" />
                </span>
                <div>
                  <div className="text-sm font-black text-sky-950">Explore Mode</div>
                  <p className="text-[11px] font-semibold text-sky-900">
                    No manual placing! Quick-Builders only.
                  </p>
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-black ${
                  s.exploreMode ? 'bg-teal-600 text-white' : 'bg-sky-100 text-sky-800'
                }`}
              >
                {s.exploreMode ? 'ON' : 'OFF'}
              </span>
            </button>

            {EXTRA_ADDONS.map((addon) => {
              const on = s[addon.id];
              return (
                <button
                  key={addon.id}
                  type="button"
                  data-testid={`addon-${addon.id}`}
                  aria-pressed={on}
                  onClick={() => actions.setAddon(addon.id, !on)}
                  className={`flex items-center justify-between gap-2 rounded-2xl px-3.5 py-2.5 text-left shadow-md transition hover:-translate-y-0.5 active:scale-[0.99] ${
                    on ? addon.activeBg : 'bg-white hover:bg-sky-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-xl shadow-sm ${
                        on ? addon.iconActiveBg : addon.iconIdleBg
                      }`}
                    >
                      {addon.icon}
                    </span>
                    <div>
                      <div className="text-sm font-black text-sky-950">{addon.label}</div>
                      <p className="text-[11px] font-semibold text-sky-900">{addon.desc}</p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-black ${
                      on ? addon.pillActiveBg : 'bg-sky-100 text-sky-800'
                    }`}
                  >
                    {on ? 'ON' : 'OFF'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-1.5 pt-1">
            <span className="text-xs font-black uppercase tracking-wide text-sky-800">
              Multiplayer (Any Device)
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {MP_MODES.map((m) => {
                const active = s.multiplayerMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`mp-${m.id}`}
                    aria-pressed={active}
                    onClick={() => actions.setMultiplayerMode(m.id)}
                    className={`flex flex-col items-start gap-1 rounded-2xl p-2.5 text-left shadow-sm transition active:scale-95 ${
                      active ? 'bg-violet-200 ring-2 ring-violet-500' : 'bg-white hover:bg-violet-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-black text-sky-950">
                      <span
                        className={`flex size-7 items-center justify-center rounded-lg ${
                          active ? 'bg-violet-600 text-white' : 'bg-violet-100 text-violet-900'
                        }`}
                      >
                        {m.icon}
                      </span>
                      <span className="text-xs">{m.label}</span>
                    </div>
                    <span className="text-[11px] font-semibold leading-tight text-sky-800">{m.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-black uppercase tracking-wide text-sky-800">Game Modes</span>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              data-testid="menu-creative"
              onClick={() => actions.startPlayMode('creative')}
              className={`group flex flex-col justify-between gap-3 rounded-3xl p-5 text-left shadow-lg transition hover:-translate-y-0.5 active:scale-[0.98] ${
                s.hasStarted && s.playMode === 'creative' && s.levelId === null
                  ? 'bg-amber-200 ring-2 ring-amber-400'
                  : 'bg-white hover:bg-amber-50'
              }`}
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-300 text-amber-950 shadow-sm">
                    <Hammer size={24} aria-hidden="true" />
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-950">
                    <Sparkles size={13} aria-hidden="true" />
                    All Unlocked
                  </span>
                </div>
                <h2 className="text-xl font-black">Creative Mode</h2>
                <p className="text-sm font-semibold text-sky-900">
                  Build anything with every material, quick-builder, armor, and weapon unlocked. You are
                  invincible during disasters, and Mods are ready to use!
                </p>
              </div>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-2xl bg-amber-300 px-4 py-2 text-sm font-black text-amber-950 shadow-sm">
                Play Creative
              </span>
            </button>

            <button
              type="button"
              data-testid="menu-survival"
              onClick={() => actions.startPlayMode('survival')}
              className={`group flex flex-col justify-between gap-3 rounded-3xl p-5 text-left shadow-lg transition hover:-translate-y-0.5 active:scale-[0.98] ${
                s.hasStarted && s.playMode === 'survival'
                  ? 'bg-rose-100 ring-2 ring-rose-400'
                  : 'bg-white hover:bg-rose-50'
              }`}
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-sm">
                    <ShieldAlert size={24} aria-hidden="true" />
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {s.survivalBestWave > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-black text-rose-900">
                        <Trophy size={13} aria-hidden="true" />
                        Best: Wave {s.survivalBestWave}
                      </span>
                    )}
                    <span className="rounded-full bg-amber-200 px-2.5 py-1 text-xs font-black text-amber-950">
                      {s.points} pts
                    </span>
                  </div>
                </div>
                <h2 className="text-xl font-black">Survival Mode</h2>
                <p className="text-sm font-semibold text-sky-900">
                  Survive escalating disaster waves with real HP and real Shop unlocks. Keep your shelter
                  standing and earn bonus Shop points after every wave!
                </p>
              </div>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-2xl bg-rose-500 px-4 py-2 text-sm font-black text-white shadow-sm">
                Play Survival
              </span>
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-sky-200 pt-3">
          <span className="text-xs font-black uppercase tracking-wide text-sky-800">
            Challenges &amp; Shop
          </span>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="menu-challenges"
                onClick={onOpenChallenges}
                className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-black text-sky-950 shadow-sm transition hover:bg-sky-100 active:scale-95"
              >
                <MapIcon size={18} aria-hidden="true" />
                Challenges
              </button>
              <button
                type="button"
                data-testid="menu-shop"
                onClick={onOpenShop}
                className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-black text-sky-950 shadow-sm transition hover:bg-sky-100 active:scale-95"
              >
                <ShoppingBag size={18} aria-hidden="true" />
                Tech Shop ({s.points} pts)
              </button>
            </div>
            <span className="text-xs font-extrabold text-sky-700">Press Esc anytime to open Menu</span>
          </div>
        </div>
      </div>
    </div>
  );
}
