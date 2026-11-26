import { ChevronDown, ChevronUp, Play, RotateCcw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useMods } from '../mods/modStore';
import { useUIState } from '../state/store';
import {
  DISASTER_ORDER,
  DISASTER_SECONDS,
  STRENGTH_ORDER,
  isBuiltinDisaster,
  type Strength,
} from '../types/blueprint';
import type { GameActions } from '../types/ui';
import { intToHex } from '../utils/color';
import { Chip } from './Chip';
import { DISASTER_META } from './disasterMeta';
import { useCompactLayout } from './useLayout';

const STRENGTHS: Record<Strength, string> = { gentle: 'Gentle', medium: 'Medium', strong: 'Strong' };
const GROUP_LABEL = 'text-[11px] font-black uppercase tracking-wide text-sky-800';

/** Disaster picker, the Test/Rewind button and the countdown. */
export function DisasterPanel({ actions }: { actions: GameActions }) {
  const s = useUIState((u) => ({
    disaster: u.disaster,
    levelId: u.levelId,
    megaStorm: u.megaStorm,
    mode: u.mode,
    playMode: u.playMode,
    strength: u.strength,
    survivalOver: u.survivalOver,
    survivalWave: u.survivalWave,
    timeRemaining: u.timeRemaining,
    villageCleared: u.villageCleared,
    villageOver: u.villageOver,
    villageRound: u.villageRound,
  }));
  const { active } = useMods();
  const compact = useCompactLayout();
  // Compact (phone) layout: just the countdown + Test button, with the disaster / strength pickers in a drawer.
  const [pickerOpen, setPickerOpen] = useState(false);
  const building = s.mode === 'build';
  const isSurvival = s.playMode === 'survival' && s.levelId === null;
  const isVillage = s.playMode === 'village' && s.levelId === null;
  // Challenge levels fix their own disaster; Survival picks waves automatically.
  const canPick = building && s.levelId === null && !isSurvival && !isVillage;
  const baseIdleSeconds =
    s.levelId === null && !isSurvival && !isVillage ? active.durationSeconds : DISASTER_SECONDS;
  const idleSeconds = s.megaStorm ? Math.max(baseIdleSeconds, 14) : baseIdleSeconds;
  // Idle shows the full countdown; a finished run shows 0 instead of jumping back to 8.
  const seconds = building
    ? idleSeconds
    : s.mode === 'simulating'
      ? Math.max(0, Math.ceil(s.timeRemaining))
      : 0;
  const actionLabel = isVillage
    ? s.villageOver
      ? 'Try again'
      : building
        ? `Start Round ${s.villageRound}`
        : s.villageCleared
          ? 'Next Round'
          : 'Rewind'
    : isSurvival
      ? s.survivalOver
        ? 'Retry Wave 1'
        : building
          ? `Start Wave ${s.survivalWave}`
          : s.mode === 'survived'
            ? 'Next Wave'
            : 'Rewind'
      : building
        ? 'Test it!'
        : 'Rewind';
  const isGoVariant =
    building ||
    (isSurvival && (s.mode === 'survived' || s.survivalOver)) ||
    (isVillage && (s.villageCleared || s.villageOver));

  const pickers = (
    <>
      <div className="flex flex-col items-center gap-1">
        <span className={GROUP_LABEL}>Disasters</span>
        <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Pick a disaster">
          {DISASTER_ORDER.map((d) => (
            <Chip
              key={d}
              testId={`disaster-${d}`}
              label={DISASTER_META[d].shortLabel}
              icon={DISASTER_META[d].icon(22)}
              active={s.disaster === d}
              disabled={!canPick}
              onClick={() => actions.setDisaster(d)}
            />
          ))}
          {s.levelId === null &&
            !isSurvival &&
            !isVillage &&
            active.disasters.map((d) => (
              <Chip
                key={d.id}
                testId={`disaster-${d.id}`}
                label={d.label}
                icon={<Sparkles size={22} style={{ color: intToHex(d.color) }} />}
                active={s.disaster === d.id}
                disabled={!canPick}
                onClick={() => actions.setDisaster(d.id)}
              />
            ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1">
        <span className={GROUP_LABEL}>Strength</span>
        <div className="flex gap-2" role="group" aria-label="Pick a strength">
          {STRENGTH_ORDER.map((st) => (
            <Chip
              key={st}
              testId={`strength-${st}`}
              label={STRENGTHS[st]}
              active={s.strength === st}
              disabled={!canPick}
              onClick={() => actions.setStrength(st)}
            />
          ))}
        </div>
      </div>
    </>
  );

  const custom = active.disasters.find((d) => d.id === s.disaster);
  const builtin = isBuiltinDisaster(s.disaster) ? DISASTER_META[s.disaster] : undefined;
  const currentLabel = builtin?.shortLabel ?? custom?.label ?? 'Disaster';

  const timerAndTest = (
    <div className="flex flex-col items-center gap-1">
      <span className={`${GROUP_LABEL} compact:hidden`}>Timer &amp; Test</span>
      <div className="flex items-center gap-2">
        <span
          data-testid="countdown"
          role="timer"
          aria-label={`${seconds} seconds`}
          className="flex h-14 min-w-14 items-center justify-center rounded-full bg-sky-600 px-3 text-2xl font-black tabular-nums text-white shadow-md compact:h-12 compact:min-w-12 compact:text-xl"
        >
          {seconds}
        </span>
        <Chip
          testId="test-disaster"
          label={actionLabel}
          icon={isGoVariant ? <Play size={22} fill="currentColor" /> : <RotateCcw size={22} />}
          variant={isGoVariant ? 'go' : 'rewind'}
          onClick={() => actions.toggleDisaster()}
        />
      </div>
    </div>
  );

  if (compact) {
    return (
      <section
        aria-label="Disasters"
        className="pointer-events-auto flex max-w-full flex-col items-stretch gap-2 rounded-3xl bg-white/85 p-2 shadow-xl backdrop-blur"
      >
        {canPick && pickerOpen && (
          <div
            data-testid="disaster-picker"
            className="ubs-scroll flex max-h-[calc(100dvh-8.5rem)] flex-col items-center gap-2 rounded-2xl bg-sky-50/90 p-2"
          >
            {pickers}
          </div>
        )}
        <div className="flex items-center justify-center gap-2">
          {canPick && (
            <button
              type="button"
              data-testid="disaster-picker-toggle"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((o) => !o)}
              className="flex min-h-12 items-center gap-1.5 rounded-2xl bg-white px-3 text-xs font-extrabold text-sky-900 shadow-md active:scale-95"
            >
              {builtin ? builtin.icon(20) : <Sparkles size={20} />}
              <span>{currentLabel}</span>
              {pickerOpen ? (
                <ChevronDown size={16} aria-hidden="true" />
              ) : (
                <ChevronUp size={16} aria-hidden="true" />
              )}
            </button>
          )}
          {timerAndTest}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Disasters"
      className="pointer-events-auto flex w-full max-w-4xl flex-wrap items-end justify-center gap-3 rounded-3xl bg-white/85 p-2.5 shadow-xl backdrop-blur"
    >
      {pickers}
      {timerAndTest}
    </section>
  );
}
