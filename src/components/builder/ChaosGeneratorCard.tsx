'use client';

import { useState } from 'react';
import { Flame } from 'lucide-react';
import { useLab } from '@/store/lab';
import { useI18n } from '@/lib/i18n/client';
import type { ProjectDoc } from '@/lib/doc/types';
import { makeChallenge, brokenGenerated, type GeneratedChallenge } from '@/lib/chaos/generator';
import { runERC } from '@/lib/erc/diagnostics';

/**
 * "Break this project": the seeded Chaos Lab generator (spec §12.5) behind one
 * honest button. It generates a validated, solvable defect from the current
 * working circuit and swaps the canvas to the broken copy; the student then
 * repairs it like any authored Chaos challenge. Generation is session-local.
 */

export function ChaosGeneratorCard({
  onChallenge,
}: {
  onChallenge: (gen: GeneratedChallenge, broken: ProjectDoc) => void;
}) {
  const { t, locale } = useI18n();
  const doc = useLab((s) => s.doc);
  const [status, setStatus] = useState<'idle' | 'working' | 'none'>('idle');

  const generate = (): void => {
    setStatus('working');
    setTimeout(() => {
      const clean = runERC(doc).every((d) => d.severity !== 'error');
      const result = clean
        ? makeChallenge(doc, (Date.now() ^ 0x5f3759df) >>> 0, { name: doc.name })
        : null;
      if (!result) {
        setStatus('none');
        return;
      }
      setStatus('idle');
      const broken = brokenGenerated(result.gen);
      broken.name = `Chaos Lab: ${result.gen.challenge.title}`;
      onChallenge(result.gen, broken);
    }, 20);
  };

  return (
    <section lang={locale} className="border-t border-[var(--color-border)] p-3" aria-label={t('chaos')}>
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
        <Flame size={12} className="text-[var(--color-fault)]" /> {t('chaos')}
      </p>
      <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--color-text-dim)]">{t('chaosGenerateBlurb')}</p>
      <button type="button" className="btn btn-sm mt-2 w-full" onClick={generate} disabled={status === 'working'}>
        <Flame size={12} />
        {status === 'working' ? t('chaosGenerating') : t('chaosGenerate')}
      </button>
      {status === 'none' && (
        <p role="status" className="mt-2 text-[11.5px] leading-snug text-[var(--color-warn)]">
          {t('chaosGenerateNone')}
        </p>
      )}
    </section>
  );
}
