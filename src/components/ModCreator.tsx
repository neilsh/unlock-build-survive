import { Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { slugifyId, type GameMod, type ModBlockDef, type ModDisasterDef } from '../mods/mods';
import { DISASTER_SECONDS } from '../types/blueprint';
import { hexToInt, intToHex } from '../utils/color';

export function patchAt<T extends object>(list: readonly T[], index: number, patch: Partial<T>): T[] {
  const out: T[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item) continue;
    out.push(i === index ? Object.assign({}, item, patch) : item);
  }
  return out;
}

export interface BlockDraft {
  id: string;
  label: string;
  color: string;
  density: number;
  stiffness: number;
  maxStress: number;
  buoyancy: number;
  power: 'none' | 'anchor' | 'shield' | 'laser';
}

export interface DisasterDraft {
  id: string;
  label: string;
  color: string;
  quake: number;
  wind: number;
  flood: boolean;
  projMode: 'none' | 'rain' | 'targeted';
  projRate: number;
  projSpeed: number;
  projRadius: number;
}

export function toBlockDraft(b: ModBlockDef): BlockDraft {
  const power =
    b.special === 'shield'
      ? 'shield'
      : b.special === 'laser'
        ? 'laser'
        : b.anchorMultiplier && b.anchorMultiplier > 1
          ? 'anchor'
          : 'none';
  return {
    id: b.id,
    label: b.label,
    color: intToHex(b.color),
    density: b.density,
    stiffness: b.stiffness,
    maxStress: b.maxStress,
    buoyancy: b.buoyancy,
    power,
  };
}

export function toDisasterDraft(d: ModDisasterDef): DisasterDraft {
  return {
    id: d.id,
    label: d.label,
    color: intToHex(d.color),
    quake: d.quake ?? 0,
    wind: d.wind ?? 0,
    flood: Boolean(d.flood),
    projMode: d.projectiles?.mode ?? 'none',
    projRate: d.projectiles?.rate ?? 5,
    projSpeed: d.projectiles?.speed ?? 15,
    projRadius: d.projectiles?.radius ?? 0.4,
  };
}

