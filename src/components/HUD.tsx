/**
 * OWNER: package E (Tailwind HUD). Contract: props below. Read state with `useUIState()`, call
 * `actions` for everything. Every interactive control needs a `data-testid`:
 * tool-block|brace|paint|erase, mirror-x, undo, clear-island, material-wood|stone|bamboo|foam,
 * disaster-earthquake|hurricane|flood|hail, preset-empty|house|tower, test-disaster (also Rewind),
 * countdown, strength-gentle|medium|strong, result-banner (title is win-banner/lose-banner), standing-percent, star-row, standing-sparkline, cam-front|right|back|left, mute-toggle.
 * Must not import three, Rapier or anything under src/engine.
 *
 * The HUD root ignores pointer events so the 3D view stays draggable everywhere except on the cards.
 */
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  CloudLightning,
  Columns2,
  Compass,
  Crosshair,
  Heart,
  Menu,
  Moon,
  RotateCcw,
  Save,
  Shield,
  Sparkles,
  Swords,
  Users,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLevelInfo } from '../levels/levelStore';
import { useUIState } from '../state/store';
import { ARMORS, WEAPONS } from '../types/gear';
import { isTwoPlayerCoop, type GameActions } from '../types/ui';
import { Banners } from './Banners';
import { BuildPanel } from './BuildPanel';
import { CameraPanel } from './CameraPanel';
import { DisasterPanel } from './DisasterPanel';
import { LevelPanel } from './LevelPanel';
import { VillagePanel } from './VillagePanel';
import { MainMenu } from './MainMenu';
import { P2Panel } from './P2Panel';
import { ModsPanel } from './ModsPanel';
import { ShopPanel } from './ShopPanel';
import { TouchControls, useIsTouchDevice } from './TouchControls';

