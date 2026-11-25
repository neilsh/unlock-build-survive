import { Play, RotateCcw, Sparkles } from 'lucide-react';
import { useMods } from '../mods/modStore';
import { useUIState } from '../state/store';
import { DISASTER_ORDER, DISASTER_SECONDS, STRENGTH_ORDER, type Strength } from '../types/blueprint';
import type { GameActions } from '../types/ui';
import { intToHex } from '../utils/color';
import { Chip } from './Chip';
import { DISASTER_META } from './disasterMeta';

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
  }));
  const { active } = useMods();
  const building = s.mode === 'build';
  const isSurvival = s.playMode === 'survival' && s.levelId === null;
  // Challenge levels fix their own disaster; Survival picks waves automatically.
  const canPick = building && s.levelId === null && !isSurvival;
  const baseIdleSeconds = s.levelId === null && !isSurvival ? active.durationSeconds : DISASTER_SECONDS;
  const idleSeconds = s.megaStorm ? Math.max(baseIdleSeconds, 14) : baseIdleSeconds;
  // Idle shows the full countdown; a finished run shows 0 instead of jumping back to 8.
  const seconds = building
    ? idleSeconds
    : s.mode === 'simulating'
      ? Math.max(0, Math.ceil(s.timeRemaining))
      : 0;
  const actionLabel = isSurvival
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
  const isGoVariant = building || (isSurvival && (s.mode === 'survived' || s.survivalOver));

  return (
    <section
      aria-label="Disasters"
      className="pointer-events-auto flex w-full max-w-4xl flex-wrap items-end justify-center gap-3 rounded-3xl bg-white/85 p-2.5 shadow-xl backdrop-blur"
    >
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

      <div className="flex flex-col items-center gap-1">
        <span className={GROUP_LABEL}>Timer &amp; Test</span>
        <div className="flex items-center gap-2">
          <span
            data-testid="countdown"
            role="timer"
            aria-label={`${seconds} seconds`}
            className="flex h-14 min-w-14 items-center justify-center rounded-full bg-sky-600 px-3 text-2xl font-black tabular-nums text-white shadow-md"
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
    </section>
  );
}
