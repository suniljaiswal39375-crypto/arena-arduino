'use client';

import { useState } from 'react';
import { useLab } from '@/store/lab';
import { templateDoc, templates } from '@/lib/templates';
import { missionWorkspace } from '@/lib/missions/workspace';
import { MISSIONS } from '@/lib/missions/missions';
import { Eraser, Play, Redo2, RotateCcw, Square, Undo2 } from 'lucide-react';
import type { SimSnapshot } from '@/lib/sim/engine';
import { ProjectFiles } from './ProjectFiles';
import { PRODUCT_NAME } from '@/lib/brand';

export function Toolbar({
  running,
  snapshot,
  onRun,
  onStop,
  onReset,
  onSpeed,
  speed,
}: {
  running: boolean;
  snapshot: SimSnapshot | null;
  onRun: () => void;
  onStop: () => void;
  onReset: () => void;
  onSpeed: (value: number) => void;
  speed: number;
}) {
  const saveError = useLab(s => s.saveError);
  const dirty = useLab(s => s.dirty);
  const doc = useLab((s) => s.doc);
  const undo = useLab((s) => s.undo);
  const redo = useLab((s) => s.redo);
  const past = useLab((s) => s.past);
  const future = useLab((s) => s.future);
  const rename = useLab((s) => s.rename);
  const loadDoc = useLab((s) => s.loadDoc);
  const clearCanvas = useLab((s) => s.clearCanvas);
  const [menu, setMenu] = useState<'none' | 'templates' | 'missions'>('none');

  const clockSeconds = (snapshot?.clockUs ?? 0) / 1_000_000;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <span className="mr-1 text-[13px] font-semibold tracking-tight">
        {PRODUCT_NAME}
        <span className="ml-1.5 text-[10.5px] font-normal text-[var(--color-text-faint)]">
          builder
        </span>
      </span>

      <span role="status" className="text-xs text-[var(--color-text-dim)]">{saveError ?? (dirty ? 'Saving…' : 'Saved locally')}</span>
      <input
        className="input max-w-[220px] flex-1"
        value={doc.name}
        onChange={(e) => rename(e.target.value)}
        aria-label="Project name"
      />

      <button
        type="button"
        onClick={running ? onStop : onRun}
        className={running ? 'btn btn-danger' : 'btn btn-primary'}
      >
        {running ? <Square size={13} /> : <Play size={13} />}
        {running ? 'Stop' : 'Run'}
      </button>
      <button type="button" className="btn" onClick={onReset}>
        <RotateCcw size={13} /> Reset
      </button>

      <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-dim)]">
        Speed
        <select
          className="input w-[76px]"
          value={speed}
          onChange={(e) => onSpeed(Number(e.target.value))}
          aria-label="Simulation speed"
        >
          <option value={0.25}>0.25x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-dim)]">
        Engine
        <select
          className="input w-[104px]"
          value={doc.engine}
          onChange={(e) => useLab.getState().setEngine(e.target.value as 'auto' | 'functional' | 'firmware')}
          aria-label="Simulation engine"
        >
          <option value="auto">Auto</option>
          <option value="functional">Functional</option>
          <option value="firmware">Firmware</option>
        </select>
      </label>

      <span className="mono rounded bg-[var(--color-surface-2)] px-2 py-1 text-[11px] text-[var(--color-text-dim)]">
        t={clockSeconds.toFixed(2)}s
      </span>

      <div className="relative">
        <button
          type="button"
          className="btn"
          onClick={() => setMenu(menu === 'templates' ? 'none' : 'templates')}
        >
          Templates
        </button>
        {menu === 'templates' && (
          <div className="absolute left-0 top-9 z-30 w-64 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-1 shadow-xl">
            {templates().map((t) => (
              <button
                key={t.slug}
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--color-surface-3)]"
                onClick={() => {
                  const next = templateDoc(t.slug);
                  if (next) loadDoc(next);
                  setMenu('none');
                }}
              >
                <span className="block text-[12.5px] font-medium">{t.name}</span>
                <span className="block text-[11px] text-[var(--color-text-dim)]">
                  {t.description}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          className="btn"
          onClick={() => setMenu(menu === 'missions' ? 'none' : 'missions')}
        >
          Missions
        </button>
        {menu === 'missions' && (
          <div className="absolute left-0 top-9 z-30 max-h-80 w-72 overflow-y-auto rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-1 shadow-xl">
            {MISSIONS.map((m) => (
              <button
                key={m.slug}
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--color-surface-3)]"
                onClick={() => {
                  loadDoc(missionWorkspace(m.slug));
                  setMenu('none');
                }}
              >
                <span className="block text-[12.5px] font-medium">
                  {m.emoji} {m.title}
                </span>
                <span className="block text-[11px] text-[var(--color-text-dim)]">
                  {m.level} · {m.estMinutes} min
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={undo}
          disabled={past.length === 0}
          aria-label="Undo"
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={redo}
          disabled={future.length === 0}
          aria-label="Redo"
        >
          <Redo2 size={14} />
        </button>
        <ProjectFiles />
        <button type="button" className="btn btn-sm btn-danger" onClick={clearCanvas}>
          <Eraser size={13} /> Clear
        </button>
      </div>
    </div>
  );
}