export function HUD({ actions }: { actions: GameActions }) {
  const s = useUIState();
  const info = useLevelInfo();
  const [clearedFlash, setClearedFlash] = useState(0);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const flashing = s.damageFlash > clearedFlash;
  const isTouch = useIsTouchDevice();

  useEffect(() => {
    if (s.damageFlash <= clearedFlash) return;
    const id = window.setTimeout(() => setClearedFlash(s.damageFlash), 260);
    return () => window.clearTimeout(id);
  }, [s.damageFlash, clearedFlash]);

  const [clearedFlash2, setClearedFlash2] = useState(0);
  const flashing2 = s.p2DamageFlash > clearedFlash2;
  useEffect(() => {
    if (s.p2DamageFlash <= clearedFlash2) return;
    const id = window.setTimeout(() => setClearedFlash2(s.p2DamageFlash), 260);
    return () => window.clearTimeout(id);
  }, [s.p2DamageFlash, clearedFlash2]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (levelsOpen || shopOpen || document.querySelector('[role="dialog"]')) return;
      if (s.menuOpen) {
        if (s.hasStarted) actions.resumeGame();
      } else {
        actions.openMenu();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, levelsOpen, shopOpen, s.menuOpen, s.hasStarted]);

  const split = s.multiplayerMode === 'split';
  const isVillage = s.playMode === 'village' && s.levelId === null;
  const isSurvival = s.playMode === 'survival' && s.levelId === null;
  const creativeSandbox = s.playMode === 'creative' && s.levelId === null;
  const hpPct = Math.max(0, Math.min(100, (s.playerHp / s.playerMaxHp) * 100));
  const hpColor = hpPct > 60 ? 'bg-emerald-500' : hpPct > 30 ? 'bg-amber-400' : 'bg-rose-500';

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-sans text-sky-950">
      {s.firstPerson && flashing && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed inset-y-0 left-0 z-10 bg-rose-600/35 ring-8 ring-inset ring-rose-500/60 ${split ? 'w-1/2' : 'w-full'}`}
        />
      )}
      {split && !s.menuOpen && flashing2 && (
        <div
          aria-hidden="true"
          data-testid="p2-damage-flash"
          className="pointer-events-none fixed inset-y-0 right-0 z-10 w-1/2 bg-rose-600/35 ring-8 ring-inset ring-rose-500/60"
        />
      )}

      {s.firstPerson && !s.menuOpen && (
        <div
          data-testid="fp-crosshair"
          aria-hidden="true"
          className={`pointer-events-none fixed inset-y-0 left-0 flex items-center justify-center ${split ? 'w-1/2' : 'w-full'}`}
        >
          <div className="relative flex size-6 items-center justify-center">
            <span className="h-0.5 w-5 rounded-full bg-white/90 shadow" />
            <span className="absolute h-5 w-0.5 rounded-full bg-white/90 shadow" />
            <span className="absolute size-2 rounded-full border-2 border-amber-300" />
          </div>
        </div>
      )}

      {split && !s.menuOpen && (
        <div data-testid="split-overlay" aria-hidden="true" className="pointer-events-none fixed inset-0">
          <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-white shadow-[0_0_8px_rgba(0,0,0,0.5)]" />
          <span className="absolute bottom-3 left-3 rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-amber-950 shadow">
            P1 · WASD + mouse
          </span>
          <span className="absolute bottom-3 right-3 rounded-full bg-cyan-300 px-3 py-1 text-xs font-black text-cyan-950 shadow">
            P2 · Arrows + Enter
          </span>
        </div>
      )}

      {split && !s.menuOpen && <P2Panel actions={actions} />}

      <div className="absolute left-2 top-16">
        <BuildPanel actions={actions} />
      </div>

      <div className="absolute inset-x-2 top-2 flex flex-wrap items-start justify-center gap-2">
        <button
          type="button"
          data-testid="menu-open"
          onClick={() => actions.openMenu()}
          className="pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-2xl bg-white/90 px-3.5 text-sm font-extrabold shadow-md backdrop-blur active:scale-95"
        >
          <Menu size={18} aria-hidden="true" />
          <span>Menu</span>
        </button>

        <button
          type="button"
          data-testid="hud-save"
          onClick={() => actions.saveGame()}
          className="pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-2xl bg-sky-500 px-3.5 text-sm font-extrabold text-white shadow-md transition hover:bg-sky-400 active:scale-95"
        >
          <Save size={17} aria-hidden="true" />
          <span>Save</span>
        </button>

        <span
          data-testid="mode-badge"
          className={`flex min-h-11 items-center gap-1.5 rounded-2xl px-3.5 text-xs font-black shadow-md backdrop-blur ${
            isVillage
              ? 'bg-emerald-600 text-white'
              : isSurvival
                ? 'bg-rose-500 text-white'
                : s.levelId !== null
                  ? 'bg-sky-600 text-white'
                  : 'bg-amber-300 text-amber-950'
          }`}
        >
          Mode:{' '}
          {isVillage
            ? `Village Island · Round ${s.villageRound}`
            : isSurvival
              ? `Survival · Wave ${s.survivalWave}${s.survivalBestWave > 0 ? ` · Best ${s.survivalBestWave}` : ''}`
              : s.levelId !== null
                ? 'Challenge'
                : 'Creative'}
        </span>

        {s.exploreMode && (
          <span
            data-testid="explore-badge"
            className="flex min-h-11 items-center gap-1.5 rounded-2xl bg-teal-600 px-3.5 text-xs font-black text-white shadow-md backdrop-blur"
          >
            <Compass size={16} aria-hidden="true" />
            Add-On: Explore
          </span>
        )}

        {s.moonGravity && (
          <span
            data-testid="addon-badge-moon"
            className="flex min-h-11 items-center gap-1.5 rounded-2xl bg-indigo-600 px-3 text-xs font-black text-white shadow-md backdrop-blur"
          >
            <Moon size={15} aria-hidden="true" />
            Moon
          </span>
        )}

        {s.turboMode && (
          <span
            data-testid="addon-badge-turbo"
            className="flex min-h-11 items-center gap-1.5 rounded-2xl bg-amber-500 px-3 text-xs font-black text-amber-950 shadow-md backdrop-blur"
          >
            <Zap size={15} aria-hidden="true" />
            Turbo
          </span>
        )}

        {s.megaStorm && (
          <span
            data-testid="addon-badge-megastorm"
            className="flex min-h-11 items-center gap-1.5 rounded-2xl bg-rose-600 px-3 text-xs font-black text-white shadow-md backdrop-blur"
          >
            <CloudLightning size={15} aria-hidden="true" />
            Mega Storm
          </span>
        )}

        {s.multiplayerMode !== 'solo' && (
          <span
            data-testid="mp-badge"
            className="flex min-h-11 items-center gap-1.5 rounded-2xl bg-violet-600 px-3.5 text-xs font-black text-white shadow-md backdrop-blur"
          >
            {s.multiplayerMode === 'coop' ? (
              <Users size={16} aria-hidden="true" />
            ) : split ? (
              <Columns2 size={16} aria-hidden="true" />
            ) : s.multiplayerMode === 'battle' ? (
              <Swords size={16} aria-hidden="true" />
            ) : (
              <Bot size={16} aria-hidden="true" />
            )}
            {s.multiplayerMode === 'coop'
              ? 'Multiplayer: 2P Co-op'
              : split
                ? 'Multiplayer: 2P Split-Screen'
                : s.multiplayerMode === 'battle'
                  ? 'Multiplayer: 2P Battle'
                  : 'Multiplayer: AI Bot'}
          </span>
        )}

        <LevelPanel
          actions={actions}
          open={levelsOpen}
          onOpenChange={setLevelsOpen}
          hideButton={isSurvival || isVillage}
          extra={
            <>
              <ShopPanel actions={actions} open={shopOpen} onOpenChange={setShopOpen} />
              {!isSurvival && !isVillage && <ModsPanel actions={actions} />}
            </>
          }
        />
        {isVillage && <VillagePanel />}
      </div>

      <div className="absolute right-2 top-16">
        <CameraPanel actions={actions} />
      </div>

      {s.multiplayerMode === 'battle' && !s.menuOpen && (
        <div className="pointer-events-none fixed inset-x-2 top-16 flex justify-center">
          <div
            data-testid="battle-scoreboard"
            className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl bg-white/95 px-3.5 py-2 text-xs font-black shadow-lg backdrop-blur"
          >
            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-violet-950">
              Round {s.battleRound}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 ${
                s.battleTurn === 1
                  ? 'bg-amber-300 text-amber-950 ring-2 ring-amber-500'
                  : 'bg-sky-100 text-sky-900'
              }`}
            >
              P1: {s.battleP1Score} ★
            </span>
            <span
              className={`rounded-full px-2.5 py-1 ${
                s.battleTurn === 2
                  ? 'bg-cyan-300 text-cyan-950 ring-2 ring-cyan-500'
                  : 'bg-sky-100 text-sky-900'
              }`}
            >
              P2: {s.battleP2Score} ★
            </span>
            <span className="text-sky-800">Turn: Player {s.battleTurn}</span>
            {s.battleTurn === 1 && s.battleP1Done && (
              <button
                type="button"
                data-testid="battle-next-turn"
                onClick={() => actions.nextBattleTurn()}
                className="rounded-xl bg-emerald-400 px-3 py-1 text-emerald-950 shadow-sm hover:bg-emerald-300 active:scale-95"
              >
                Pass to Player 2
              </button>
            )}
            {s.battleTurn === 2 && s.battleP2Done && (
              <button
                type="button"
                data-testid="battle-next-turn"
                onClick={() => actions.nextBattleTurn()}
                className="rounded-xl bg-amber-300 px-3 py-1 text-amber-950 shadow-sm hover:bg-amber-200 active:scale-95"
              >
                {s.battleP1Score === s.battleP2Score
                  ? 'Tie! Next Round'
                  : s.battleP1Score > s.battleP2Score
                    ? 'P1 Leads! Next Round'
                    : 'P2 Leads! Next Round'}
              </button>
            )}
            <button
              type="button"
              data-testid="battle-reset"
              aria-label="Reset Battle"
              onClick={() => actions.resetBattle()}
              className="inline-flex items-center gap-1 rounded-xl bg-sky-100 px-2.5 py-1 text-sky-900 hover:bg-sky-200 active:scale-95"
            >
              <RotateCcw size={13} aria-hidden="true" />
              Reset
            </button>
          </div>
        </div>
      )}

      {isTouch && s.firstPerson && !s.menuOpen && <TouchControls actions={actions} />}

      {isTwoPlayerCoop(s.multiplayerMode) && !s.menuOpen && (
        <div
          data-testid="p2-touch-pad"
          aria-label="Player 2 controls"
          className="pointer-events-auto fixed bottom-28 right-2 z-10 flex flex-col items-center gap-1.5 rounded-3xl bg-white/90 p-2.5 text-xs font-black shadow-xl backdrop-blur"
        >
          <span className="text-[10px] font-black uppercase tracking-wide text-cyan-800">P2 Controls</span>
          {s.gamepadConnected && (
            <span data-testid="p2-gamepad-hint" className="max-w-40 text-center text-[10px] text-cyan-900">
              Gamepad: 1 pad = P2 · 2 pads = P1 + P2 · RT build · LT erase · X tool · RB mat
            </span>
          )}
          <div className="grid grid-cols-3 gap-1">
            <span />
            <button
              type="button"
              aria-label="P2 Forward"
              onPointerDown={() => actions.setP2Control({ moveY: 1 })}
              onPointerUp={() => actions.setP2Control({ moveY: 0 })}
              onPointerLeave={() => actions.setP2Control({ moveY: 0 })}
              onPointerCancel={() => actions.setP2Control({ moveY: 0 })}
              className="flex size-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-950 active:bg-cyan-300"
            >
              <ArrowUp size={16} />
            </button>
            <span />
            <button
              type="button"
              aria-label="P2 Left"
              onPointerDown={() => actions.setP2Control({ moveX: -1 })}
              onPointerUp={() => actions.setP2Control({ moveX: 0 })}
              onPointerLeave={() => actions.setP2Control({ moveX: 0 })}
              onPointerCancel={() => actions.setP2Control({ moveX: 0 })}
              className="flex size-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-950 active:bg-cyan-300"
            >
              <ArrowLeft size={16} />
            </button>
            <button
              type="button"
              aria-label="P2 Back"
              onPointerDown={() => actions.setP2Control({ moveY: -1 })}
              onPointerUp={() => actions.setP2Control({ moveY: 0 })}
              onPointerLeave={() => actions.setP2Control({ moveY: 0 })}
              onPointerCancel={() => actions.setP2Control({ moveY: 0 })}
              className="flex size-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-950 active:bg-cyan-300"
            >
              <ArrowDown size={16} />
            </button>
            <button
              type="button"
              aria-label="P2 Right"
              onPointerDown={() => actions.setP2Control({ moveX: 1 })}
              onPointerUp={() => actions.setP2Control({ moveX: 0 })}
              onPointerLeave={() => actions.setP2Control({ moveX: 0 })}
              onPointerCancel={() => actions.setP2Control({ moveX: 0 })}
              className="flex size-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-950 active:bg-cyan-300"
            >
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="P2 Jump"
              onPointerDown={() => actions.setP2Control({ jump: true })}
              onPointerUp={() => actions.setP2Control({ jump: false })}
              onPointerLeave={() => actions.setP2Control({ jump: false })}
              onPointerCancel={() => actions.setP2Control({ jump: false })}
              className="rounded-xl bg-sky-200 px-2.5 py-1.5 text-[11px] font-black text-sky-950 active:bg-sky-300"
            >
              Jump
            </button>
            <button
              type="button"
              aria-label="P2 Zap"
              onPointerDown={() => actions.setP2Control({ fire: true })}
              onPointerUp={() => actions.setP2Control({ fire: false })}
              onPointerLeave={() => actions.setP2Control({ fire: false })}
              onPointerCancel={() => actions.setP2Control({ fire: false })}
              className="inline-flex items-center gap-0.5 rounded-xl bg-amber-300 px-2.5 py-1.5 text-[11px] font-black text-amber-950 active:bg-amber-400"
            >
              <Zap size={12} aria-hidden="true" />
              Zap
            </button>
          </div>
          <span className="text-[10px] font-bold text-sky-700">Arrows + R-Shift + Enter / Pad</span>
        </div>
      )}

      {/* The result banner and FP HP bar stack just above the disaster bar so they never hide the building. */}
      <div className="absolute inset-x-2 bottom-2 flex flex-col items-center gap-2">
        {s.levelId === null && info.notice && (
          <p
            role="status"
            data-testid="freebuild-notice"
            className="rounded-2xl bg-orange-100/95 px-4 py-1.5 text-sm font-extrabold text-orange-950 shadow-lg"
          >
            {info.notice}
          </p>
        )}
        <Banners actions={actions} />
        {s.firstPerson && (
          <div
            data-testid="player-hp"
            className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/90 px-3.5 py-2 text-xs font-extrabold shadow-lg backdrop-blur"
          >
            {creativeSandbox ? (
              <span
                data-testid="creative-invincible"
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-sm font-black text-emerald-950"
              >
                <Sparkles size={16} aria-hidden="true" className="text-amber-500" />
                Creative · Invincible
              </span>
            ) : (
              <>
                <span className="flex items-center gap-1.5 text-sm font-black">
                  <Heart size={18} aria-hidden="true" className="fill-rose-500 text-rose-500" />
                  {split ? 'P1 ' : ''}HP {Math.ceil(s.playerHp)} / {s.playerMaxHp}
                </span>
                <div className="h-3 w-36 overflow-hidden rounded-full bg-sky-100 shadow-inner">
                  <div
                    className={`h-full transition-all duration-150 ${hpColor}`}
                    style={{ width: `${hpPct}%` }}
                  />
                </div>
              </>
            )}
            {s.equippedArmor && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-sky-900">
                <Shield size={13} aria-hidden="true" />
                {ARMORS[s.equippedArmor].label}
              </span>
            )}
            {s.equippedWeapon && (
              <button
                type="button"
                data-testid="fp-fire-weapon"
                onClick={() => actions.fireWeapon()}
                className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-amber-300 px-2.5 py-0.5 font-black text-amber-950 shadow-sm hover:bg-amber-200 active:scale-95"
              >
                <Crosshair size={13} aria-hidden="true" />
                {WEAPONS[s.equippedWeapon].label} · Fire (F)
              </button>
            )}
            <span className="text-sky-700">
              Controls:{' '}
              {s.gamepadConnected
                ? s.mode === 'build'
                  ? s.exploreMode
                    ? 'L-Stick move · R-Stick look · A jump · RT door · Select test · Start menu'
                    : 'L-Stick move · R-Stick look · A jump · RT build · LT erase · X tool · LB/RB mat · B undo · Select test · Start menu'
                  : `L-Stick move · R-Stick look · A jump${s.equippedWeapon ? ' · RT/X fire · LB/RB gear' : ''} · B rewind · Start menu`
                : s.mode === 'build'
                  ? s.exploreMode
                    ? `WASD move · Space jump · Drag look · Click door${s.equippedWeapon ? ' · F fire' : ''}`
                    : `WASD move · Space jump · Drag look · Click build${s.equippedWeapon ? ' · F fire' : ''}`
                  : `WASD move · Space jump · Drag look${s.equippedWeapon ? ' · Click/F fire' : ''}`}
            </span>
          </div>
        )}
        <DisasterPanel actions={actions} />
      </div>

      <MainMenu
        actions={actions}
        onOpenChallenges={() => setLevelsOpen(true)}
        onOpenShop={() => setShopOpen(true)}
      />
    </div>
  );
}
