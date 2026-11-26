import { Home, Users } from 'lucide-react';
import { useLevelInfo } from '../levels/levelStore';
import { VILLAGE_CONSTRAINTS } from '../levels/village';
import { useUIState } from '../state/store';

/** Village Island status card: round, villagers standing, spare beds, block budget and a hint. */
export function VillagePanel() {
  const s = useUIState((u) => ({
    alive: u.villageAlive,
    beds: u.villageBeds,
    best: u.villageBestRound,
    cleared: u.villageCleared,
    mode: u.mode,
    over: u.villageOver,
    population: u.villagePopulation,
    round: u.villageRound,
  }));
  const info = useLevelInfo();
  const max = VILLAGE_CONSTRAINTS.maxBlocks;
  const needBeds = s.beds < s.population;
  return (
    <section
      aria-label="Village status"
      data-testid="village-panel"
      className="pointer-events-auto flex w-full max-w-xs flex-col gap-1 rounded-3xl bg-white/90 p-3 text-sm shadow-xl backdrop-blur"
    >
      <h2 className="flex items-center gap-1.5 font-black">
        <Home size={16} aria-hidden="true" />
        Village Island · Round {s.round}
        {s.best > 0 && <span className="text-xs font-bold text-sky-700"> · Best {s.best}</span>}
      </h2>
      <p data-testid="village-villagers" className="flex items-center gap-1.5 font-extrabold">
        <Users size={15} aria-hidden="true" />
        Villagers safe: {s.alive} / {s.population}
      </p>
      <p data-testid="village-beds" className={`font-bold ${needBeds ? 'text-orange-600' : 'text-sky-900'}`}>
        Shelter beds: {s.beds}
        {needBeds ? ' (not enough for everyone!)' : ''}
      </p>
      {max !== undefined && (
        <p data-testid="block-count" className="font-bold text-sky-900">
          Blocks: {info.blocksUsed} / {max}
        </p>
      )}
      {info.notice && (
        <p role="status" data-testid="level-notice" className="rounded-xl bg-orange-100 px-2 py-1 font-bold">
          {info.notice}
        </p>
      )}
      {s.mode === 'build' && !s.over && (
        <p className="text-xs font-semibold text-sky-800">
          Build houses: a roof on top and walls on two or more sides. Each house cell shelters 2 villagers. If
          any villager gets knocked out, you lose!
        </p>
      )}
    </section>
  );
}
