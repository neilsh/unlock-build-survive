import { Check, Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { exportModJson, type GameMod } from '../mods/mods';
import { useMods } from '../mods/modStore';
import type { GameActions } from '../types/ui';
import { Swatch } from './Chip';
import { ModCreator } from './ModCreator';
import { Modal } from './Modal';

export function downloadModJson(mod: GameMod): void {
  const json = exportModJson(mod);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${mod.id.replaceAll(/[^a-z0-9-]+/gi, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ModsModal({ actions, onClose }: { actions: GameActions; onClose: () => void }) {
  const { mods, active } = useMods();
  const [editing, setEditing] = useState<GameMod | null | 'new'>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImportText = (raw: string) => {
    const res = actions.importMod(raw);
    if (res.ok) {
      setImportText('');
      setShowImport(false);
      setImportFeedback('Mod imported and enabled!');
    } else {
      setImportFeedback(res.error ?? 'Could not import mod.');
    }
  };

  const existingIds = new Set(mods.map((m) => m.id));

  return (
    <Modal
      title={editing === 'new' ? 'Create Mod' : editing ? 'Edit Mod' : 'Mods'}
      ariaLabel="Mods"
      testId="mods-modal"
      closeTestId="mods-close"
      maxWidthClass="max-w-3xl"
      headerExtra={
        !editing &&
        active.activeCount > 0 && (
          <span className="rounded-full bg-purple-600 px-2.5 py-0.5 text-xs font-black text-white">
            {active.activeCount} active
          </span>
        )
      }
      onClose={onClose}
      onOpenChange={(open) => actions.setModalOpen(open)}
    >
      {editing ? (
        <ModCreator
          initial={editing === 'new' ? null : editing}
          existingIds={existingIds}
          onCancel={() => setEditing(null)}
          onSave={(mod) => {
            actions.saveMod(mod);
            setEditing(null);
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-sky-900">
              Toggle mod packs or create your own blocks, storms, and rules for Free Build!
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowImport(!showImport);
                  setImportFeedback(null);
                }}
                className="flex items-center gap-1 rounded-2xl bg-white px-3 py-2 text-xs font-black shadow-sm active:scale-95"
              >
                <Upload size={15} aria-hidden="true" />
                Import .json
              </button>
              <button
                type="button"
                data-testid="mod-create-open"
                onClick={() => setEditing('new')}
                className="flex items-center gap-1 rounded-2xl bg-amber-300 px-3 py-2 text-xs font-black text-amber-950 shadow-sm active:scale-95"
              >
                <Plus size={15} aria-hidden="true" />
                Create Mod
              </button>
            </div>
          </div>

          {importFeedback && (
            <p className="rounded-xl bg-sky-100 px-3 py-1.5 text-xs font-bold text-sky-950">
              {importFeedback}
            </p>
          )}

          {showImport && (
            <div className="flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black">Upload or paste a mod .json file</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    void file
                      .text()
                      .then((txt) => handleImportText(txt))
                      .catch(() => setImportFeedback('Could not read that file.'));
                  }}
                  className="text-xs font-semibold"
                />
              </div>
              <textarea
                rows={3}
                aria-label="Paste mod JSON"
                placeholder='{"name":"My Mod","blocks":[...],"disasters":[...]}'
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                className="w-full rounded-xl border border-sky-200 p-2 font-mono text-xs"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!importText.trim()}
                  onClick={() => handleImportText(importText)}
                  className="rounded-xl bg-emerald-400 px-3 py-1.5 text-xs font-black text-emerald-950 active:scale-95 disabled:opacity-50"
                >
                  Import JSON
                </button>
              </div>
            </div>
          )}

          <ul className="grid gap-2.5 sm:grid-cols-2">
            {mods.map((m) => (
              <li
                key={m.id}
                className={`flex flex-col justify-between gap-2.5 rounded-2xl p-3.5 shadow-md ${
                  m.enabled ? 'bg-purple-50 ring-2 ring-purple-300' : 'bg-white'
                }`}
              >
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-base font-black">{m.name}</div>
                      <span className="text-xs font-bold text-sky-700">
                        {m.builtIn ? 'Starter Pack' : 'Custom Mod'}
                      </span>
                    </div>
                    <button
                      type="button"
                      data-testid={`mod-toggle-${m.id}`}
                      aria-pressed={m.enabled}
                      onClick={() => actions.toggleMod(m.id)}
                      className={`flex min-h-9 items-center gap-1 rounded-full px-3 text-xs font-black shadow-sm active:scale-95 ${
                        m.enabled ? 'bg-emerald-400 text-emerald-950' : 'bg-sky-100 text-sky-900'
                      }`}
                    >
                      {m.enabled && <Check size={14} aria-hidden="true" />}
                      {m.enabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                  <p className="text-sm font-semibold text-sky-950">{m.description}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {m.blocks.map((b) => (
                      <span
                        key={b.id}
                        className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-bold shadow-xs"
                      >
                        <Swatch color={b.color} />
                        {b.label}
                      </span>
                    ))}
                    {m.disasters.map((d) => (
                      <span
                        key={d.id}
                        className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-950"
                      >
                        {d.label}
                      </span>
                    ))}
                    {m.rules?.gravityMultiplier !== undefined && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold">
                        {m.rules.gravityMultiplier}x gravity
                      </span>
                    )}
                    {m.rules?.durationSeconds !== undefined && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold">
                        {m.rules.durationSeconds}s timer
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    aria-label={`Export ${m.name}`}
                    onClick={() => downloadModJson(m)}
                    className="flex items-center gap-1 rounded-xl bg-sky-100 px-2.5 py-1.5 text-xs font-bold text-sky-900 active:scale-95"
                  >
                    <Download size={13} aria-hidden="true" />
                    Export
                  </button>
                  {!m.builtIn && (
                    <>
                      <button
                        type="button"
                        aria-label={`Edit ${m.name}`}
                        onClick={() => setEditing(m)}
                        className="flex items-center gap-1 rounded-xl bg-amber-100 px-2.5 py-1.5 text-xs font-bold text-amber-950 active:scale-95"
                      >
                        <Pencil size={13} aria-hidden="true" />
                        Edit
                      </button>
                      <button
                        type="button"
                        data-testid={`mod-delete-${m.id}`}
                        aria-label={`Delete ${m.name}`}
                        onClick={() => actions.deleteMod(m.id)}
                        className="flex items-center gap-1 rounded-xl bg-red-100 px-2.5 py-1.5 text-xs font-bold text-red-800 active:scale-95"
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
