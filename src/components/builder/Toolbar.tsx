'use client';

import { useI18n } from '@/lib/i18n/client';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { useState } from 'react';
import { useLab } from '@/store/lab';
import { templateDoc, templates } from '@/lib/templates';
import { missionWorkspace } from '@/lib/missions/workspace';
import { missionPresentation, LEVEL_MESSAGES } from '@/lib/missions/localize';
import { MISSIONS } from '@/lib/missions/missions';
import { Box, Eraser, Play, Redo2, RotateCcw, Sparkles, Square, Undo2 } from 'lucide-react';
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
  onMentor,
  onWorkbench,
}: {
  running: boolean;
  snapshot: SimSnapshot | null;
  onRun: () => void;
  onStop: () => void;
  onReset: () => void;
  onSpeed: (value: number) => void;
  speed: number;
  onMentor?: () => void;
  onWorkbench?: () => void;
}) {
  const { t, locale } = useI18n();
  const saveError = useLab(s => s.saveError);
  const hasSaved = useLab(s => s.hasSaved);
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
    <div role="region" aria-label={t('labControls')} lang={locale} className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <span className="mr-1 text-[13px] font-semibold tracking-tight">
        {PRODUCT_NAME}
        <span className="ml-1.5 text-[10.5px] font-normal text-[var(--color-text-faint)]">
          {t('builder')}
        </span>
      </span>

      <span role="status" className="text-xs text-[var(--color-text-dim)]">{saveError ? t('saveError') : t(dirty || !hasSaved ? 'saving' : 'saved')}</span>
      <input
        className="input max-w-[220px] flex-1"
        style={{ minWidth: 140, flexBasis: 160 }}
        value={doc.name}
        onChange={(e) => rename(e.target.value)}
        aria-label={t('projectName')}
      />

      <button
        type="button"
        onClick={running ? onStop : onRun}
        className={running ? 'btn btn-danger' : 'btn btn-primary'}
      >
        {running ? <Square size={13} /> : <Play size={13} />}
        {t(running ? 'stop' : 'run')}
      </button>
      <button type="button" className="btn" onClick={onReset}>
        <RotateCcw size={13} /> {t('reset')}
      </button>
      {onMentor && (
        <button type="button" className="btn" onClick={onMentor} title={t('mentorTitle')}>
          <Sparkles size={13} /> {t('mentor')}
        </button>
      )}
      {onWorkbench && (
        <button type="button" className="btn" onClick={onWorkbench} title={t('workbench')}>
          <Box size={13} /> {t('workbenchOpen')}
        </button>
      )}

      <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-dim)]">
        {t('speed')}
        <select
          className="input" style={{ width: 76 }}
          value={speed}
          onChange={(e) => onSpeed(Number(e.target.value))}
          aria-label={t('simulationSpeed')}
        >
          <option value={0.25}>0.25x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-dim)]">
        {t('engine')}
        <select
          className="input" style={{ width: 110 }}
          value={doc.engine}
          onChange={(e) => useLab.getState().setEngine(e.target.value as 'auto' | 'functional' | 'firmware')}
          aria-label={t('simulationEngine')}
        >
          <option value="auto">{t('auto')}</option>
          <option value="functional">{t('functional')}</option>
          <option value="firmware">{t('firmware')}</option>
        </select>
      </label>

      <span className="mono rounded bg-[var(--color-surface-2)] px-2 py-1 text-[11px] text-[var(--color-text-dim)]">
        t={clockSeconds.toFixed(2)}s
      </span>

      <div className="relative" onKeyDown={e => { if (e.key === 'Escape') { setMenu('none'); e.stopPropagation(); e.currentTarget.querySelector('button')?.focus(); } }}>
        <button
          type="button"
          className="btn"
          aria-expanded={menu === 'templates'}
          onClick={() => setMenu(menu === 'templates' ? 'none' : 'templates')}
        >
          {t('templates')}
        </button>
        {menu === 'templates' && (
          <div className="fixed inset-x-2 top-28 z-30 max-h-[65dvh] overflow-y-auto sm:absolute sm:inset-x-auto sm:left-0 sm:top-9 sm:w-64 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-1 shadow-xl">
            {templates().map((t) => (
              <button
                key={t.slug}
                type="button"
                lang="en"
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

      <div className="relative" onKeyDown={e => { if (e.key === 'Escape') { setMenu('none'); e.stopPropagation(); e.currentTarget.querySelector('button')?.focus(); } }}>
        <button
          type="button"
          className="btn"
          aria-expanded={menu === 'missions'}
          onClick={() => setMenu(menu === 'missions' ? 'none' : 'missions')}
        >
          {t('missions')}
        </button>
        {menu === 'missions' && (
          <div className="fixed inset-x-2 top-28 z-30 max-h-[65dvh] overflow-y-auto sm:absolute sm:inset-x-auto sm:left-0 sm:top-9 sm:max-h-80 sm:w-72 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-1 shadow-xl">
            {MISSIONS.map((m) => {
              const { content: display, lang } = missionPresentation(m, locale);
              return (
              <button
                key={m.slug}
                type="button"
                lang={lang}
                className="block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--color-surface-3)]"
                onClick={() => {
                  loadDoc(missionWorkspace(m.slug));
                  setMenu('none');
                }}
              >
                <span className="block text-[12.5px] font-medium">
                  {m.emoji} {display.title}
                </span>
                <span className="block text-[11px] text-[var(--color-text-dim)]">
                  {t(LEVEL_MESSAGES[m.level])} · {t('minutes', { count: m.estMinutes })}
                </span>
              </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="ml-auto flex max-w-full flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={undo}
          disabled={past.length === 0}
          aria-label={t('undo')}
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={redo}
          disabled={future.length === 0}
          aria-label={t('redo')}
        >
          <Redo2 size={14} />
        </button>
        <LanguageSwitch />
        <div lang="en"><ProjectFiles /></div>
        <button type="button" className="btn btn-sm btn-danger" onClick={clearCanvas}>
          <Eraser size={13} /> {t('clear')}
        </button>
      </div>
    </div>
  );
}
