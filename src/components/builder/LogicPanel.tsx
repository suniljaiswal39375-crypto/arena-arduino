'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import type { SimSnapshot } from '@/lib/sim/engine';
import { LOGIC_CHANNELS, toVcd, type LogicLevel, type LogicTrace } from '@/lib/sim/instruments/logic-analyzer';
import { useLab } from '@/store/lab';

const W = 800;
const LEFT = 68;
const PLOT = W - LEFT - 12;
const ROW = 25;
const HEIGHT = 8 * ROW + 42;

export function formatLogicTime(ns: number): string {
  if (ns >= 1_000_000) return `${(ns / 1_000_000).toFixed(3)} ms`;
  if (ns >= 1_000) return `${(ns / 1_000).toFixed(3)} µs`;
  return `${Math.round(ns)} ns`;
}

function waveY(row: number, level: LogicLevel): number {
  const mid = 21 + row * ROW;
  return level === '1' ? mid - 7 : level === '0' ? mid + 7 : mid;
}

/** Step path: a change at t draws a vertical edge, not a sloped sample. */
function wavePath(trace: LogicTrace, channel: number): string {
  const span = Math.max(1, trace.endNs - trace.startNs);
  const x = (ns: number) => LEFT + ((ns - trace.startNs) / span) * PLOT;
  let level = trace.initial[channel] ?? 'x';
  const steps = [`M ${LEFT} ${waveY(channel, level)}`];
  for (const edge of trace.edges) {
    if (edge.channel !== channel) continue;
    const at = x(edge.timeNs).toFixed(2);
    steps.push(`L ${at} ${waveY(channel, level)}`);
    level = edge.value;
    steps.push(`L ${at} ${waveY(channel, level)}`);
  }
  steps.push(`L ${LEFT + PLOT} ${waveY(channel, level)}`);
  return steps.join(' ');
}

function downloadVcd(trace: LogicTrace, projectName: string): void {
  const blob = new Blob([toVcd(trace)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${projectName.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60) || 'capture'}.vcd`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LogicPanel({ snapshot }: { snapshot: SimSnapshot | null }) {
  const { t } = useI18n();
  const doc = useLab((s) => s.doc);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const captures = snapshot?.logicAnalyzers ?? [];
  const trace = captures.find((c) => c.id === selectedId) ?? captures[0];
  if (!trace) {
    return <p className="p-3 text-[12.5px] text-[var(--color-text-faint)]">{t('logicEmpty')}</p>;
  }

  return (
    <div className="h-full overflow-auto p-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2 pb-1">
        {captures.length > 1 && (
          <label className="flex items-center gap-1">
            {t('logic')}
            <select aria-label={t('logic')} className="input py-0.5" value={trace.id}
              onChange={(event) => setSelectedId(event.target.value)}>
              {captures.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        )}
        <span className="mono" lang="en">{trace.label} · {trace.edges.length} edges · {formatLogicTime(trace.endNs - trace.startNs)} retained</span>
        <button type="button" className="btn btn-sm ml-auto" disabled={!trace.grounded}
          onClick={() => downloadVcd(trace, doc.name)}>{t('exportVcd')}</button>
      </div>
      {!trace.grounded && <p className="text-[var(--color-warn)]">{t('logicGroundRequired')}</p>}
      {trace.dropped > 0 && <p lang="en" className="text-[var(--color-warn)]">
        Bounded window: {trace.dropped} older edges dropped; export begins at {formatLogicTime(trace.startNs)}.
      </p>}
      <div lang="en" className="text-[10px] text-[var(--color-text-faint)]">
        Observable net edges, not a 1 GHz physical sampler. AVR GPIO writes: 16 MHz cycle timestamps rounded to 1 ns.
        Functional writes: virtual µs; averaged PWM/unknown nets appear as X. No trigger or internal CPU probe.
      </div>
      <div className="mt-1 overflow-x-auto" lang="en">
        <svg viewBox={`0 0 ${W} ${HEIGHT}`} width="100%" style={{ minWidth: 560 }} role="img"
          aria-label={`Logic analyzer: eight digital channels from ${formatLogicTime(trace.startNs)} to ${formatLogicTime(trace.endNs)}`}>
          {LOGIC_CHANNELS.map((name, i) => (
            <g key={name}>
              <line x1={LEFT} x2={LEFT + PLOT} y1={21 + i * ROW} y2={21 + i * ROW}
                stroke="var(--color-border)" strokeWidth={0.7} />
              <text x={3} y={25 + i * ROW} fontSize={12} fill="var(--color-text-dim)">
                {name}: {trace.channels[i]?.level ?? 'x'}
              </text>
              <path d={wavePath(trace, i)} fill="none" stroke={trace.channels[i]?.level === 'x' ? 'var(--color-text-faint)' : 'var(--color-accent)'}
                strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          <text x={LEFT} y={HEIGHT - 10} fontSize={11} fill="var(--color-text-faint)">
            {formatLogicTime(trace.startNs)}
          </text>
          <text x={LEFT + PLOT} y={HEIGHT - 10} textAnchor="end" fontSize={11} fill="var(--color-text-faint)">
            {formatLogicTime(trace.endNs)}
          </text>
        </svg>
      </div>
      <div lang="en" className="mono flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--color-text-dim)]">
        {trace.channels.map((channel) => <span key={channel.name}>{channel.name} ← {channel.source}</span>)}
      </div>
      {trace.edges.length > 0 && (
        <table lang="en" className="mono mt-2 w-full text-left text-[10px]">
          <caption className="text-left text-[var(--color-text-faint)]">Latest observed changes</caption>
          <thead><tr><th scope="col">Virtual time</th><th scope="col">Channel</th><th scope="col">Level</th></tr></thead>
          <tbody>{trace.edges.slice(-8).map((edge, i) => (
            <tr key={`${edge.timeNs}-${edge.channel}-${i}`} className="border-t border-[var(--color-border)]">
              <td>{formatLogicTime(edge.timeNs)}</td><td>D{edge.channel}</td><td>{edge.value.toUpperCase()}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
