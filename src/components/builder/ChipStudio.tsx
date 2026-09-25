'use client';

import { useMemo, useState } from 'react';
import { Cpu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useLab } from '@/store/lab';
import { useI18n } from '@/lib/i18n/client';
import { composeChip, CHIP_KIND_INFO, DEFAULT_SPEC, type ChipKind, type ChipSpec } from '@/lib/chips/compose';
import { chipJson } from '@/lib/chips/chips';
import { takenChipIds } from '@/lib/chips/registry';

/**
 * Chip Studio (ROADMAP Phase 13): guided authoring of a custom chip. Three
 * behaviour families the simulator honestly models — inverter, window
 * comparator, pulse generator — with the student's own name, pin names and
 * parameters. Composing produces the same three artifacts the shipped chips
 * carry: a palette part, a Wokwi chip.json and a reference C source. The
 * definition travels inside the project, so the chip survives reloads and
 * exports with the Wokwi zip.
 */
export function ChipStudio({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n();
  const addChip = useLab((s) => s.addChip);
  const addPartAt = useLab((s) => s.addPartAt);
  const doc = useLab((s) => s.doc);

  const [spec, setSpec] = useState<ChipSpec>(DEFAULT_SPEC);

  const result = useMemo(() => composeChip(spec, takenChipIds()), [spec]);
  const set = (patch: Partial<ChipSpec>): void => setSpec((s) => ({ ...s, ...patch }));

  const kindButton = (kind: ChipKind, label: string) => (
    <button
      key={kind}
      type="button"
      onClick={() => set({ kind })}
      aria-pressed={spec.kind === kind}
      className={cn(
        'chip',
        spec.kind === kind
          ? 'border-[var(--color-accent)] bg-[rgba(0,180,216,0.15)] text-[var(--color-accent)]'
          : 'hover:border-[var(--color-border-strong)]',
      )}
    >
      {label}
    </button>
  );

  const submit = (): void => {
    if (!result.ok) return;
    const chip = result.chip;
    addChip(chip);
    const n = doc.diagram.parts.length;
    addPartAt(chip.id, 420 + (n % 3) * 170, 60 + Math.floor(n / 3) * 120);
    onClose();
  };

  const err = (field: string): string | null => (result.ok ? null : (result.errors.find((e) => e.field === field)?.message ?? null));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('chipStudio')}
        lang={locale}
        className="panel-2 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] p-3">
          <Cpu size={15} className="text-[var(--color-accent)]" />
          <h3 className="text-[13.5px] font-semibold">{t('chipStudio')}</h3>
          <button type="button" className="ml-auto btn btn-sm" onClick={onClose} aria-label={t('chipCancel')}>
            <X size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <p className="text-[12px] leading-snug text-[var(--color-text-dim)]">{t('chipStudioIntro')}</p>

          <section>
            <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">{t('chipKind')}</h4>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {kindButton('not', t('chipKindNot'))}
              {kindButton('window', t('chipKindWindow'))}
              {kindButton('pulse', t('chipKindPulse'))}
            </div>
            <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--color-text-dim)]">{CHIP_KIND_INFO[spec.kind].example}</p>
          </section>

          <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block text-[12px]">
              <span className="text-[var(--color-text-dim)]">{t('chipName')}</span>
              <input className="input mt-0.5" value={spec.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
              {err('name') && <span className="mt-0.5 block text-[11px] text-[var(--color-fault)]">{err('name')}</span>}
            </label>
            <label className="block text-[12px]">
              <span className="text-[var(--color-text-dim)]">{t('chipAuthor')}</span>
              <input className="input mt-0.5" value={spec.author} maxLength={40} onChange={(e) => set({ author: e.target.value })} />
            </label>
            <label className="block text-[12px] sm:col-span-2">
              <span className="text-[var(--color-text-dim)]">{t('chipDesc')}</span>
              <textarea
                className="input mt-0.5 min-h-[52px]"
                value={spec.description}
                maxLength={300}
                onChange={(e) => set({ description: e.target.value })}
              />
              {err('description') && <span className="mt-0.5 block text-[11px] text-[var(--color-fault)]">{err('description')}</span>}
            </label>
            {spec.kind !== 'pulse' && (
              <label className="block text-[12px]">
                <span className="text-[var(--color-text-dim)]">{t('chipInPin')}</span>
                <input className="input mt-0.5 font-mono" value={spec.inPin} maxLength={8} onChange={(e) => set({ inPin: e.target.value.toUpperCase() })} />
                {err('inPin') && <span className="mt-0.5 block text-[11px] text-[var(--color-fault)]">{err('inPin')}</span>}
              </label>
            )}
            <label className="block text-[12px]">
              <span className="text-[var(--color-text-dim)]">{t('chipOutPin')}</span>
              <input className="input mt-0.5 font-mono" value={spec.outPin} maxLength={8} onChange={(e) => set({ outPin: e.target.value.toUpperCase() })} />
              {err('outPin') && <span className="mt-0.5 block text-[11px] text-[var(--color-fault)]">{err('outPin')}</span>}
            </label>
            {spec.kind === 'window' && (
              <>
                <label className="block text-[12px]">
                  <span className="text-[var(--color-text-dim)]">{t('chipLowThr')}</span>
                  <input type="number" className="input mt-0.5" min={0} max={1023} value={spec.low} onChange={(e) => set({ low: Number(e.target.value) })} />
                  {err('low') && <span className="mt-0.5 block text-[11px] text-[var(--color-fault)]">{err('low')}</span>}
                </label>
                <label className="block text-[12px]">
                  <span className="text-[var(--color-text-dim)]">{t('chipHighThr')}</span>
                  <input type="number" className="input mt-0.5" min={0} max={1023} value={spec.high} onChange={(e) => set({ high: Number(e.target.value) })} />
                  {err('high') && <span className="mt-0.5 block text-[11px] text-[var(--color-fault)]">{err('high')}</span>}
                </label>
              </>
            )}
            {spec.kind === 'pulse' && (
              <>
                <label className="block text-[12px]">
                  <span className="text-[var(--color-text-dim)]">{t('chipBpm')}</span>
                  <input type="number" className="input mt-0.5" min={1} max={300} value={spec.bpm} onChange={(e) => set({ bpm: Number(e.target.value) })} />
                  {err('bpm') && <span className="mt-0.5 block text-[11px] text-[var(--color-fault)]">{err('bpm')}</span>}
                </label>
                <label className="block text-[12px]">
                  <span className="text-[var(--color-text-dim)]">{t('chipDuty')}</span>
                  <input type="number" className="input mt-0.5" min={1} max={99} value={spec.dutyPercent} onChange={(e) => set({ dutyPercent: Number(e.target.value) })} />
                  {err('dutyPercent') && <span className="mt-0.5 block text-[11px] text-[var(--color-fault)]">{err('dutyPercent')}</span>}
                </label>
              </>
            )}
          </section>

          {result.ok && (
            <section>
              <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">{t('chipPreview')}</h4>
              <pre className="panel-2 mt-1.5 max-h-32 overflow-auto p-2 font-mono text-[10.5px] leading-snug">
                {JSON.stringify(chipJson(result.chip), null, 1)}
              </pre>
              <pre className="panel-2 mt-1.5 max-h-44 overflow-auto p-2 font-mono text-[10.5px] leading-snug">{result.chip.source}</pre>
            </section>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--color-border)] p-3">
          {!result.ok && result.errors.length > 0 && (
            <p role="status" className="text-[11.5px] text-[var(--color-warn)]">
              {result.errors[0]!.message}
            </p>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn btn-sm" onClick={onClose}>
              {t('chipCancel')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={!result.ok}>
              {t('chipAdd')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
