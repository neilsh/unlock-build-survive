/**
 * Minecraft-style mod packs: data schema, built-in starter mods, sanitization,
 * persistence, resolution, and JSON export/import. Pure TypeScript (no three.js/Rapier/React).
 */
import type { MaterialDef } from '../types/materials';
import { DISASTER_SECONDS } from '../types/blueprint';
import type { StorageLike } from '../levels/progress';

export const MODS_KEY = 'disaster-village:mods:v1';

export interface ModBlockDef {
  id: string;
  label: string;
  color: number;
  density: number;
  stiffness: number;
  maxStress: number;
  buoyancy: number;
  anchorMultiplier?: number;
  special?: 'shield' | 'laser';
}

export interface ModProjectileSpec {
  mode: 'rain' | 'targeted';
  rate: number;
  speed: number;
  radius: number;
  density: number;
}

export interface ModDisasterDef {
  id: string;
  label: string;
  color: number;
  quake?: number;
  wind?: number;
  flood?: boolean;
  projectiles?: ModProjectileSpec;
}

export interface ModRules {
  gravityMultiplier?: number;
  durationSeconds?: number;
}

export interface GameMod {
  id: string;
  name: string;
  description: string;
  builtIn?: boolean;
  enabled: boolean;
  blocks: ModBlockDef[];
  disasters: ModDisasterDef[];
  rules?: ModRules;
}

export interface ResolvedMods {
  blocks: ModBlockDef[];
  blockMap: Map<string, MaterialDef>;
  disasters: ModDisasterDef[];
  disasterMap: Map<string, ModDisasterDef>;
  gravityMultiplier: number;
  durationSeconds: number;
  activeCount: number;
}

export const BUILTIN_MODS: readonly GameMod[] = [
  {
    id: 'moon-gravity',
    name: 'Moon Gravity',
    description: 'Floaty 0.35x lunar gravity plus ultra-light Moon Rock blocks.',
    builtIn: true,
    enabled: false,
    blocks: [
      {
        id: 'mod:moon-gravity:moon-rock',
        label: 'Moon Rock',
        color: 0xcbd5e1,
        density: 0.25,
        stiffness: 1.2,
        maxStress: 1.4,
        buoyancy: 2.2,
      },
    ],
    disasters: [],
    rules: { gravityMultiplier: 0.35 },
  },
  {
    id: 'obsidian-ice',
    name: 'Obsidian & Ice',
    description: 'Adds super-tough Obsidian, fragile Ice blocks, and an Acid Rain storm.',
    builtIn: true,
    enabled: false,
    blocks: [
      {
        id: 'mod:obsidian-ice:obsidian',
        label: 'Obsidian',
        color: 0x311b92,
        density: 3.4,
        stiffness: 2.4,
        maxStress: 4.0,
        buoyancy: 0.0,
      },
      {
        id: 'mod:obsidian-ice:ice',
        label: 'Ice',
        color: 0x80deea,
        density: 0.8,
        stiffness: 0.5,
        maxStress: 0.7,
        buoyancy: 1.1,
      },
    ],
    disasters: [
      {
        id: 'mod:obsidian-ice:acid-rain',
        label: 'Acid Rain',
        color: 0x84cc16,
        wind: 0.35,
        projectiles: { mode: 'rain', rate: 8, speed: 17, radius: 0.35, density: 2.5 },
      },
    ],
  },
  {
    id: 'chaos-pack',
    name: 'Chaos Pack',
    description: 'Longer 12s disasters, a Super Core shield, and a triple-threat Mega Storm.',
    builtIn: true,
    enabled: false,
    blocks: [
      {
        id: 'mod:chaos-pack:super-core',
        label: 'Super Core',
        color: 0xf59e0b,
        density: 1.8,
        stiffness: 1.8,
        maxStress: 2.2,
        buoyancy: 0.0,
        special: 'shield',
      },
    ],
    disasters: [
      {
        id: 'mod:chaos-pack:mega-storm',
        label: 'Mega Storm',
        color: 0xd946ef,
        quake: 0.9,
        wind: 1.0,
        projectiles: { mode: 'targeted', rate: 4.5, speed: 16, radius: 0.48, density: 2.4 },
      },
    ],
    rules: { durationSeconds: 12 },
  },
];

const BUILTIN_IDS = new Set(BUILTIN_MODS.map((m) => m.id));

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
};

const cleanText = (v: unknown, maxLen: number, fallback = ''): string =>
  typeof v === 'string' ? v.trim().slice(0, maxLen) || fallback : fallback;

const cleanColor = (v: unknown, fallback: number): number => {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.max(0, Math.min(0xffffff, Math.floor(v)));
  }
  return fallback;
};

