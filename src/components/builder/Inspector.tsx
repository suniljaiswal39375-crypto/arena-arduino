'use client';

import { useLab } from '@/store/lab';
import { getPart } from '@/lib/parts';
import { ELECTRICAL_LABEL } from '@/lib/parts/types';
import type { AttrValue } from '@/lib/doc/types';
import type { PartState } from '@/lib/sim/runtime';
import { FIDELITY_BLURB, FIDELITY_LABEL } from '@/lib/brand';
import { diagnosticsForPart } from '@/lib/erc/diagnostics';
import { AlertTriangle, Info, XOctagon } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Inspector({ states }: { states: Record<string, PartState> }) {
  const doc = useLab((s) => s.doc);
  const selection = useLab((s) => s.selection);
  const diagnostics = useLab((s) => s.diagnostics);
  const apply = useLab((s) => s.apply);

  const inst = doc.diagram.parts.find((p) => p.id === selection);
  const def = inst ? getPart(inst.type) : undefined;

  if (!inst || !def) {
    return (
      <div className="p-3 text-[13px] text-[var(--color-text-dim)]">
        Select a part to see its pins, attributes and fidelity note.
      </div>
    );
  }

  const state = states[inst.id];
  const faults = diagnosticsForPart(diagnostics, inst.id);

  const setAttr = (key: string, value: AttrValue): void => {
    apply({ t: 'setAttr', id: inst.id, key, value });
  };

  return (
    <div className="space-y-3 p-3">
      <div>
        <h3 className="text-[14px] font-semibold">{def.name}</h3>
        <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-text-dim)]">
          {def.description}
        </p>
      </div>

      <div className={cn('chip fid-' + def.fidelity.tier)}>
        {FIDELITY_LABEL[def.fidelity.tier]}
      </div>
      <p className="text-[11.5px] leading-snug text-[var(--color-text-dim)]">
        {def.fidelity.notes}
      </p>

      {state && state.kind !== 'none' && (
        <div className="panel-2 px-2.5 py-2">
          <div className="text-[10.5px] uppercase tracking-wide text-[var(--color-text-faint)]">
            Live state
          </div>
          <div className="mono mt-0.5 text-[12.5px]">{describeState(state)}</div>
        </div>
      )}

      {def.pins.length > 0 && (
        <div>
          <div className="mb-1 text-[10.5px] uppercase tracking-wide text-[var(--color-text-faint)]">
            Pins
          </div>
          <table className="w-full text-[11.5px]">
            <tbody>
              {def.pins.map((pin) => (
                <tr key={pin.name} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="mono py-1 pr-2 text-[var(--color-text)]">{pin.name}</td>
                  <td className="py-1 text-[var(--color-text-dim)]">
                    {ELECTRICAL_LABEL[pin.electrical]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {def.controls.length > 0 && (
        <div>
          <div className="mb-1 text-[10.5px] uppercase tracking-wide text-[var(--color-text-faint)]">
            Attributes
          </div>
          <div className="space-y-2">
            {def.controls.map((c) => {
              const raw = inst.attrs[c.id] ?? c.default ?? 0;
              const value = typeof raw === 'number' ? raw : Number(raw) || 0;
              return (
                <label key={c.id} className="block">
                  <span className="flex justify-between text-[11.5px]">
                    <span>{c.label}</span>
                    <span className="mono text-[var(--color-text-dim)]">
                      {value}
                      {c.unit}
                    </span>
                  </span>
                  <input
                    type="range"
                    className="mt-1 w-full accent-[var(--color-accent)]"
                    min={c.min ?? 0}
                    max={c.max ?? 1023}
                    step={c.step ?? 1}
                    value={value}
                    onChange={(e) => setAttr(c.id, Number(e.target.value))}
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}

      {faults.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10.5px] uppercase tracking-wide text-[var(--color-text-faint)]">
            Findings
          </div>
          {faults.map((f) => (
            <div
              key={f.id}
              className={cn(
                'rounded-lg border px-2.5 py-2 text-[11.5px]',
                f.severity === 'error'
                  ? 'border-[#55262c] bg-[#2a1418]'
                  : f.severity === 'warning'
                    ? 'border-[#5c4405] bg-[#2a2109]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-2)]',
              )}
            >
              <div className="flex items-start gap-1.5 font-medium">
                {f.severity === 'error' ? (
                  <XOctagon size={13} className="mt-0.5 shrink-0 text-[var(--color-fault)]" />
                ) : f.severity === 'warning' ? (
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
                ) : (
                  <Info size={13} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
                )}
                <span>{f.title}</span>
              </div>
              <p className="mt-1 text-[var(--color-text-dim)]">{f.explanation}</p>
              <p className="mt-1 text-[var(--color-text-dim)]">{f.why}</p>
              <p className="mt-1 text-[var(--color-text)]">{f.fix}</p>
            </div>
          ))}
        </div>
      )}

      {def.docs.wiring.length > 0 && (
        <div>
          <div className="mb-1 text-[10.5px] uppercase tracking-wide text-[var(--color-text-faint)]">
            Typical wiring
          </div>
          <ul className="space-y-0.5 text-[11.5px] text-[var(--color-text-dim)]">
            {def.docs.wiring.map((w) => (
              <li key={w}>— {w}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10.5px] leading-snug text-[var(--color-text-faint)]">
        {FIDELITY_BLURB[def.fidelity.tier]}
      </p>
    </div>
  );
}

function describeState(state: PartState): string {
  switch (state.kind) {
    case 'led':
      return `${state.on ? 'ON' : 'off'} · brightness ${Math.round(state.brightness * 100)}%`;
    case 'rgb':
      return `R${Math.round(state.r * 255)} G${Math.round(state.g * 255)} B${Math.round(state.b * 255)}`;
    case 'servo':
      return `angle ${Math.round(state.angle)}°`;
    case 'relay':
      return state.closed ? 'contacts closed' : 'contacts open';
    case 'buzzer':
      return state.active ? `${state.frequency} Hz sounding` : 'silent';
    case 'motor':
      return `speed ${Math.round(state.speed * 100)}%`;
    case 'lcd':
      return state.lines.filter(Boolean).join(' / ') || '(blank)';
    case 'oled':
      return state.lines.filter(Boolean).join(' / ') || '(blank)';
    case 'sensor':
      return `${Math.round(state.value)} ${state.unit} (${state.label})`;
    case 'seven-seg':
      return state.value || `segments a..dp: ${state.segments.toString(2).padStart(8, '0')}`;
    case 'matrix':
      return `${state.cells.filter(Boolean).length} of 64 pixels on`;
    case 'stepper':
      return state.powered
        ? state.coils === null ? 'GPIO IN1–4: floating/input · coil phase unknown'
          : `GPIO IN1–4: ${state.coils.toString(2).padStart(4, '0')} · ${state.sequence ?? 'unknown'} phase · ${state.transitions} observed GPIO transitions (not shaft steps)`
        : 'Unpowered · no motor motion inferred';
    case 'logic-analyzer':
      return state.grounded
        ? `${state.levels.map((v, i) => `D${i}:${v}`).join(' ')} · ${state.edges} retained edges${state.dropped ? ` · ${state.dropped} dropped` : ''}`
        : 'GND not referenced · digital levels unknown (X)';
    case 'board':
      return 'running';
    default:
      return 'no live state';
  }
}
