import {
  Castle,
  Check,
  Crosshair,
  Globe,
  Lock,
  Shield,
  Ship,
  ShoppingBag,
  Sparkles,
  Trees,
  Triangle,
  Zap,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useUIState } from '../state/store';
import { type BuiltinMaterialType, type UnlockablePresetName } from '../types/blueprint';
import { MATERIALS, UNLOCKABLE_MATERIALS, type MaterialDef } from '../types/materials';
import { PRESET_DEFS, UNLOCKABLE_PRESETS } from '../types/presets';
import { GEAR, GEAR_ORDER, type GearDef, type GearId } from '../types/gear';
import type { GameActions } from '../types/ui';
import { intToHex } from '../utils/color';
import { Swatch } from './Chip';
import { Modal } from './Modal';

type ShopFilter = 'all' | 'structural' | 'defense' | 'armor' | 'weapon' | 'preset';

const SHOP_FILTERS: ReadonlyArray<{ id: ShopFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'structural', label: 'Materials' },
  { id: 'defense', label: 'Defense' },
  { id: 'armor', label: 'Armor' },
  { id: 'weapon', label: 'Weapons' },
  { id: 'preset', label: 'Builders' },
];

const PRESET_ICONS: Record<UnlockablePresetName, ReactNode> = {
  pyramid: <Triangle size={18} />,
  boat: <Ship size={18} />,
  treehouse: <Trees size={18} />,
  base: <Shield size={18} />,
  laser_tower: <Zap size={18} />,
  dome: <Globe size={18} />,
  fortress: <Castle size={18} />,
};

function weightLabel(density: number): string {
  if (density <= 0.4) return 'Feather';
  if (density <= 1.0) return 'Light';
  return 'Heavy';
}

function materialBadges(def: MaterialDef): string[] {
  const badges = [`Strength ${def.maxStress}x`, weightLabel(def.density)];
  if (def.buoyancy >= 1.5) badges.push('Floats');
  if (def.anchorMultiplier && def.anchorMultiplier > 1) badges.push(`${def.anchorMultiplier}x Grip`);
  if (def.special === 'shield') badges.push('Shield Aura');
  if (def.special === 'laser') badges.push('Laser Turret');
  if (def.special === 'beaver') badges.push('Flood Dam');
  if (def.special === 'owl') badges.push('Hazard Swatter');
  if (def.special === 'spider') badges.push('Web Bracing');
  return badges;
}

function gearBadges(g: GearDef): string[] {
  if (g.slot === 'armor') {
    const badges = [`+${g.bonusHp} HP`, `${Math.round(g.damageReduction * 100)}% Armor`];
    if (g.floodImmune) badges.push('Floodproof');
    if (g.jumpMultiplier && g.jumpMultiplier > 1) badges.push('Super Jump');
    return badges;
  }
  const badges = [`Dmg ${g.damage}`, `Range ${g.range}m`];
  if (g.splashRadius > 0) badges.push(`Splash ${g.splashRadius}m`);
  return badges;
}

