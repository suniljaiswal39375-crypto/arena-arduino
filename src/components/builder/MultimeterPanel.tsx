'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import type { SimSnapshot } from '@/lib/sim/engine';
import { useLab } from '@/store/lab';
import { getPart } from '@/lib/parts';
import type { MultimeterMode } from '@/lib/sim/instruments/multimeter';
import { cn } from '@/lib/cn';
import { Volume2, VolumeX } from 'lucide-react';

const MODES: Array<{ id: MultimeterMode; label: string; symbol: string }> = [
  { id: 'dc-v', label: 'DC Voltage', symbol: 'V⎓' },
  { id: 'dc-i', label: 'DC Current', symbol: 'mA⎓' },
  { id: 'resistance', label: 'Resistance', symbol: 'Ω' },
  { id: 'continuity', label: 'Continuity', symbol: '🔊' },
  { id: 'diode', label: 'Diode Test', symbol: '⏵|' },
];

export function MultimeterPanel({ snapshot }: { snapshot: SimSnapshot | null }) {
  const { t } = useI18n();
  const doc = useLab((s) => s.doc);
  const setMultimeterPrefs = useLab((s) => s.setMultimeterPrefs);

  const [soundEnabled, setSoundEnabled] = useState(false);

  // Available pins on canvas
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

  const mode = doc.sim.multimeter?.mode ?? 'dc-v';
  const probeA = doc.sim.multimeter?.probeA ?? pinOptions[0]?.value ?? '';
  const probeB =
    doc.sim.multimeter?.probeB ??
    pinOptions.find((p) => p.value.endsWith(':GND'))?.value ??
    pinOptions[1]?.value ??
    '';

  const reading = snapshot?.multimeter;

  return (
    <div className="flex h-full flex-col overflow-auto p-3 text-[11px]" lang="en">
      {/* Probe Configuration Controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] pb-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#e63946]" title="Positive Probe" />
          <span className="font-semibold text-[var(--color-text-dim)]">Probe A (+):</span>
          <select
            className="input py-0.5 text-[11px]"
            aria-label="Probe A positive node"
            value={probeA}
            onChange={(e) => setMultimeterPrefs({ probeA: e.target.value })}
          >
            {pinOptions.map((opt) => (
              <option key={`probeA-${opt.value}`} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#1b263b] border border-[#778da9]" title="Negative Probe / Ground" />
          <span className="font-semibold text-[var(--color-text-dim)]">Probe B (-):</span>
          <select
            className="input py-0.5 text-[11px]"
            aria-label="Probe B negative node"
            value={probeB}
            onChange={(e) => setMultimeterPrefs({ probeB: e.target.value })}
          >
            {pinOptions.map((opt) => (
              <option key={`probeB-${opt.value}`} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {mode === 'continuity' && (
            <button
              type="button"
              className={cn('btn btn-sm flex items-center gap-1', soundEnabled ? 'btn-accent' : 'btn-secondary')}
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? 'Mute buzzer' : 'Enable buzzer audio'}
            >
              {soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
              <span>{soundEnabled ? 'Beep ON' : 'Beep Mute'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Mode Dial Buttons */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            onClick={() => setMultimeterPrefs({ mode: m.id })}
            className={cn(
              'rounded border px-2.5 py-1 text-[11px] font-medium transition-colors',
              mode === m.id
                ? 'border-[var(--color-accent)] bg-[#00b4d81a] text-[var(--color-accent)]'
                : 'border-[var(--color-border)] bg-transparent text-[var(--color-text-dim)] hover:text-[var(--color-text)]',
            )}
          >
            <span className="mr-1 font-semibold">{m.symbol}</span>
            {m.label}
          </button>
        ))}
      </div>

      {/* Main Multimeter Face & LCD Display */}
      <div className="mt-3 flex flex-1 flex-col justify-center max-w-md rounded-lg border border-[var(--color-border)] bg-[#0d131a] p-4 shadow-inner">
        {/* LCD Header annunciators */}
        <div className="flex items-center justify-between text-[10px] text-[#778da9]">
          <span className="mono uppercase tracking-wider">{mode.replace('-', ' ')}</span>
          <span className="mono font-semibold text-[#00b4d8]">
            {reading?.status === 'ok' ? 'AUTO RANGE' : (reading?.status?.toUpperCase() ?? 'STANDBY')}
          </span>
          {reading?.beep && (
            <span className="animate-pulse rounded bg-[#ffb70322] px-1 font-bold text-[#ffb703]">
              🔊 BEEP
            </span>
          )}
        </div>

        {/* Large LCD Display Reading */}
        <div className="my-3 flex items-baseline justify-center gap-2 rounded bg-[#04080c] px-4 py-3 font-mono border border-[#1b263b]">
          <span
            className={cn(
              'text-3xl font-bold tracking-tight',
              reading?.status === 'ok'
                ? 'text-[#00e5ff]'
                : reading?.status === 'overcurrent'
                  ? 'text-[var(--color-fault)]'
                  : 'text-[#8892b0]',
            )}
          >
            {reading?.displayText ?? '---'}
          </span>
        </div>

        {/* Status Line */}
        <div className="text-center text-[10.5px] text-[var(--color-text-dim)]">
          {reading?.statusMessage ?? 'Select pins to take a measurement.'}
        </div>
      </div>

      {/* Honesty & Physics Note */}
      <div className="mt-3 text-[10px] text-[var(--color-text-faint)]">
        DC values computed from netlist solver and simulated pin drives. Resistance calculated passively via
        component impedance graph. Floating or unreferenced nodes report honest unmeasured/O.L states.
      </div>
    </div>
  );
}
