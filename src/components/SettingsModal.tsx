import {
  Gamepad2,
  Keyboard,
  Monitor,
  MousePointer2,
  RotateCcw,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useUIState } from '../state/store';
import { GAMEPAD_DEADZONE_RANGE, LOOK_SENSITIVITY_RANGE, type GraphicsQuality } from '../types/settings';
import type { GameActions } from '../types/ui';
import { Modal } from './Modal';

const QUALITY_OPTIONS: ReadonlyArray<{ id: GraphicsQuality; label: string; hint: string }> = [
  { id: 'low', label: 'Low', hint: 'No shadows, fastest' },
  { id: 'medium', label: 'Medium', hint: 'Soft shadows, lighter load' },
  { id: 'high', label: 'High', hint: 'Best looking' },
];

const CONTROL_REFERENCE: ReadonlyArray<{ icon: ReactNode; title: string; lines: readonly string[] }> = [
  {
    icon: <Keyboard size={16} aria-hidden="true" />,
    title: 'Keyboard & mouse',
    lines: [
      'WASD move · Space jump · Drag to look',
      'Click build / erase · Esc menu',
      '2P: Player 2 uses Arrows + Enter',
    ],
  },
  {
    icon: <Gamepad2 size={16} aria-hidden="true" />,
    title: 'Gamepad',
    lines: [
      'L-Stick move · R-Stick look · A jump',
      'RT build · LT erase · X tool · LB/RB material',
      'B undo / rewind · Select test · Start menu',
    ],
  },
  {
    icon: <Smartphone size={16} aria-hidden="true" />,
    title: 'Touch',
    lines: [
      'Left joystick moves · Drag the view to look',
      'Build / Break buttons aim at the + · Jump button',
      'Tools button opens blocks, Test it! starts the disaster',
    ],
  },
];

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm"
      data-testid={`settings-section-${title.toLowerCase()}`}
    >
      <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-sky-800">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

interface SliderRowProps {
  testId: string;
  label: string;
  /** Slider position in whole display units (percent, or hundredths for sensitivity). */
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

function SliderRow({ testId, label, value, min, max, step, display, onChange }: SliderRowProps) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm font-bold text-sky-950">
      <span className="w-28 shrink-0 sm:w-40">{label}</span>
      <input
        type="range"
        data-testid={testId}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-11 w-full min-w-0 accent-amber-400"
      />
      <span className="w-12 shrink-0 text-right text-xs font-black text-sky-800">{display}</span>
    </label>
  );
}

