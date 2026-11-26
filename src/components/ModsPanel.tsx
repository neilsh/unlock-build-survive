import { Puzzle } from 'lucide-react';
import { useState } from 'react';
import { useMods } from '../mods/modStore';
import type { GameActions } from '../types/ui';
import { ModsModal } from './ModsModal';

/** Mods button with active badge and Mod Manager / Visual Mod Creator modal. */
export function ModsPanel({ actions }: { actions: GameActions }) {
  const { active } = useMods();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        data-testid="mods-open"
        aria-label="Mods"
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-2xl bg-white/90 px-3.5 text-sm font-extrabold shadow-md backdrop-blur active:scale-95"
      >
        <Puzzle size={20} aria-hidden="true" />
        <span className="compact:sr-only">Mods</span>
        {active.activeCount > 0 && (
          <span
            data-testid="mods-active-count"
            className="rounded-full bg-purple-600 px-2 py-0.5 text-xs font-black text-white"
          >
            {active.activeCount}
          </span>
        )}
      </button>
      {open && <ModsModal actions={actions} onClose={() => setOpen(false)} />}
    </>
  );
}
