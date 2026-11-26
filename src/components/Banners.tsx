import { Play, RotateCcw, Skull, Star, Trophy } from 'lucide-react';
import { useUIState } from '../state/store';
import type { Stars } from '../types/blueprint';
import type { GameActions } from '../types/ui';
import { StandingSparkline } from './StandingSparkline';

const COPY: Record<Stars, { title: string; hint: string }> = {
  0: { title: 'Good try!', hint: 'Rewind and see what you can make stronger.' },
  1: { title: 'Nice start!', hint: 'Some of it held. Can you keep even more standing?' },
  2: { title: 'Great job!', hint: 'Most of your building made it. So close to three!' },
  3: { title: 'Amazing!', hint: 'Your whole building stood strong!' },
};

/** Centred result banner with 0-3 stars and Survival wave transitions. */
export function Banners({ actions }: { actions: GameActions }) {
  const s = useUIState((u) => ({
    firstBrokenId: u.firstBrokenId,
    levelId: u.levelId,
    mode: u.mode,
    playMode: u.playMode,
    standingHistory: u.standingHistory,
    standingRatio: u.standingRatio,
    stars: u.stars,
    survivalBestWave: u.survivalBestWave,
    survivalFailReason: u.survivalFailReason,
    survivalLastReward: u.survivalLastReward,
    survivalOver: u.survivalOver,
    survivalWave: u.survivalWave,
    villageAlive: u.villageAlive,
    villageBestRound: u.villageBestRound,
    villageCleared: u.villageCleared,
    villageFailReason: u.villageFailReason,
    villageOver: u.villageOver,
    villagePopulation: u.villagePopulation,
    villageRound: u.villageRound,
  }));
  const isSurvival = s.playMode === 'survival' && s.levelId === null;
  const isVillage = s.playMode === 'village' && s.levelId === null;

  if (isVillage) {
    if (s.villageOver) {
      return (
        <div
          data-testid="village-over-banner"
          role="status"
          className="pointer-events-auto flex flex-col items-center gap-2.5 rounded-3xl bg-white/95 px-6 py-4 compact:max-w-[22rem] compact:gap-1 compact:px-4 compact:py-2 text-center text-sky-950 shadow-2xl"
        >
          <div className="flex items-center gap-2 text-rose-600">
            <Skull size={32} aria-hidden="true" />
            <span data-testid="lose-banner" className="text-2xl font-black">
              Round {s.villageRound}: Village Lost
            </span>
          </div>
          <span className="text-sm font-bold text-sky-900">{s.villageFailReason}</span>
          <button
            type="button"
            data-testid="village-retry"
            onClick={() => actions.toggleDisaster()}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-rose-500 px-4 py-2 text-sm font-black text-white shadow-md hover:bg-rose-400 active:scale-95"
          >
            <RotateCcw size={16} aria-hidden="true" />
            Try again from Round 1
          </button>
        </div>
      );
    }
    if (s.villageCleared) {
      return (
        <div
          data-testid="village-cleared-banner"
          role="status"
          className="pointer-events-auto flex flex-col items-center gap-2 rounded-3xl bg-white/95 px-6 py-4 compact:max-w-[22rem] compact:gap-1 compact:px-4 compact:py-2 text-center text-sky-950 shadow-2xl"
        >
          <span data-testid="win-banner" className="text-2xl font-black text-emerald-700">
            Round {s.villageRound} Cleared!
          </span>
          <span className="text-sm font-bold">All {s.villageAlive} villagers are safe.</span>
          <button
            type="button"
            data-testid="village-next-round"
            onClick={() => actions.toggleDisaster()}
            className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-emerald-400 px-5 py-2 text-sm font-black text-emerald-950 shadow-md hover:bg-emerald-300 active:scale-95"
          >
            <Play size={16} fill="currentColor" aria-hidden="true" />
            Next Round (Round {s.villageRound + 1})
          </button>
        </div>
      );
    }
    return null;
  }

  if (isSurvival && s.survivalOver) {
    return (
      <div
        data-testid="survival-over-banner"
        role="status"
        className="pointer-events-auto flex flex-col items-center gap-2.5 rounded-3xl bg-white/95 px-6 py-4 compact:max-w-[22rem] compact:gap-1 compact:px-4 compact:py-2 text-center text-sky-950 shadow-2xl"
      >
        <div className="flex items-center gap-2 text-rose-600">
          <Skull size={32} aria-hidden="true" />
          <span data-testid="lose-banner" className="text-2xl font-black">
            Wave {s.survivalWave} Failed
          </span>
        </div>
        <span className="text-sm font-bold text-sky-900">
          {s.survivalFailReason ?? 'Your building collapsed!'}
        </span>
        {s.survivalBestWave > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-900">
            <Trophy size={13} aria-hidden="true" />
            Best: Wave {s.survivalBestWave}
          </span>
        )}
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <button
            type="button"
            data-testid="survival-retry"
            onClick={() => actions.restartSurvival()}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-rose-500 px-4 py-2 text-sm font-black text-white shadow-md hover:bg-rose-400 active:scale-95"
          >
            <RotateCcw size={16} aria-hidden="true" />
            Retry Wave 1
          </button>
          <button
            type="button"
            data-testid="survival-menu"
            onClick={() => actions.openMenu()}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-sky-100 px-4 py-2 text-sm font-black text-sky-950 shadow-md hover:bg-sky-200 active:scale-95"
          >
            Main Menu
          </button>
        </div>
      </div>
    );
  }

  if (s.mode !== 'survived' && s.mode !== 'failed') return null;

  const copy = COPY[s.stars];
  const hint = s.stars < 3 && s.firstBrokenId ? 'Look for the glowing piece that gave way first.' : copy.hint;
  const percent = Math.round(s.standingRatio * 100);

  if (isSurvival && s.mode === 'survived') {
    return (
      <div
        data-testid="result-banner"
        role="status"
        className="pointer-events-auto flex flex-col items-center gap-2 rounded-3xl bg-white/95 px-6 py-4 compact:max-w-[22rem] compact:gap-1 compact:px-4 compact:py-2 text-center text-sky-950 shadow-2xl"
      >
        <div data-testid="star-row" aria-label={`${s.stars} out of 3 stars`} className="flex gap-1">
          {([1, 2, 3] as const).map((n) => (
            <Star
              key={n}
              data-testid={n <= s.stars ? 'star-earned' : 'star-empty'}
              size={40}
              aria-hidden
              className={n <= s.stars ? 'fill-amber-300 text-amber-400' : 'fill-sky-100 text-sky-200'}
            />
          ))}
        </div>
        <span data-testid="win-banner" className="text-2xl font-black text-emerald-700">
          Wave {s.survivalWave} Cleared!
        </span>
        <span className="rounded-full bg-amber-200 px-3 py-0.5 text-xs font-black text-amber-950">
          +{s.survivalLastReward} pts earned
        </span>
        <span data-testid="standing-percent" className="text-xs font-extrabold text-sky-700">
          {percent}% of your building held
        </span>
        <StandingSparkline values={s.standingHistory} />
        <button
          type="button"
          data-testid="survival-next-wave"
          onClick={() => actions.nextSurvivalWave()}
          className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-emerald-400 px-5 py-2 text-sm font-black text-emerald-950 shadow-md hover:bg-emerald-300 active:scale-95"
        >
          <Play size={16} fill="currentColor" aria-hidden="true" />
          Next Wave (Wave {s.survivalWave + 1})
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="result-banner"
      role="status"
      className="pointer-events-none flex flex-col items-center gap-2 rounded-3xl bg-white/95 px-6 py-4 compact:max-w-[22rem] compact:gap-1 compact:px-4 compact:py-2 text-center text-sky-950 shadow-2xl"
    >
      <div data-testid="star-row" aria-label={`${s.stars} out of 3 stars`} className="flex gap-1">
        {([1, 2, 3] as const).map((n) => (
          <Star
            key={n}
            data-testid={n <= s.stars ? 'star-earned' : 'star-empty'}
            size={44}
            aria-hidden
            className={n <= s.stars ? 'fill-amber-300 text-amber-400' : 'fill-sky-100 text-sky-200'}
          />
        ))}
      </div>
      <span
        data-testid={s.mode === 'survived' ? 'win-banner' : 'lose-banner'}
        className="text-2xl font-black"
      >
        {copy.title}
      </span>
      <span className="text-sm font-bold">{hint}</span>
      <span data-testid="standing-percent" className="text-xs font-extrabold text-sky-700">
        {percent}% of your building was still standing
      </span>
      <StandingSparkline values={s.standingHistory} />
    </div>
  );
}
