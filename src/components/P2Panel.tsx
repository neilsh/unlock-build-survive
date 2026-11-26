import { Box, Eraser, Heart, Paintbrush, Waypoints } from 'lucide-react';
import type { ReactNode } from 'react';
import { isMaterialAllowed } from '../levels/constraints';
import { getLevel } from '../levels/levels';
import { useMods } from '../mods/modStore';
import { useUIState } from '../state/store';
import type { BuiltinMaterialType, ToolType } from '../types/blueprint';
import { BASE_MATERIALS, MATERIALS, UNLOCKABLE_MATERIALS } from '../types/materials';
import { isSandboxPlayMode, type GameActions } from '../types/ui';
import { Chip, Swatch } from './Chip';

const TOOLS: Array<{ id: ToolType; label: string; icon: ReactNode }> = [
  { id: 'block', label: 'Block', icon: <Box size={18} /> },
  { id: 'brace', label: 'Brace', icon: <Waypoints size={18} /> },
  { id: 'paint', label: 'Paint', icon: <Paintbrush size={18} /> },
  { id: 'erase', label: 'Erase', icon: <Eraser size={18} /> },
];

/** Player 2's own HP bar and builder (tool + material), shown over the right-hand split-screen view. */
export function P2Panel({ actions }: { actions: GameActions }) {
  const s = useUIState((u) => ({
    exploreMode: u.exploreMode,
    hasStarted: u.hasStarted,
    levelId: u.levelId,
    mode: u.mode,
    p2Hp: u.p2Hp,
    showHpBars: u.settings.showHpBars,
    p2MaxHp: u.p2MaxHp,
    p2Tool: u.p2Tool,
    p2Material: u.p2Material,
    playMode: u.playMode,
    unlockedMaterials: u.unlockedMaterials,
  }));
  const { active } = useMods();
  const level = s.levelId ? getLevel(s.levelId) : undefined;
  const creativeSandbox = s.hasStarted && isSandboxPlayMode(s.playMode) && s.levelId === null;
  const hpPct = Math.max(0, Math.min(100, (s.p2Hp / s.p2MaxHp) * 100));
  const hpColor = hpPct > 60 ? 'bg-emerald-500' : hpPct > 30 ? 'bg-amber-400' : 'bg-rose-500';
  const building = s.mode === 'build' && !s.exploreMode;
  const unlocked = (m: BuiltinMaterialType) => creativeSandbox || s.unlockedMaterials.includes(m);

  return (
    <div
      data-testid="p2-panel"
      className="pointer-events-none absolute right-28 top-16 flex w-[calc(50%-8rem)] max-w-md flex-col items-end gap-2"
    >
      <div
        data-testid="p2-hp"
        className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-cyan-100/95 px-3 py-1.5 text-xs font-black text-cyan-950 shadow-lg"
      >
        <span className="rounded-full bg-cyan-300 px-2 py-0.5">P2</span>
        {creativeSandbox ? (
          <span>Creative · Invincible</span>
        ) : s.showHpBars ? (
          <>
            <Heart size={16} aria-hidden="true" className="fill-rose-500 text-rose-500" />
            <span>
              HP {Math.ceil(s.p2Hp)} / {s.p2MaxHp}
            </span>
            <div className="h-3 w-24 overflow-hidden rounded-full bg-white shadow-inner">
              <div
                className={`h-full transition-all duration-150 ${hpColor}`}
                style={{ width: `${hpPct}%` }}
              />
            </div>
          </>
        ) : null}
      </div>

      {building && (
        <section
          aria-label="Player 2 build tools"
          className="pointer-events-auto flex max-h-[calc(100vh-13rem)] flex-col gap-1.5 overflow-y-auto rounded-3xl bg-cyan-100/90 p-2 shadow-xl backdrop-blur"
        >
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="P2 tools">
            {TOOLS.map((t) => (
              <Chip
                key={t.id}
                testId={`p2-tool-${t.id}`}
                label={t.label}
                icon={t.icon}
                active={s.p2Tool === t.id}
                onClick={() => actions.setP2Tool(t.id)}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="P2 materials">
            {[...BASE_MATERIALS, ...UNLOCKABLE_MATERIALS].map((m: BuiltinMaterialType) => (
              <Chip
                key={m}
                testId={`p2-material-${m}`}
                label={MATERIALS[m].label}
                icon={<Swatch color={MATERIALS[m].color} />}
                active={s.p2Material === m}
                disabled={!unlocked(m) || !isMaterialAllowed(level?.constraints, m)}
                onClick={() => actions.setP2Material(m)}
              />
            ))}
            {level === undefined &&
              s.playMode === 'creative' &&
              active.blocks.map((b) => (
                <Chip
                  key={b.id}
                  testId={`p2-material-${b.id}`}
                  label={b.label}
                  icon={<Swatch color={b.color} />}
                  active={s.p2Material === b.id}
                  onClick={() => actions.setP2Material(b.id)}
                />
              ))}
          </div>
          <span className="text-[10px] font-bold text-cyan-800">
            Enter place · ' erase · / material · ; tool
          </span>
        </section>
      )}
    </div>
  );
}
