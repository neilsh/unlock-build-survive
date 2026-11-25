import { Gamepad2, Volume2, VolumeX } from 'lucide-react';
import { useUIState } from '../state/store';
import type { GameActions } from '../types/ui';
import { Chip } from './Chip';

/** Sound mute toggle and gamepad connection badge, stacked on the right edge. */
export function CameraPanel({ actions }: { actions: GameActions }) {
  const s = useUIState();
  return (
    <section aria-label="Camera and sound" className="pointer-events-none flex flex-col items-center gap-1.5">
      <span className="rounded-full bg-white/85 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-sky-900 shadow-sm">
        Sound
      </span>
      <Chip
        testId="mute-toggle"
        label="Mute"
        icon={s.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        active={s.muted}
        onClick={() => actions.setMuted(!s.muted)}
        className="min-w-14"
      />
      {s.gamepadConnected && (
        <span
          data-testid="gamepad-indicator"
          aria-label="Gamepad connected"
          className="pointer-events-auto inline-flex min-h-8 items-center justify-center gap-1 rounded-2xl bg-emerald-200 px-2.5 py-1 text-xs font-black text-emerald-950 shadow-md"
        >
          <Gamepad2 size={16} aria-hidden="true" />
          <span>Gamepad</span>
        </span>
      )}
    </section>
  );
}
