'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import type { SimSnapshot } from '@/lib/sim/engine';
import { useLab } from '@/store/lab';
import { getPart } from '@/lib/parts';
import type { ScopeTrace } from '@/lib/sim/instruments/oscilloscope';
import { cn } from '@/lib/cn';

const W = 800;
const H = 340;
const PAD_X = 50;
const PAD_Y = 20;
const PLOT_W = W - 2 * PAD_X;
const PLOT_H = H - 2 * PAD_Y;
const DIVS_X = 10;
const DIVS_Y = 8;
const BASE_Y = PAD_Y + PLOT_H - (PLOT_H / DIVS_Y); // 1 division from bottom is 0V

export function formatScopeTime(us: number): string {
  if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(3)} s`;
  if (us >= 1_000) return `${(us / 1_000).toFixed(2)} ms`;
  return `${Math.round(us)} µs`;
}

function voltsToY(v: number | null, voltsPerDiv: number): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const pixelsPerVolt = (PLOT_H / DIVS_Y) / voltsPerDiv;
  const y = BASE_Y - v * pixelsPerVolt;
  return Math.max(PAD_Y, Math.min(PAD_Y + PLOT_H, y));
}

function buildWavePath(
  trace: ScopeTrace,
  channel: 'ch1' | 'ch2',
  voltsPerDiv: number,
): { path: string; hasNull: boolean } {
  if (trace.samples.length === 0) return { path: '', hasNull: false };
  const span = Math.max(1, trace.endUs - trace.startUs);
  const timeToX = (us: number) => PAD_X + ((us - trace.startUs) / span) * PLOT_W;

  const segments: string[] = [];
  let inSegment = false;
  let hasNull = false;

  for (let i = 0; i < trace.samples.length; i++) {
    const s = trace.samples[i]!;
    const val = channel === 'ch1' ? s.ch1 : s.ch2;
    const y = voltsToY(val, voltsPerDiv);
    const x = timeToX(s.timeUs);

    if (y !== null) {
      if (!inSegment) {
        segments.push(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
        inSegment = true;
      } else {
        segments.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
      }
    } else {
      hasNull = true;
      inSegment = false;
    }
  }

  return { path: segments.join(' '), hasNull };
}

export function ScopePanel({ snapshot }: { snapshot: SimSnapshot | null }) {
  const { t } = useI18n();
  const doc = useLab((s) => s.doc);
  const setScopePrefs = useLab((s) => s.setScopePrefs);

  const [vDiv1, setVDiv1] = useState(1);
  const [vDiv2, setVDiv2] = useState(1);
  const [holding, setHolding] = useState(false);

  const trace = snapshot?.scope;

  // Enumerate observable pins from parts on canvas
  const pinOptions = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [];
    for (const inst of doc.diagram.parts) {
      const def = getPart(inst.type);
      if (!def) continue;
      for (const pin of def.pins) {
        list.push({
          value: `${inst.id}:${pin.name}`,
          label: `${def.name} (${inst.id}) - ${pin.name}`,
        });
      }
    }
    return list;
  }, [doc.diagram.parts]);

  const ch1Source = trace?.ch1Source ?? doc.sim.scope?.ch1 ?? pinOptions[0]?.value ?? '';
  const ch2Source = trace?.ch2Source ?? doc.sim.scope?.ch2 ?? pinOptions[1]?.value ?? '';
  const timebaseUs = trace?.timebaseUsPerDiv ?? doc.sim.scope?.timebaseUs ?? 1000;
  const trigger = trace?.trigger ?? doc.sim.scope?.trigger ?? {
    mode: 'auto',
    source: 'ch1',
    slope: 'rising',
    thresholdVolts: 2.5,
  };

  const ch1Wave = trace ? buildWavePath(trace, 'ch1', vDiv1) : { path: '', hasNull: false };
  const ch2Wave = trace ? buildWavePath(trace, 'ch2', vDiv2) : { path: '', hasNull: false };

  const triggerY = voltsToY(trigger.thresholdVolts ?? 2.5, trigger.source === 'ch1' ? vDiv1 : vDiv2);

  return (
    <div className="flex h-full flex-col overflow-auto p-2 text-[11px]" lang="en">
      {/* Scope Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] pb-2">
        {/* CH1 Config */}
        <div className="flex items-center gap-1">
          <span className="font-semibold text-[#00b4d8]">CH1:</span>
          <select
            className="input py-0.5 text-[11px]"
            aria-label="Channel 1 Probe"
            value={ch1Source}
            onChange={(e) => setScopePrefs({ ch1: e.target.value })}
          >
            {pinOptions.map((opt) => (
              <option key={`ch1-${opt.value}`} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            className="input py-0.5 text-[11px]"
            aria-label="Channel 1 Volts per Division"
            value={vDiv1}
            onChange={(e) => setVDiv1(Number(e.target.value))}
          >
            <option value={0.5}>0.5 V/div</option>
            <option value={1}>1.0 V/div</option>
            <option value={2}>2.0 V/div</option>
            <option value={5}>5.0 V/div</option>
          </select>
        </div>

        {/* CH2 Config */}
        <div className="flex items-center gap-1">
          <span className="font-semibold text-[#ffb703]">CH2:</span>
          <select
            className="input py-0.5 text-[11px]"
            aria-label="Channel 2 Probe"
            value={ch2Source}
            onChange={(e) => setScopePrefs({ ch2: e.target.value })}
          >
            <option value="">None (disabled)</option>
            {pinOptions.map((opt) => (
              <option key={`ch2-${opt.value}`} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            className="input py-0.5 text-[11px]"
            aria-label="Channel 2 Volts per Division"
            value={vDiv2}
            onChange={(e) => setVDiv2(Number(e.target.value))}
          >
            <option value={0.5}>0.5 V/div</option>
            <option value={1}>1.0 V/div</option>
            <option value={2}>2.0 V/div</option>
            <option value={5}>5.0 V/div</option>
          </select>
        </div>

        {/* Timebase */}
        <div className="flex items-center gap-1">
          <span className="text-[var(--color-text-dim)]">Timebase:</span>
          <select
            className="input py-0.5 text-[11px]"
            aria-label="Timebase per division"
            value={timebaseUs}
            onChange={(e) => setScopePrefs({ timebaseUs: Number(e.target.value) })}
          >
            <option value={100}>100 µs/div</option>
            <option value={200}>200 µs/div</option>
            <option value={500}>500 µs/div</option>
            <option value={1000}>1 ms/div</option>
            <option value={2000}>2 ms/div</option>
            <option value={5000}>5 ms/div</option>
            <option value={10000}>10 ms/div</option>
            <option value={50000}>50 ms/div</option>
            <option value={100000}>100 ms/div</option>
            <option value={500000}>500 ms/div</option>
            <option value={1000000}>1 s/div</option>
          </select>
        </div>

        {/* Trigger Controls */}
        <div className="flex items-center gap-1">
          <span className="text-[var(--color-text-dim)]">Trigger:</span>
          <select
            className="input py-0.5 text-[11px]"
            aria-label="Trigger mode"
            value={trigger.mode ?? 'auto'}
            onChange={(e) =>
              setScopePrefs({
                trigger: { ...trigger, mode: e.target.value as 'auto' | 'normal' | 'single' },
              })
            }
          >
            <option value="auto">Auto</option>
            <option value="normal">Normal</option>
            <option value="single">Single</option>
          </select>
          <select
            className="input py-0.5 text-[11px]"
            aria-label="Trigger source"
            value={trigger.source ?? 'ch1'}
            onChange={(e) =>
              setScopePrefs({
                trigger: { ...trigger, source: e.target.value as 'ch1' | 'ch2' },
              })
            }
          >
            <option value="ch1">CH1</option>
            <option value="ch2">CH2</option>
          </select>
          <select
            className="input py-0.5 text-[11px]"
            aria-label="Trigger slope"
            value={trigger.slope ?? 'rising'}
            onChange={(e) =>
              setScopePrefs({
                trigger: { ...trigger, slope: e.target.value as 'rising' | 'falling' },
              })
            }
          >
            <option value="rising">Rising (↑)</option>
            <option value="falling">Falling (↓)</option>
          </select>
          <input
            type="number"
            step="0.5"
            min="0"
            max="5"
            className="input w-14 py-0.5 text-[11px]"
            aria-label="Trigger threshold volts"
            value={trigger.thresholdVolts ?? 2.5}
            onChange={(e) =>
              setScopePrefs({
                trigger: { ...trigger, thresholdVolts: Number(e.target.value) },
              })
            }
          />
          <span className="text-[10px] text-[var(--color-text-faint)]">V</span>
        </div>

        {/* Hold / Run Freeze */}
        <button
          type="button"
          aria-pressed={holding}
          onClick={() => setHolding(!holding)}
          className={cn('btn btn-sm ml-auto', holding ? 'btn-warn' : 'btn-secondary')}
        >
          {holding ? t('runScope') : t('hold')}
        </button>
      </div>

      {/* Trigger & status indicator */}
      <div className="flex items-center gap-3 py-1 text-[10.5px]">
        <span className="mono">
          Status:{' '}
          <span
            className={cn(
              'font-semibold',
              trace?.triggerState === 'triggered'
                ? 'text-[var(--color-accent)]'
                : trace?.triggerState === 'holding'
                  ? 'text-[var(--color-warn)]'
                  : 'text-[var(--color-text-dim)]',
            )}
          >
            {holding ? 'HOLD' : (trace?.triggerState?.toUpperCase() ?? 'ARMED')}
          </span>
        </span>
        {trace && (
          <span className="text-[var(--color-text-dim)]">
            Window: {formatScopeTime(trace.endUs - trace.startUs)} · {trace.samples.length} samples
            {trace.dropped > 0 && ` (${trace.dropped} dropped)`}
          </span>
        )}
        <span className="text-[10px] text-[var(--color-text-faint)]">
          Calibrated virtual-time oscilloscope (100 µs/div .. 1 s/div). Floating nets show unknown.
        </span>
      </div>

      {/* Screen SVG Reticle & Waves */}
      <div className="relative mt-1 flex-1 min-h-[220px] rounded border border-[var(--color-border)] bg-[#070b0e] p-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-full w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label="Oscilloscope display reticle"
        >
          {/* Grid background */}
          {Array.from({ length: DIVS_X + 1 }).map((_, i) => {
            const x = PAD_X + i * (PLOT_W / DIVS_X);
            return (
              <line
                key={`gx-${i}`}
                x1={x}
                x2={x}
                y1={PAD_Y}
                y2={PAD_Y + PLOT_H}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={i === 0 || i === DIVS_X ? 1.2 : 0.6}
                strokeDasharray={i === DIVS_X / 2 ? 'none' : '2,2'}
              />
            );
          })}
          {Array.from({ length: DIVS_Y + 1 }).map((_, i) => {
            const y = PAD_Y + i * (PLOT_H / DIVS_Y);
            return (
              <line
                key={`gy-${i}`}
                x1={PAD_X}
                x2={PAD_X + PLOT_W}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={i === 0 || i === DIVS_Y ? 1.2 : 0.6}
                strokeDasharray={i === DIVS_Y / 2 ? 'none' : '2,2'}
              />
            );
          })}

          {/* 0V Ground reference line */}
          <line
            x1={PAD_X}
            x2={PAD_X + PLOT_W}
            y1={BASE_Y}
            y2={BASE_Y}
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={1}
          />
          <text x={PAD_X - 18} y={BASE_Y + 4} fontSize={10} fill="var(--color-text-faint)">
            GND
          </text>

          {/* Trigger level reference line */}
          {triggerY !== null && (
            <g>
              <line
                x1={PAD_X}
                x2={PAD_X + PLOT_W}
                y1={triggerY}
                y2={triggerY}
                stroke="rgba(230,57,70,0.5)"
                strokeWidth={0.8}
                strokeDasharray="4,4"
              />
              <polygon
                points={`${PAD_X + PLOT_W},${triggerY - 4} ${PAD_X + PLOT_W + 8},${triggerY} ${PAD_X + PLOT_W},${triggerY + 4}`}
                fill="#e63946"
              />
            </g>
          )}

          {/* Traces */}
          {ch1Wave.path && (
            <path
              d={ch1Wave.path}
              fill="none"
              stroke="#00b4d8"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {ch2Wave.path && (
            <path
              d={ch2Wave.path}
              fill="none"
              stroke="#ffb703"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Scale labels */}
          {trace && (
            <>
              <text x={PAD_X} y={H - 5} fontSize={10} fill="var(--color-text-faint)">
                {formatScopeTime(trace.startUs)}
              </text>
              <text x={PAD_X + PLOT_W} y={H - 5} textAnchor="end" fontSize={10} fill="var(--color-text-faint)">
                {formatScopeTime(trace.endUs)}
              </text>
            </>
          )}
        </svg>
      </div>

      {/* Auto-measurements table */}
      <div className="mt-2 overflow-x-auto border-t border-[var(--color-border)] pt-1">
        <table className="mono w-full text-left text-[10px]">
          <caption className="text-left font-semibold text-[var(--color-text-dim)]">
            Auto-measurements
          </caption>
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-faint)]">
              <th scope="col" className="p-1">Channel</th>
              <th scope="col" className="p-1">Vpp</th>
              <th scope="col" className="p-1">Vmax</th>
              <th scope="col" className="p-1">Vmin</th>
              <th scope="col" className="p-1">Vavg</th>
              <th scope="col" className="p-1">Vrms</th>
              <th scope="col" className="p-1">Frequency</th>
              <th scope="col" className="p-1">Duty</th>
              <th scope="col" className="p-1">Rise time</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--color-border)] text-[#00b4d8]">
              <td className="p-1 font-semibold">CH1</td>
              <td className="p-1">{trace?.measurements.ch1.vpp !== null ? `${trace?.measurements.ch1.vpp} V` : '---'}</td>
              <td className="p-1">{trace?.measurements.ch1.vmax !== null ? `${trace?.measurements.ch1.vmax} V` : '---'}</td>
              <td className="p-1">{trace?.measurements.ch1.vmin !== null ? `${trace?.measurements.ch1.vmin} V` : '---'}</td>
              <td className="p-1">{trace?.measurements.ch1.vmean !== null ? `${trace?.measurements.ch1.vmean} V` : '---'}</td>
              <td className="p-1">{trace?.measurements.ch1.vrms !== null ? `${trace?.measurements.ch1.vrms} V` : '---'}</td>
              <td className="p-1">{trace?.measurements.ch1.frequencyHz !== null ? `${trace?.measurements.ch1.frequencyHz} Hz` : '---'}</td>
              <td className="p-1">{trace?.measurements.ch1.dutyCyclePercent !== null ? `${trace?.measurements.ch1.dutyCyclePercent}%` : '---'}</td>
              <td className="p-1">{trace?.measurements.ch1.riseTimeUs !== null ? `${trace?.measurements.ch1.riseTimeUs} µs` : '---'}</td>
            </tr>
            {ch2Source && (
              <tr className="border-b border-[var(--color-border)] text-[#ffb703]">
                <td className="p-1 font-semibold">CH2</td>
                <td className="p-1">{trace?.measurements.ch2.vpp !== null ? `${trace?.measurements.ch2.vpp} V` : '---'}</td>
                <td className="p-1">{trace?.measurements.ch2.vmax !== null ? `${trace?.measurements.ch2.vmax} V` : '---'}</td>
                <td className="p-1">{trace?.measurements.ch2.vmin !== null ? `${trace?.measurements.ch2.vmin} V` : '---'}</td>
                <td className="p-1">{trace?.measurements.ch2.vmean !== null ? `${trace?.measurements.ch2.vmean} V` : '---'}</td>
                <td className="p-1">{trace?.measurements.ch2.vrms !== null ? `${trace?.measurements.ch2.vrms} V` : '---'}</td>
                <td className="p-1">{trace?.measurements.ch2.frequencyHz !== null ? `${trace?.measurements.ch2.frequencyHz} Hz` : '---'}</td>
                <td className="p-1">{trace?.measurements.ch2.dutyCyclePercent !== null ? `${trace?.measurements.ch2.dutyCyclePercent}%` : '---'}</td>
                <td className="p-1">{trace?.measurements.ch2.riseTimeUs !== null ? `${trace?.measurements.ch2.riseTimeUs} µs` : '---'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