export function slugifyId(prefix: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${prefix}:${slug || 'item'}`;
}

export function cloneMod(m: GameMod): GameMod {
  return structuredClone(m);
}

export function modBlockToMaterialDef(b: ModBlockDef): MaterialDef {
  return {
    id: b.id,
    label: b.label,
    color: b.color,
    density: b.density,
    stiffness: b.stiffness,
    maxStress: b.maxStress,
    buoyancy: b.buoyancy,
    anchorMultiplier: b.anchorMultiplier,
    special: b.special,
    description: `Mod block (${b.label})`,
  };
}

function asMap(raw: unknown): Map<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  return new Map(Object.entries(raw));
}

function sanitizeBlock(raw: unknown, index: number): ModBlockDef | null {
  const r = asMap(raw);
  if (!r) return null;
  const label = cleanText(r.get('label'), 20);
  if (!label) return null;
  const id = cleanText(r.get('id'), 64, `mod:block:${index}`);
  const sp = r.get('special');
  const special = sp === 'shield' || sp === 'laser' ? sp : undefined;
  const am = r.get('anchorMultiplier');
  const anchorMultiplier = am !== undefined ? clamp(am, 1, 5, 1) : undefined;
  return {
    id,
    label,
    color: cleanColor(r.get('color'), 0x38bdf8),
    density: clamp(r.get('density'), 0.1, 5, 1.0),
    stiffness: clamp(r.get('stiffness'), 0.2, 3, 1.2),
    maxStress: clamp(r.get('maxStress'), 0.3, 5, 1.5),
    buoyancy: clamp(r.get('buoyancy'), 0, 4, 0.5),
    ...(anchorMultiplier !== undefined ? { anchorMultiplier } : {}),
    ...(special ? { special } : {}),
  };
}

function sanitizeProjectiles(raw: unknown): ModProjectileSpec | undefined {
  const r = asMap(raw);
  if (!r) return undefined;
  const m = r.get('mode');
  const mode = m === 'targeted' ? 'targeted' : m === 'rain' ? 'rain' : null;
  if (!mode) return undefined;
  return {
    mode,
    rate: clamp(r.get('rate'), 0.5, 12, 4),
    speed: clamp(r.get('speed'), 6, 30, 14),
    radius: clamp(r.get('radius'), 0.2, 1.1, 0.4),
    density: clamp(r.get('density'), 0.5, 5, 2.0),
  };
}

function sanitizeDisaster(raw: unknown, index: number): ModDisasterDef | null {
  const r = asMap(raw);
  if (!r) return null;
  const label = cleanText(r.get('label'), 20);
  if (!label) return null;
  const id = cleanText(r.get('id'), 64, `mod:disaster:${index}`);
  const q = r.get('quake');
  const w = r.get('wind');
  const quake = q !== undefined ? clamp(q, 0, 2, 0) : undefined;
  const wind = w !== undefined ? clamp(w, 0, 2, 0) : undefined;
  const flood = r.get('flood') === true ? true : undefined;
  const projectiles = sanitizeProjectiles(r.get('projectiles'));
  return {
    id,
    label,
    color: cleanColor(r.get('color'), 0xa855f7),
    ...(quake ? { quake } : {}),
    ...(wind ? { wind } : {}),
    ...(flood ? { flood } : {}),
    ...(projectiles ? { projectiles } : {}),
  };
}

function sanitizeRules(raw: unknown): ModRules | undefined {
  const r = asMap(raw);
  if (!r) return undefined;
  const out: ModRules = {};
  const g = r.get('gravityMultiplier');
  const d = r.get('durationSeconds');
  if (g !== undefined) out.gravityMultiplier = clamp(g, 0.2, 2.5, 1);
  if (d !== undefined) out.durationSeconds = Math.round(clamp(d, 4, 20, DISASTER_SECONDS));
  return out.gravityMultiplier !== undefined || out.durationSeconds !== undefined ? out : undefined;
}

/** Validates and clamps an arbitrary object into a safe `GameMod`, or returns null. */
export function sanitizeMod(raw: unknown): GameMod | null {
  const r = asMap(raw);
  if (!r) return null;
  const name = cleanText(r.get('name'), 40);
  if (!name) return null;
  const id = cleanText(r.get('id'), 64, slugifyId('custom', name));
  const description = cleanText(r.get('description'), 160, 'Custom Disaster Village mod.');
  const bRaw = r.get('blocks');
  const dRaw = r.get('disasters');
  const blocksRaw = Array.isArray(bRaw) ? bRaw : [];
  const disastersRaw = Array.isArray(dRaw) ? dRaw : [];

  const blocks: ModBlockDef[] = [];
  const seenBlocks = new Set<string>();
  blocksRaw.forEach((b, i) => {
    const clean = sanitizeBlock(b, i);
    if (clean && !seenBlocks.has(clean.id)) {
      seenBlocks.add(clean.id);
      blocks.push(clean);
    }
  });

  const disasters: ModDisasterDef[] = [];
  const seenDisasters = new Set<string>();
  disastersRaw.forEach((d, i) => {
    const clean = sanitizeDisaster(d, i);
    if (clean && !seenDisasters.has(clean.id)) {
      seenDisasters.add(clean.id);
      disasters.push(clean);
    }
  });

  const rules = sanitizeRules(r.get('rules'));
  return {
    id,
    name,
    description,
    builtIn: r.get('builtIn') === true && BUILTIN_IDS.has(id),
    enabled: r.get('enabled') === true,
    blocks,
    disasters,
    ...(rules ? { rules } : {}),
  };
}

export function loadMods(storage: StorageLike | null = defaultStorage()): GameMod[] {
  const savedBuiltins = new Map<string, boolean>();
  const customs: GameMod[] = [];
  const seenCustom = new Set<string>();
  try {
    const raw = storage?.getItem(MODS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const rec = asMap(item);
        if (!rec) continue;
        const itemId = rec.get('id');
        if (typeof itemId === 'string' && BUILTIN_IDS.has(itemId)) {
          savedBuiltins.set(itemId, rec.get('enabled') === true);
          continue;
        }
        const clean = sanitizeMod(item);
        if (clean && !BUILTIN_IDS.has(clean.id) && !seenCustom.has(clean.id)) {
          seenCustom.add(clean.id);
          clean.builtIn = false;
          customs.push(clean);
        }
      }
    }
  } catch {
    // corrupt JSON or blocked storage: start with built-in defaults
  }
  const builtins: GameMod[] = [];
  for (const m of BUILTIN_MODS) {
    const copy = cloneMod(m);
    copy.enabled = savedBuiltins.get(m.id) ?? m.enabled;
    builtins.push(copy);
  }
  return [...builtins, ...customs];
}

export function saveMods(mods: readonly GameMod[], storage: StorageLike | null = defaultStorage()): void {
  try {
    const payload: Array<Record<string, unknown>> = [];
    for (const m of mods) {
      payload.push(m.builtIn ? { id: m.id, enabled: m.enabled } : { ...m, builtIn: false });
    }
    storage?.setItem(MODS_KEY, JSON.stringify(payload));
  } catch {
    // quota or blocked storage: mod changes just will not persist
  }
}

export function resolveActiveMods(mods: readonly GameMod[]): ResolvedMods {
  const blocks: ModBlockDef[] = [];
  const blockMap = new Map<string, MaterialDef>();
  const disasters: ModDisasterDef[] = [];
  const disasterMap = new Map<string, ModDisasterDef>();
  let gravity = 1;
  let duration = DISASTER_SECONDS;
  let activeCount = 0;

  for (const mod of mods) {
    if (!mod.enabled) continue;
    activeCount++;
    for (const b of mod.blocks) {
      if (!blockMap.has(b.id)) {
        blocks.push(b);
        blockMap.set(b.id, modBlockToMaterialDef(b));
      }
    }
    for (const d of mod.disasters) {
      if (!disasterMap.has(d.id)) {
        disasters.push(d);
        disasterMap.set(d.id, d);
      }
    }
    if (mod.rules?.gravityMultiplier !== undefined) gravity *= mod.rules.gravityMultiplier;
    if (mod.rules?.durationSeconds !== undefined) {
      duration = Math.max(duration, mod.rules.durationSeconds);
    }
  }

  return {
    blocks,
    blockMap,
    disasters,
    disasterMap,
    gravityMultiplier: clamp(gravity, 0.2, 2.5, 1),
    durationSeconds: Math.round(clamp(duration, 4, 20, DISASTER_SECONDS)),
    activeCount,
  };
}

export function exportModJson(mod: GameMod): string {
  const clean = {
    id: mod.id,
    name: mod.name,
    description: mod.description,
    blocks: mod.blocks,
    disasters: mod.disasters,
    ...(mod.rules ? { rules: mod.rules } : {}),
  };
  return JSON.stringify(clean, null, 2);
}

export function parseImportedMod(
  json: string,
  existingIds: ReadonlySet<string> = new Set(),
): { ok: true; mod: GameMod } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'That does not look like valid mod JSON.' };
  }
  const clean = sanitizeMod(parsed);
  if (!clean) {
    return { ok: false, error: 'Mod needs a name and valid JSON structure.' };
  }
  let id = clean.id;
  if (BUILTIN_IDS.has(id) || !id.startsWith('custom:')) {
    id = slugifyId('custom', clean.name);
  }
  let candidate = id;
  let suffix = 2;
  while (BUILTIN_IDS.has(candidate) || existingIds.has(candidate)) {
    candidate = `${id}-${suffix++}`;
  }
  return {
    ok: true,
    mod: { ...clean, id: candidate, builtIn: false, enabled: true },
  };
}
