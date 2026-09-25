'use client';

import { useI18n } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLab, type DockTab } from '@/store/lab';
import { getPart } from '@/lib/parts';
import type { SimSnapshot } from '@/lib/sim/engine';
import type { BuildMessage } from '@/lib/sim/firmware/build-events';
import { AlertTriangle, Info, XOctagon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { LogicPanel } from './LogicPanel';
import { MqttPanel } from './MqttPanel';
import { ScopePanel } from './ScopePanel';
import { MultimeterPanel } from './MultimeterPanel';

const TABS: Array<{ id: DockTab; label: MessageKey }> = [
  { id: 'serial', label: 'serial' },
  { id: 'plotter', label: 'plotter' },
  { id: 'scope', label: 'scope' },
  { id: 'logic', label: 'logic' },
  { id: 'multimeter', label: 'multimeter' },
  { id: 'mqtt', label: 'mqtt' },
  { id: 'inputs', label: 'inputs' },
  { id: 'diagnostics', label: 'diagnostics' },
  { id: 'build', label: 'buildLogs' },
];

export function BottomDock({
  snapshot,
  onSend,
  buildEvents = [],
}: {
  snapshot: SimSnapshot | null;
  onSend: (text: string) => void;
  buildEvents?: BuildMessage[];
}) {
  const { t: text, locale } = useI18n();
  const dock = useLab((s) => s.dock);
  const setDock = useLab((s) => s.setDock);
  const diagnostics = useLab((s) => s.diagnostics);

  const counts = {
    error: diagnostics.filter((d) => d.severity === 'error').length,
    warning: diagnostics.filter((d) => d.severity === 'warning').length,
  };

  return (
    <div lang={locale} className="flex h-full flex-col">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] px-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={dock === t.id}
            onClick={() => setDock(t.id)}
            className={cn(
              'relative px-3 py-2 text-[12.5px] font-medium transition-colors',
              dock === t.id
                ? 'text-[var(--color-accent)]'
                : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]',
            )}
          >
            {text(t.label)}
            {t.id === 'diagnostics' && counts.error + counts.warning > 0 && (
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]',
                  counts.error > 0
                    ? 'bg-[#2a1418] text-[var(--color-fault)]'
                    : 'bg-[#2a2109] text-[var(--color-warn)]',
                )}
              >
                {counts.error + counts.warning}
              </span>
            )}
            {dock === t.id && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-[var(--color-accent)]" />
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {dock === 'serial' && <SerialPanel snapshot={snapshot} onSend={onSend} />}
        {dock === 'plotter' && <div lang="en" className="h-full"><PlotterPanel snapshot={snapshot} /></div>}
        {dock === 'scope' && <ScopePanel snapshot={snapshot} />}
        {dock === 'logic' && <LogicPanel snapshot={snapshot} />}
        {dock === 'multimeter' && <MultimeterPanel snapshot={snapshot} />}
        {dock === 'mqtt' && <div className="h-full"><MqttPanel /></div>}
        {dock === 'inputs' && <div lang="en" className="h-full"><InputsPanel /></div>}
        {dock === 'diagnostics' && <div lang="en" className="h-full"><DiagnosticsPanel /></div>}
        {dock === 'build' && (
          <div role="log" aria-label={text('buildLogs')} className="mono h-full overflow-auto p-3 text-[11px] leading-relaxed">
            {buildEvents.length === 0 ? <p className="text-[var(--color-text-faint)]">{text('buildEmpty')}</p> :
              buildEvents.map((event, index) => (
                <div key={index} lang="en" className={cn('whitespace-pre-wrap break-all', event.type === 'error' && 'text-[var(--color-fault)]')}>
                  {event.text}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ serial */

function SerialPanel({
  snapshot,
  onSend,
}: {
  snapshot: SimSnapshot | null;
  onSend: (text: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement | null>(null);
  const lines = snapshot?.serial ?? [];
  const dropped = snapshot?.serialDropped ?? 0;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="flex h-full flex-col">
      {dropped > 0 && (
        <p className="border-b border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-faint)]">
          {t('serialDropped', { count: dropped })}
        </p>
      )}
      <div ref={scroller} className="mono min-h-0 flex-1 overflow-y-auto p-2 text-[12px] leading-relaxed">
        {lines.length === 0 ? (
          <p className="p-1 text-[var(--color-text-faint)]">
            {t('serialEmpty')}
          </p>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 text-[var(--color-text-faint)]">
                {(l.at / 1000000).toFixed(2)}s
              </span>
              <span className="whitespace-pre-wrap break-all">{l.text.replace(/\n$/, '')}</span>
            </div>
          ))
        )}
      </div>
      <form
        className="flex gap-2 border-t border-[var(--color-border)] p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft) return;
          onSend(draft.endsWith('\n') ? draft : `${draft}\n`);
          setDraft('');
        }}
      >
        <input
          className="input mono"
          placeholder={t('sendPlaceholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={t('sendLabel')}
        />
        <button className="btn btn-sm" type="submit">
          {t('send')}
        </button>
      </form>
    </div>
  );
}

/* ----------------------------------------------------------------- plotter */

function PlotterPanel({ snapshot }: { snapshot: SimSnapshot | null }) {
  const series = snapshot?.plot ?? [];
  const labels = snapshot?.plotLabels ?? [];
  if (series.length === 0 || series.every((s) => s.length === 0)) {
    return (
      <p className="p-3 text-[12.5px] text-[var(--color-text-faint)]">
        Print numbers separated by spaces or commas and they will plot here, exactly like the
        Arduino serial plotter.
      </p>
    );
  }

  const width = 100;
  const height = 100;
  const all = series.flat();
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const colours = ['#00b4d8', '#ffb703', '#2a9d8f', '#8b7cf6', '#e63946', '#ff8fab'];

  return (
    <div className="h-full p-2">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={f * height}
            y2={f * height}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={0.4}
          />
        ))}
        {series.map((data, si) => {
          if (data.length < 2) return null;
          const step = width / Math.max(1, data.length - 1);
          const d = data
            .map((v, i) => {
              const y = height - ((v - min) / span) * height;
              return `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(2)} ${y.toFixed(2)}`;
            })
            .join(' ');
          return (
            <path
              key={si}
              d={d}
              fill="none"
              stroke={colours[si % colours.length]}
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      <div className="mono flex justify-between px-1 text-[10.5px] text-[var(--color-text-faint)]">
        <span>{min.toFixed(1)}</span>
        <span>
          {series
            .map((s, i) => `${labels[i] ?? `series ${i + 1}`} (${s.length})`)
            .join(' · ') || `${series.length} series`}
        </span>
        <span>{max.toFixed(1)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ inputs */

function InputsPanel() {
  const doc = useLab((s) => s.doc);
  const setInput = useLab((s) => s.setInput);

  const controls = useMemo(() => {
    const out: Array<{
      key: string;
      partName: string;
      label: string;
      min: number;
      max: number;
      step: number;
      unit: string;
      value: number;
    }> = [];
    for (const inst of doc.diagram.parts) {
      const def = getPart(inst.type);
      if (!def) continue;
      for (const c of def.controls) {
        const raw = doc.sim.inputs[c.id] ?? c.default ?? 0;
        out.push({
          key: c.id,
          partName: def.name,
          label: c.label,
          min: c.min ?? 0,
          max: c.max ?? (c.kind === 'toggle' ? 1 : 1023),
          step: c.step ?? (c.kind === 'toggle' ? 1 : 1),
          unit: c.unit ?? '',
          value: typeof raw === 'number' ? raw : Number(raw) || 0,
        });
      }
    }
    return out;
  }, [doc]);

  if (controls.length === 0) {
    return (
      <p className="p-3 text-[12.5px] text-[var(--color-text-faint)]">
        No sensors or inputs on the canvas yet. Add a sensor, a potentiometer or a button and its
        controls appear here.
      </p>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {controls.map((c) => (
          <label key={c.key} className="panel-2 block px-3 py-2">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[12px] font-medium">{c.label}</span>
              <span className="mono text-[12px] text-[var(--color-accent)]">
                {c.value}
                {c.unit}
              </span>
            </span>
            <span className="block truncate text-[10.5px] text-[var(--color-text-faint)]">
              {c.partName}
            </span>
            <input
              type="range"
              className="mt-1.5 w-full accent-[var(--color-accent)]"
              min={c.min}
              max={c.max}
              step={c.step}
              value={c.value}
              onChange={(e) => setInput(c.key, Number(e.target.value))}
              aria-label={`${c.label} on ${c.partName}`}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- diagnostics */

function DiagnosticsPanel() {
  const diagnostics = useLab((s) => s.diagnostics);
  const select = useLab((s) => s.select);

  if (diagnostics.length === 0) {
    return (
      <p className="p-3 text-[12.5px] text-[var(--color-text-faint)]">
        No findings. The electrical rule check runs continuously as you wire.
      </p>
    );
  }

  return (
    <div className="h-full space-y-2 overflow-y-auto p-3">
      {diagnostics.map((d) => (
        <div
          key={d.id}
          className={cn(
            'rounded-lg border px-3 py-2 text-[12px]',
            d.severity === 'error'
              ? 'border-[#55262c] bg-[#2a1418]'
              : d.severity === 'warning'
                ? 'border-[#5c4405] bg-[#2a2109]'
                : 'border-[var(--color-border)] bg-[var(--color-surface-2)]',
          )}
        >
          <div className="flex items-start gap-2">
            {d.severity === 'error' ? (
              <XOctagon size={14} className="mt-0.5 shrink-0 text-[var(--color-fault)]" />
            ) : d.severity === 'warning' ? (
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
            ) : (
              <Info size={14} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{d.title}</span>
                <code className="mono rounded bg-black/30 px-1.5 py-0.5 text-[10.5px] text-[var(--color-text-dim)]">
                  {d.code}
                </code>
                {d.parts.length > 0 && (
                  <button
                    type="button"
                    className="text-[11px] text-[var(--color-accent)] hover:underline"
                    onClick={() => select(d.parts[0] ?? null)}
                  >
                    show part
                  </button>
                )}
              </div>
              <p className="mt-1 text-[var(--color-text-dim)]">{d.explanation}</p>
              <p className="mt-1 text-[var(--color-text-dim)]">{d.why}</p>
              <p className="mt-1 text-[var(--color-text)]">{d.fix}</p>
              <div className="mt-1.5 flex flex-wrap gap-2 text-[10.5px] text-[var(--color-text-faint)]">
                {d.skill && <span className="chip">{d.skill}</span>}
                {d.ncert && <span className="chip">{d.ncert}</span>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