export function ModCreator({
  initial,
  existingIds,
  onCancel,
  onSave,
}: {
  initial: GameMod | null;
  existingIds: ReadonlySet<string>;
  onCancel: () => void;
  onSave: (mod: GameMod) => void;
}) {
  const uid = useId();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [gravity, setGravity] = useState(initial?.rules?.gravityMultiplier ?? 1);
  const [duration, setDuration] = useState(initial?.rules?.durationSeconds ?? DISASTER_SECONDS);
  const [blocks, setBlocks] = useState<BlockDraft[]>(() => (initial ? initial.blocks.map(toBlockDraft) : []));
  const [disasters, setDisasters] = useState<DisasterDraft[]>(() =>
    initial ? initial.disasters.map(toDisasterDraft) : [],
  );

  const addBlock = () => {
    const n = blocks.length + 1;
    setBlocks([
      ...blocks,
      {
        id: `block-${Date.now()}-${n}`,
        label: `Block ${n}`,
        color: '#38bdf8',
        density: 1.0,
        stiffness: 1.2,
        maxStress: 1.8,
        buoyancy: 0.5,
        power: 'none',
      },
    ]);
  };

  const addDisaster = () => {
    const n = disasters.length + 1;
    setDisasters([
      ...disasters,
      {
        id: `storm-${Date.now()}-${n}`,
        label: `Storm ${n}`,
        color: '#a855f7',
        quake: 0,
        wind: 0.6,
        flood: false,
        projMode: 'rain',
        projRate: 5,
        projSpeed: 15,
        projRadius: 0.4,
      },
    ]);
  };

  const handleSave = () => {
    const cleanName = name.trim();
    if (!cleanName) return;
    let modId = initial?.id;
    if (!modId) {
      const base = slugifyId('custom', cleanName);
      let candidate = base;
      let i = 2;
      while (existingIds.has(candidate)) candidate = `${base}-${i++}`;
      modId = candidate;
    }
    const cleanBlocks: ModBlockDef[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b?.label.trim()) continue;
      const item: ModBlockDef = {
        id: b.id.startsWith(`${modId}:`) ? b.id : `${modId}:b:${i}-${slugifyId('blk', b.label)}`,
        label: b.label.trim().slice(0, 20),
        color: hexToInt(b.color),
        density: b.density,
        stiffness: b.stiffness,
        maxStress: b.maxStress,
        buoyancy: b.buoyancy,
      };
      if (b.power === 'anchor') item.anchorMultiplier = 3;
      if (b.power === 'shield' || b.power === 'laser') item.special = b.power;
      cleanBlocks.push(item);
    }
    const cleanDisasters: ModDisasterDef[] = [];
    for (let i = 0; i < disasters.length; i++) {
      const d = disasters[i];
      if (!d?.label.trim()) continue;
      const item: ModDisasterDef = {
        id: d.id.startsWith(`${modId}:`) ? d.id : `${modId}:d:${i}-${slugifyId('dis', d.label)}`,
        label: d.label.trim().slice(0, 20),
        color: hexToInt(d.color),
      };
      if (d.quake > 0) item.quake = d.quake;
      if (d.wind > 0) item.wind = d.wind;
      if (d.flood) item.flood = true;
      if (d.projMode !== 'none') {
        item.projectiles = {
          mode: d.projMode,
          rate: d.projRate,
          speed: d.projSpeed,
          radius: d.projRadius,
          density: 2.2,
        };
      }
      cleanDisasters.push(item);
    }
    const hasRules = gravity !== 1 || duration !== DISASTER_SECONDS;
    onSave({
      id: modId,
      name: cleanName.slice(0, 40),
      description: description.trim().slice(0, 160) || 'Custom mod pack.',
      builtIn: false,
      enabled: true,
      blocks: cleanBlocks,
      disasters: cleanDisasters,
      ...(hasRules ? { rules: { gravityMultiplier: gravity, durationSeconds: duration } } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label htmlFor={`${uid}-name`} className="flex flex-col gap-1 text-xs font-extrabold">
          Mod Name
          <input
            id={`${uid}-name`}
            data-testid="mod-name-input"
            type="text"
            value={name}
            maxLength={40}
            placeholder="e.g. Super Emerald Pack"
            onChange={(e) => setName(e.target.value)}
            className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-bold"
          />
        </label>
        <label htmlFor={`${uid}-desc`} className="flex flex-col gap-1 text-xs font-extrabold">
          Description
          <input
            id={`${uid}-desc`}
            data-testid="mod-desc-input"
            type="text"
            value={description}
            maxLength={160}
            placeholder="What does this mod add?"
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-bold"
          />
        </label>
      </div>

      <div className="grid gap-2 rounded-2xl bg-white p-3 shadow-sm sm:grid-cols-2">
        <label htmlFor={`${uid}-grav`} className="flex flex-col gap-1 text-xs font-extrabold">
          Gravity ({gravity.toFixed(2)}x)
          <input
            id={`${uid}-grav`}
            type="range"
            min={0.2}
            max={2.5}
            step={0.05}
            value={gravity}
            onChange={(e) => setGravity(Number(e.target.value))}
          />
        </label>
        <label htmlFor={`${uid}-dur`} className="flex flex-col gap-1 text-xs font-extrabold">
          Disaster Length ({duration}s)
          <input
            id={`${uid}-dur`}
            type="range"
            min={4}
            max={20}
            step={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black">Custom Blocks ({blocks.length})</h3>
          <button
            type="button"
            data-testid="mod-add-block"
            onClick={addBlock}
            className="flex items-center gap-1 rounded-xl bg-sky-100 px-2.5 py-1.5 text-xs font-black text-sky-900 active:scale-95"
          >
            <Plus size={14} aria-hidden="true" />
            Add Block
          </button>
        </div>
        {blocks.map((b, i) => (
          <div key={b.id} className="grid gap-2 rounded-xl bg-sky-50 p-2.5 sm:grid-cols-3">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`Block ${i + 1} color`}
                value={b.color}
                onChange={(e) => setBlocks(patchAt(blocks, i, { color: e.target.value }))}
                className="h-9 w-9 cursor-pointer rounded-lg border border-sky-200 bg-white p-0.5"
              />
              <input
                type="text"
                aria-label={`Block ${i + 1} name`}
                value={b.label}
                maxLength={20}
                onChange={(e) => setBlocks(patchAt(blocks, i, { label: e.target.value }))}
                className="w-full rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs font-bold"
              />
            </div>
            <div className="flex flex-col justify-center gap-1 text-xs font-bold">
              <span>Strength: {b.maxStress.toFixed(1)}x</span>
              <input
                type="range"
                aria-label={`Block ${i + 1} strength`}
                min={0.3}
                max={5}
                step={0.1}
                value={b.maxStress}
                onChange={(e) => setBlocks(patchAt(blocks, i, { maxStress: Number(e.target.value) }))}
              />
              <span>Weight: {b.density.toFixed(1)}</span>
              <input
                type="range"
                aria-label={`Block ${i + 1} weight`}
                min={0.1}
                max={5}
                step={0.1}
                value={b.density}
                onChange={(e) => setBlocks(patchAt(blocks, i, { density: Number(e.target.value) }))}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <select
                aria-label={`Block ${i + 1} special power`}
                value={b.power}
                onChange={(e) => {
                  const v = e.target.value;
                  const power = v === 'anchor' || v === 'shield' || v === 'laser' ? v : 'none';
                  setBlocks(patchAt(blocks, i, { power }));
                }}
                className="rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs font-bold"
              >
                <option value="none">Normal block</option>
                <option value="anchor">Anchor grip (3x)</option>
                <option value="shield">Shield aura</option>
                <option value="laser">Laser turret</option>
              </select>
              <button
                type="button"
                aria-label={`Remove block ${i + 1}`}
                onClick={() => setBlocks(blocks.filter((_, idx) => idx !== i))}
                className="flex size-8 items-center justify-center rounded-lg bg-red-100 text-red-700 active:scale-95"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black">Custom Disasters ({disasters.length})</h3>
          <button
            type="button"
            data-testid="mod-add-disaster"
            onClick={addDisaster}
            className="flex items-center gap-1 rounded-xl bg-sky-100 px-2.5 py-1.5 text-xs font-black text-sky-900 active:scale-95"
          >
            <Plus size={14} aria-hidden="true" />
            Add Disaster
          </button>
        </div>
        {disasters.map((d, i) => (
          <div key={d.id} className="flex flex-col gap-2 rounded-xl bg-sky-50 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={`Disaster ${i + 1} color`}
                  value={d.color}
                  onChange={(e) => setDisasters(patchAt(disasters, i, { color: e.target.value }))}
                  className="h-9 w-9 cursor-pointer rounded-lg border border-sky-200 bg-white p-0.5"
                />
                <input
                  type="text"
                  aria-label={`Disaster ${i + 1} name`}
                  value={d.label}
                  maxLength={20}
                  onChange={(e) => setDisasters(patchAt(disasters, i, { label: e.target.value }))}
                  className="rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs font-bold"
                />
              </div>
              <button
                type="button"
                aria-label={`Remove disaster ${i + 1}`}
                onClick={() => setDisasters(disasters.filter((_, idx) => idx !== i))}
                className="flex size-8 items-center justify-center rounded-lg bg-red-100 text-red-700 active:scale-95"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="grid gap-2 text-xs font-bold sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                Quake ({d.quake.toFixed(1)}x)
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={d.quake}
                  onChange={(e) => setDisasters(patchAt(disasters, i, { quake: Number(e.target.value) }))}
                />
              </label>
              <label className="flex flex-col gap-1">
                Wind ({d.wind.toFixed(1)}x)
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={d.wind}
                  onChange={(e) => setDisasters(patchAt(disasters, i, { wind: Number(e.target.value) }))}
                />
              </label>
              <label className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  checked={d.flood}
                  onChange={(e) => setDisasters(patchAt(disasters, i, { flood: e.target.checked }))}
                />
                Rising Flood
              </label>
            </div>
            <div className="grid gap-2 text-xs font-bold sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                Projectiles
                <select
                  value={d.projMode}
                  onChange={(e) => {
                    const v = e.target.value;
                    const projMode = v === 'rain' || v === 'targeted' ? v : 'none';
                    setDisasters(patchAt(disasters, i, { projMode }));
                  }}
                  className="rounded-lg border border-sky-200 bg-white px-2 py-1.5"
                >
                  <option value="none">None</option>
                  <option value="rain">Falling Rain</option>
                  <option value="targeted">Targeted Raid</option>
                </select>
              </label>
              {d.projMode !== 'none' && (
                <>
                  <label className="flex flex-col gap-1">
                    Rate ({d.projRate}/s)
                    <input
                      type="range"
                      min={1}
                      max={12}
                      step={0.5}
                      value={d.projRate}
                      onChange={(e) =>
                        setDisasters(patchAt(disasters, i, { projRate: Number(e.target.value) }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Speed ({d.projSpeed})
                    <input
                      type="range"
                      min={6}
                      max={28}
                      step={1}
                      value={d.projSpeed}
                      onChange={(e) =>
                        setDisasters(patchAt(disasters, i, { projSpeed: Number(e.target.value) }))
                      }
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-2xl bg-white px-4 py-2 text-sm font-extrabold shadow-sm active:scale-95"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="mod-save"
          disabled={!name.trim()}
          onClick={handleSave}
          className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-black text-emerald-950 shadow-sm active:scale-95 disabled:opacity-50"
        >
          Save Mod
        </button>
      </div>
    </div>
  );
}