function ToggleRow({
  testId,
  label,
  on,
  onToggle,
}: {
  testId: string;
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={on}
      onClick={onToggle}
      className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-sky-50 px-3 py-2 text-left text-sm font-bold text-sky-950 transition hover:bg-sky-100 active:scale-[0.99]"
    >
      <span>{label}</span>
      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-black ${
          on ? 'bg-emerald-500 text-white' : 'bg-sky-200 text-sky-800'
        }`}
      >
        {on ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}

/** All player preferences in one place: audio, controls, graphics and gameplay, plus reset to defaults. */
export function SettingsModal({ actions, onClose }: { actions: GameActions; onClose: () => void }) {
  const s = useUIState((u) => ({
    muted: u.muted,
    musicVolume: u.musicVolume,
    settings: u.settings,
    gamepadConnected: u.gamepadConnected,
    gamepadLabel: u.gamepadLabel,
    gamepadStandard: u.gamepadStandard,
  }));
  const set = s.settings;

  return (
    <Modal
      title="Settings"
      ariaLabel="Settings"
      testId="settings-modal"
      closeTestId="settings-close"
      maxWidthClass="max-w-2xl"
      onClose={onClose}
      onOpenChange={(open) => actions.setModalOpen(open)}
    >
      <Section title="Audio" icon={s.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}>
        <ToggleRow
          testId="settings-mute"
          label="Mute everything"
          on={s.muted}
          onToggle={() => actions.setMuted(!s.muted)}
        />
        <SliderRow
          testId="settings-music-volume"
          label="Music volume"
          value={Math.round(s.musicVolume * 100)}
          min={0}
          max={100}
          step={5}
          display={`${Math.round(s.musicVolume * 100)}%`}
          onChange={(v) => actions.setMusicVolume(v / 100)}
        />
        <SliderRow
          testId="settings-sfx-volume"
          label="Sound effects volume"
          value={Math.round(set.sfxVolume * 100)}
          min={0}
          max={100}
          step={5}
          display={`${Math.round(set.sfxVolume * 100)}%`}
          onChange={(v) => actions.updateSettings({ sfxVolume: v / 100 })}
        />
      </Section>

      <Section title="Controls" icon={<MousePointer2 size={16} aria-hidden="true" />}>
        <div className="grid gap-2 sm:grid-cols-3" data-testid="settings-controls-help">
          {CONTROL_REFERENCE.map((c) => (
            <div key={c.title} className="flex flex-col gap-0.5 rounded-xl bg-sky-50 p-2">
              <span className="flex items-center gap-1 text-xs font-black text-sky-900">
                {c.icon}
                {c.title}
              </span>
              {c.lines.map((line) => (
                <span key={line} className="text-[11px] font-semibold leading-snug text-sky-800">
                  {line}
                </span>
              ))}
            </div>
          ))}
        </div>
        <SliderRow
          testId="settings-look-sensitivity"
          label="Look sensitivity"
          value={Math.round(set.lookSensitivity * 100)}
          min={Math.round(LOOK_SENSITIVITY_RANGE.min * 100)}
          max={Math.round(LOOK_SENSITIVITY_RANGE.max * 100)}
          step={5}
          display={`${set.lookSensitivity.toFixed(2)}x`}
          onChange={(v) => actions.updateSettings({ lookSensitivity: v / 100 })}
        />
        <ToggleRow
          testId="settings-invert-look"
          label="Invert look (up / down)"
          on={set.invertLook}
          onToggle={() => actions.updateSettings({ invertLook: !set.invertLook })}
        />
        <p data-testid="settings-gamepad-status" className="text-xs font-bold text-sky-700">
          {s.gamepadConnected
            ? `Gamepad connected: ${s.gamepadLabel ?? 'unknown'}`
            : 'No gamepad detected — click the game, then press any button on your controller.'}
        </p>
        {s.gamepadConnected && !s.gamepadStandard && (
          <p className="text-xs font-bold text-rose-700">
            This controller reports a non-standard layout, so some buttons may not match.
          </p>
        )}
        <SliderRow
          testId="settings-gamepad-deadzone"
          label="Gamepad stick deadzone"
          value={Math.round(set.gamepadDeadzone * 100)}
          min={Math.round(GAMEPAD_DEADZONE_RANGE.min * 100)}
          max={Math.round(GAMEPAD_DEADZONE_RANGE.max * 100)}
          step={1}
          display={`${Math.round(set.gamepadDeadzone * 100)}%`}
          onChange={(v) => actions.updateSettings({ gamepadDeadzone: v / 100 })}
        />
      </Section>

      <Section title="Graphics" icon={<Monitor size={16} aria-hidden="true" />}>
        <div role="group" aria-label="Graphics quality" className="grid grid-cols-3 gap-2">
          {QUALITY_OPTIONS.map((q) => {
            const active = set.quality === q.id;
            return (
              <button
                key={q.id}
                type="button"
                data-testid={`settings-quality-${q.id}`}
                aria-pressed={active}
                onClick={() => actions.updateSettings({ quality: q.id })}
                className={`flex min-h-12 flex-col items-center justify-center rounded-xl px-2 py-1.5 text-center transition active:scale-95 ${
                  active ? 'bg-amber-300 text-amber-950 ring-2 ring-amber-500' : 'bg-sky-50 hover:bg-sky-100'
                }`}
              >
                <span className="text-sm font-black">{q.label}</span>
                <span className="text-[10px] font-semibold leading-tight">{q.hint}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Gameplay" icon={<Gamepad2 size={16} aria-hidden="true" />}>
        <ToggleRow
          testId="settings-hp-bars"
          label="Show health bars"
          on={set.showHpBars}
          onToggle={() => actions.updateSettings({ showHpBars: !set.showHpBars })}
        />
        <ToggleRow
          testId="settings-hints"
          label="Show control tips"
          on={set.showHints}
          onToggle={() => actions.updateSettings({ showHints: !set.showHints })}
        />
      </Section>

      <div className="flex justify-end">
        <button
          type="button"
          data-testid="settings-reset"
          onClick={() => actions.resetSettings()}
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-rose-100 px-4 py-2 text-sm font-black text-rose-900 shadow-sm transition hover:bg-rose-200 active:scale-95"
        >
          <RotateCcw size={16} aria-hidden="true" />
          Reset to defaults
        </button>
      </div>
    </Modal>
  );
}
