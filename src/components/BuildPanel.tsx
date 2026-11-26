import type { ReactNode } from 'react';
import {
  Box,
  Building2,
  Castle,
  Compass,
  Eraser,
  FlipHorizontal2,
  Globe,
  House,
  Landmark,
  Lock,
  Paintbrush,
  Shield,
  Ship,
  Square,
  Trash2,
  Trees,
  Triangle,
  Undo2,
  Waypoints,
  Zap,
} from 'lucide-react';
import { isMaterialAllowed } from '../levels/constraints';
import { getLevel } from '../levels/levels';
import { useMods } from '../mods/modStore';
import { useUIState } from '../state/store';
import { type BuiltinMaterialType, type PresetName, type ToolType } from '../types/blueprint';
import { BASE_MATERIALS, MATERIALS, UNLOCKABLE_MATERIALS } from '../types/materials';
import { PRESET_DEFS, PRESET_ORDER } from '../types/presets';
import { isSandboxPlayMode, type GameActions } from '../types/ui';
import { Chip, Swatch } from './Chip';

const TOOLS: Array<{ id: ToolType; label: string; icon: ReactNode }> = [
  { id: 'block', label: 'Block', icon: <Box size={22} /> },
  { id: 'brace', label: 'Brace', icon: <Waypoints size={22} /> },
  { id: 'paint', label: 'Paint', icon: <Paintbrush size={22} /> },
  { id: 'erase', label: 'Erase', icon: <Eraser size={22} /> },
];

const PRESET_ICONS: Record<PresetName, ReactNode> = {
  empty: <Square size={20} />,
  house: <House size={20} />,
  tower: <Building2 size={20} />,
  bridge: <Landmark size={20} />,
  pyramid: <Triangle size={20} />,
  boat: <Ship size={20} />,
  treehouse: <Trees size={20} />,
  base: <Shield size={20} />,
  laser_tower: <Zap size={20} />,
  dome: <Globe size={20} />,
  fortress: <Castle size={20} />,
};

const SECTION_LABEL = 'text-[11px] font-black uppercase tracking-wide text-sky-800';

/** Build tools, materials, mirror/undo/clear and starter presets. Reads the UI store only. */
export function BuildPanel({ actions }: { actions: GameActions }) {
  const s = useUIState((u) => ({
    canUndo: u.canUndo,
    exploreMode: u.exploreMode,
    hasStarted: u.hasStarted,
    levelId: u.levelId,
    material: u.material,
    mirrorX: u.mirrorX,
    playMode: u.playMode,
    tool: u.tool,
    unlockedMaterials: u.unlockedMaterials,
    unlockedPresets: u.unlockedPresets,
  }));
  const { active } = useMods();
  // A challenge level greys out materials it does not allow and the presets (they would skip its limits).
  const level = s.levelId ? getLevel(s.levelId) : undefined;
  const creativeSandbox = s.hasStarted && isSandboxPlayMode(s.playMode) && s.levelId === null;
  if (s.exploreMode) {
    return (
      <section
        aria-label="Explore quick-builders"
        className="pointer-events-auto flex max-h-[calc(100vh-13rem)] w-full max-w-[calc(100%-6rem)] flex-col gap-2 overflow-y-auto rounded-3xl bg-sky-100/90 p-2.5 shadow-xl backdrop-blur sm:max-w-md"
      >
        <div
          data-testid="explore-quickbuilders-banner"
          className="flex items-center gap-1.5 rounded-2xl bg-teal-600 px-3 py-1.5 text-xs font-black text-white shadow-sm"
        >
          <Compass size={16} aria-hidden="true" />
          <span>Explore Mode · Quick-Builders Only</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className={SECTION_LABEL}>Quick-Builders</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick-Builders">
            {PRESET_ORDER.map((p) => {
              const unlocked = creativeSandbox || s.unlockedPresets.includes(p);
              return (
                <Chip
                  key={p}
                  testId={`preset-${p}`}
                  label={PRESET_DEFS[p].label}
                  icon={unlocked ? PRESET_ICONS[p] : <Lock size={18} />}
                  disabled={!unlocked}
                  onClick={() => actions.loadPreset(p)}
                />
              );
            })}
            <Chip
              testId="clear-island"
              label="Clear"
              icon={<Trash2 size={22} />}
              onClick={() => actions.clearIsland()}
            />
          </div>
        </div>
      </section>
    );
  }
  return (
    <section
      aria-label="Build tools"
      className="pointer-events-auto flex max-h-[calc(100vh-13rem)] w-full max-w-[calc(100%-6rem)] flex-col gap-2 overflow-y-auto rounded-3xl bg-sky-100/90 p-2.5 shadow-xl backdrop-blur sm:max-w-md"
    >
      <div className="flex flex-col gap-1">
        <span className={SECTION_LABEL}>Tools</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tools">
          {TOOLS.map((t) => (
            <Chip
              key={t.id}
              testId={`tool-${t.id}`}
              label={t.label}
              icon={t.icon}
              active={s.tool === t.id}
              onClick={() => actions.setTool(t.id)}
            />
          ))}
          <Chip
            testId="mirror-x"
            label="Mirror"
            icon={<FlipHorizontal2 size={22} />}
            active={s.mirrorX}
            onClick={() => actions.setMirrorX(!s.mirrorX)}
          />
          <Chip
            testId="undo"
            label="Undo"
            icon={<Undo2 size={22} />}
            disabled={!s.canUndo}
            onClick={() => actions.undo()}
          />
          <Chip
            testId="clear-island"
            label="Clear"
            icon={<Trash2 size={22} />}
            onClick={() => actions.clearIsland()}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className={SECTION_LABEL}>Materials</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Materials">
          {BASE_MATERIALS.map((m: BuiltinMaterialType) => (
            <Chip
              key={m}
              testId={`material-${m}`}
              label={MATERIALS[m].label}
              icon={<Swatch color={MATERIALS[m].color} />}
              active={s.material === m}
              disabled={!isMaterialAllowed(level?.constraints, m)}
              onClick={() => actions.setMaterial(m)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className={SECTION_LABEL}>Tech Blocks</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tech blocks">
          {UNLOCKABLE_MATERIALS.map((m: BuiltinMaterialType) => {
            const unlocked = creativeSandbox || s.unlockedMaterials.includes(m);
            const allowed = isMaterialAllowed(level?.constraints, m);
            return (
              <Chip
                key={m}
                testId={`material-${m}`}
                label={MATERIALS[m].label}
                icon={unlocked ? <Swatch color={MATERIALS[m].color} /> : <Lock size={20} />}
                active={s.material === m}
                disabled={!unlocked || !allowed}
                onClick={() => actions.setMaterial(m)}
              />
            );
          })}
        </div>
      </div>

      {level === undefined && s.playMode === 'creative' && active.blocks.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className={SECTION_LABEL}>Mod Blocks</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Mod blocks">
            {active.blocks.map((b) => (
              <Chip
                key={b.id}
                testId={`material-${b.id}`}
                label={b.label}
                icon={<Swatch color={b.color} />}
                active={s.material === b.id}
                onClick={() => actions.setMaterial(b.id)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className={SECTION_LABEL}>Quick-Builders</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick-Builders">
          {PRESET_ORDER.map((p) => {
            const unlocked = creativeSandbox || s.unlockedPresets.includes(p);
            return (
              <Chip
                key={p}
                testId={`preset-${p}`}
                label={PRESET_DEFS[p].label}
                icon={unlocked ? PRESET_ICONS[p] : <Lock size={18} />}
                disabled={!unlocked || level !== undefined}
                onClick={() => actions.loadPreset(p)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