function GearCard({
  gear,
  owned,
  creativeFree,
  equipped,
  affordable,
  onUnlock,
  onToggleEquip,
}: {
  gear: GearDef;
  owned: boolean;
  creativeFree: boolean;
  equipped: boolean;
  affordable: boolean;
  onUnlock: () => void;
  onToggleEquip: () => void;
}) {
  const badges = gearBadges(gear);
  const usable = owned || creativeFree;
  return (
    <li
      className={`flex flex-col justify-between gap-3 rounded-2xl p-3.5 shadow-md ${
        equipped
          ? 'bg-amber-50 ring-2 ring-amber-400'
          : usable
            ? 'bg-emerald-50 ring-2 ring-emerald-300'
            : 'bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-xl text-white shadow-inner"
            style={{ backgroundColor: intToHex(gear.color) }}
          >
            {gear.slot === 'armor' ? <Shield size={18} /> : <Crosshair size={18} />}
          </span>
          <div>
            <div className="text-base font-black">{gear.label}</div>
            <div className="text-xs font-extrabold text-sky-700">
              {gear.cost === 0 ? 'Free Starter' : `${gear.cost} pts`}
            </div>
          </div>
        </div>
        {equipped ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-300 px-2.5 py-1 text-xs font-black text-amber-950">
            <Check size={14} aria-hidden="true" />
            Equipped
          </span>
        ) : owned ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-200 px-2.5 py-1 text-xs font-black text-emerald-950">
            <Check size={14} aria-hidden="true" />
            Owned
          </span>
        ) : creativeFree ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2.5 py-1 text-xs font-black text-amber-950">
            <Sparkles size={14} aria-hidden="true" />
            Creative
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-black text-sky-900">
            <Lock size={14} aria-hidden="true" />
            Locked
          </span>
        )}
      </div>

      <p className="text-sm font-semibold text-sky-950">{gear.description}</p>

      <div className="flex flex-wrap gap-1.5">
        {badges.map((badge) => (
          <span
            key={badge}
            className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-extrabold text-sky-900"
          >
            {badge}
          </span>
        ))}
      </div>

      {usable ? (
        <button
          type="button"
          data-testid={`equip-gear-${gear.id}`}
          aria-pressed={equipped}
          onClick={onToggleEquip}
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-black shadow-sm transition active:scale-95 ${
            equipped
              ? 'bg-amber-300 text-amber-950 hover:bg-amber-200'
              : 'bg-emerald-200 text-emerald-950 hover:bg-emerald-300'
          }`}
        >
          <Check size={16} aria-hidden="true" />
          {equipped ? 'Equipped' : 'Equip'}
        </button>
      ) : (
        <button
          type="button"
          data-testid={`unlock-gear-${gear.id}`}
          disabled={!affordable}
          onClick={onUnlock}
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-black shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
            affordable ? 'bg-amber-300 text-amber-950 hover:bg-amber-200' : 'bg-sky-100 text-sky-900'
          }`}
        >
          {affordable ? (
            <>
              <Sparkles size={16} aria-hidden="true" />
              Unlock ({gear.cost} pts)
            </>
          ) : (
            `Need ${gear.cost} pts`
          )}
        </button>
      )}
    </li>
  );
}

function ShopModal({ actions, onClose }: { actions: GameActions; onClose: () => void }) {
  const ui = useUIState();
  const [filter, setFilter] = useState<ShopFilter>('all');
  const creativeFree = ui.hasStarted && ui.playMode === 'creative' && ui.levelId === null && !ui.menuOpen;
  const ownedMaterials = UNLOCKABLE_MATERIALS.filter((m) => ui.unlockedMaterials.includes(m)).length;
  const ownedGear = GEAR_ORDER.filter((g) => ui.unlockedGear.includes(g)).length;
  const ownedPresets = UNLOCKABLE_PRESETS.filter((p) => ui.unlockedPresets.includes(p)).length;
  const totalShopItems = UNLOCKABLE_MATERIALS.length + GEAR_ORDER.length + UNLOCKABLE_PRESETS.length;
  const visibleMaterials = UNLOCKABLE_MATERIALS.filter(
    (m) => filter === 'all' || MATERIALS[m].shopCategory === filter,
  );
  const visibleGear = GEAR_ORDER.filter((id: GearId) => filter === 'all' || GEAR[id].slot === filter);
  const visiblePresets = filter === 'all' || filter === 'preset' ? UNLOCKABLE_PRESETS : [];
  const sectionCount =
    (visibleMaterials.length > 0 ? 1 : 0) +
    (visibleGear.length > 0 ? 1 : 0) +
    (visiblePresets.length > 0 ? 1 : 0);
  const showSectionTitles = sectionCount > 1;

  return (
    <Modal
      title="Tech Shop"
      ariaLabel="Tech shop"
      testId="shop-modal"
      closeTestId="shop-close"
      maxWidthClass="max-w-2xl"
      headerExtra={
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-amber-950 shadow-sm">
            {ui.points} pts
          </span>
          <span className="rounded-full bg-sky-200 px-3 py-1 text-xs font-black text-sky-950 shadow-sm">
            {ownedMaterials + ownedGear + ownedPresets}/{totalShopItems} owned
          </span>
        </div>
      }
      onClose={onClose}
      onOpenChange={(open) => actions.setModalOpen(open)}
    >
      <p className="text-sm font-bold text-sky-900">
        Win challenge levels or survive waves to earn points, then unlock building tech and 1st-person gear!
      </p>

      {creativeFree && (
        <p
          data-testid="shop-creative-banner"
          className="rounded-2xl bg-amber-100 px-3.5 py-2 text-xs font-extrabold text-amber-950"
        >
          Creative Mode: all blocks, quick-builders, and gear are unlocked for free!
        </p>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Shop category">
        {SHOP_FILTERS.map((tab) => {
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`shop-filter-${tab.id}`}
              aria-pressed={active}
              onClick={() => setFilter(tab.id)}
              className={`min-h-10 rounded-2xl px-3.5 py-1.5 text-sm font-black shadow-sm transition active:scale-95 ${
                active ? 'bg-amber-300 text-amber-950' : 'bg-white text-sky-900 hover:bg-sky-100'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {visibleMaterials.length > 0 && (
        <>
          {showSectionTitles && (
            <h3 className="text-xs font-black uppercase tracking-wide text-sky-700">Blocks &amp; Defenses</h3>
          )}
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {visibleMaterials.map((m: BuiltinMaterialType) => {
              const def = MATERIALS[m];
              const cost = def.cost ?? 0;
              const owned = ui.unlockedMaterials.includes(m);
              const usable = owned || creativeFree;
              const affordable = ui.points >= cost;
              const badges = materialBadges(def);
              return (
                <li
                  key={m}
                  className={`flex flex-col justify-between gap-3 rounded-2xl p-3.5 shadow-md ${
                    usable ? 'bg-emerald-50 ring-2 ring-emerald-300' : 'bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <Swatch color={def.color} />
                      <div>
                        <div className="text-base font-black">{def.label}</div>
                        <div className="text-xs font-extrabold text-sky-700">{cost} pts</div>
                      </div>
                    </div>
                    {owned ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-200 px-2.5 py-1 text-xs font-black text-emerald-950">
                        <Check size={14} aria-hidden="true" />
                        Owned
                      </span>
                    ) : creativeFree ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2.5 py-1 text-xs font-black text-amber-950">
                        <Sparkles size={14} aria-hidden="true" />
                        Creative
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-black text-sky-900">
                        <Lock size={14} aria-hidden="true" />
                        Locked
                      </span>
                    )}
                  </div>

                  {def.description && <p className="text-sm font-semibold text-sky-950">{def.description}</p>}

                  <div className="flex flex-wrap gap-1.5">
                    {badges.map((badge) => (
                      <span
                        key={badge}
                        className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-extrabold text-sky-900"
                      >
                        {badge}
                      </span>
                    ))}
                  </div>

                  <button
                    type="button"
                    data-testid={`unlock-${m}`}
                    disabled={usable || !affordable}
                    onClick={() => actions.unlockMaterial(m)}
                    className={`flex min-h-11 items-center justify-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-black shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                      owned
                        ? 'bg-emerald-200 text-emerald-950'
                        : creativeFree
                          ? 'bg-amber-200 text-amber-950'
                          : affordable
                            ? 'bg-amber-300 text-amber-950 hover:bg-amber-200'
                            : 'bg-sky-100 text-sky-900'
                    }`}
                  >
                    {owned ? (
                      <>
                        <Check size={16} aria-hidden="true" />
                        Unlocked
                      </>
                    ) : creativeFree ? (
                      <>
                        <Sparkles size={16} aria-hidden="true" />
                        Free in Creative
                      </>
                    ) : affordable ? (
                      <>
                        <Sparkles size={16} aria-hidden="true" />
                        Unlock ({cost} pts)
                      </>
                    ) : (
                      `Need ${cost} pts`
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {visibleGear.length > 0 && (
        <>
          {showSectionTitles && (
            <h3 className="mt-1 text-xs font-black uppercase tracking-wide text-sky-700">
              1st-Person Armor &amp; Weapons
            </h3>
          )}
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {visibleGear.map((id) => {
              const gear = GEAR[id];
              const owned = ui.unlockedGear.includes(id);
              const equipped = gear.slot === 'armor' ? ui.equippedArmor === id : ui.equippedWeapon === id;
              const affordable = ui.points >= gear.cost;
              return (
                <GearCard
                  key={id}
                  gear={gear}
                  owned={owned}
                  creativeFree={creativeFree}
                  equipped={equipped}
                  affordable={affordable}
                  onUnlock={() => actions.unlockGear(id)}
                  onToggleEquip={() => actions.equipGear(equipped ? null : id, gear.slot)}
                />
              );
            })}
          </ul>
        </>
      )}

      {visiblePresets.length > 0 && (
        <>
          {showSectionTitles && (
            <h3 className="mt-1 text-xs font-black uppercase tracking-wide text-sky-700">Quick-Builders</h3>
          )}
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {visiblePresets.map((p) => {
              const def = PRESET_DEFS[p];
              const cost = def.cost ?? 0;
              const owned = ui.unlockedPresets.includes(p);
              const usable = owned || creativeFree;
              const affordable = ui.points >= cost;
              return (
                <li
                  key={p}
                  className={`flex flex-col justify-between gap-3 rounded-2xl p-3.5 shadow-md ${
                    usable ? 'bg-emerald-50 ring-2 ring-emerald-300' : 'bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex size-8 items-center justify-center rounded-xl text-white shadow-inner"
                        style={{ backgroundColor: intToHex(def.color) }}
                      >
                        {PRESET_ICONS[p]}
                      </span>
                      <div>
                        <div className="text-base font-black">{def.label}</div>
                        <div className="text-xs font-extrabold text-sky-700">{cost} pts</div>
                      </div>
                    </div>
                    {owned ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-200 px-2.5 py-1 text-xs font-black text-emerald-950">
                        <Check size={14} aria-hidden="true" />
                        Owned
                      </span>
                    ) : creativeFree ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2.5 py-1 text-xs font-black text-amber-950">
                        <Sparkles size={14} aria-hidden="true" />
                        Creative
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-black text-sky-900">
                        <Lock size={14} aria-hidden="true" />
                        Locked
                      </span>
                    )}
                  </div>

                  {def.description && <p className="text-sm font-semibold text-sky-950">{def.description}</p>}

                  {def.badges && def.badges.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {def.badges.map((badge) => (
                        <span
                          key={badge}
                          className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-extrabold text-sky-900"
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    data-testid={`unlock-preset-${p}`}
                    disabled={usable || !affordable}
                    onClick={() => actions.unlockPreset(p)}
                    className={`flex min-h-11 items-center justify-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-black shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                      owned
                        ? 'bg-emerald-200 text-emerald-950'
                        : creativeFree
                          ? 'bg-amber-200 text-amber-950'
                          : affordable
                            ? 'bg-amber-300 text-amber-950 hover:bg-amber-200'
                            : 'bg-sky-100 text-sky-900'
                    }`}
                  >
                    {owned ? (
                      <>
                        <Check size={16} aria-hidden="true" />
                        Unlocked
                      </>
                    ) : creativeFree ? (
                      <>
                        <Sparkles size={16} aria-hidden="true" />
                        Free in Creative
                      </>
                    ) : affordable ? (
                      <>
                        <Sparkles size={16} aria-hidden="true" />
                        Unlock ({cost} pts)
                      </>
                    ) : (
                      `Need ${cost} pts`
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Modal>
  );
}

/** Shop button with live point balance and modal for unlocking tech blocks. */
export function ShopPanel({
  actions,
  open: controlledOpen,
  onOpenChange,
}: {
  actions: GameActions;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const ui = useUIState();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };

  return (
    <>
      <button
        type="button"
        data-testid="shop-open"
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-2xl bg-white/90 px-3.5 text-sm font-extrabold shadow-md backdrop-blur active:scale-95"
      >
        <ShoppingBag size={20} aria-hidden="true" />
        <span>Shop</span>
        <span
          data-testid="points-balance"
          className="rounded-full bg-amber-300 px-2 py-0.5 text-xs font-black text-amber-950"
        >
          {ui.points} pts
        </span>
      </button>
      {open && <ShopModal actions={actions} onClose={() => setOpen(false)} />}
    </>
  );
}
