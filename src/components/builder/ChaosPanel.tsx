'use client';

import { useState } from 'react';
import { useLab } from '@/store/lab';
import { checkRepair, type ChaosChallenge, type ChaosVerdict } from '@/lib/chaos/chaos';
import { loadProgress, recordChaosSolve, saveProgress } from '@/lib/skills';
import { CheckCircle2, Flame, Lightbulb, RotateCcw, Stethoscope } from 'lucide-react';

/**
 * The Chaos Lab rail: the brief, a hint ladder that unlocks one rung at a
 * time, and a repair check that runs the circuit rather than trusting the
 * absence of warnings.
 */
export function ChaosPanel({ challenge, onRestart }: { challenge: ChaosChallenge; onRestart: () => void }) {
  const doc = useLab((s) => s.doc);
  const [hintsShown, setHintsShown] = useState(0);
  const [verdict, setVerdict] = useState<ChaosVerdict | null>(null);
  const [checking, setChecking] = useState(false);
  const [recorded, setRecorded] = useState(false);

  const check = (): void => {
    setChecking(true);
    // Let the button repaint before a few simulated seconds of work.
    setTimeout(() => {
      const v = checkRepair(challenge, doc);
      setVerdict(v);
      setChecking(false);
      if (v.fixed && !recorded) {
        saveProgress(recordChaosSolve(loadProgress(), challenge.skills));
        setRecorded(true);
      }
    }, 20);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border)] p-3">
        <div className="flex items-center gap-2">
          <Flame size={15} className="text-[var(--color-fault)]" />
          <h3 className="text-[13.5px] font-semibold">{challenge.title}</h3>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--color-text-dim)]">{challenge.brief}</p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <section>
          <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Hints</h4>
          <ol className="mt-1.5 space-y-2">
            {challenge.hints.slice(0, hintsShown).map((h, i) => (
              <li key={h} className="panel-2 flex gap-2 p-2.5 text-[12.5px] leading-relaxed">
                <Lightbulb size={14} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
                <span>
                  <span className="font-semibold">Hint {i + 1}. </span>
                  {h}
                </span>
              </li>
            ))}
          </ol>
          {hintsShown < challenge.hints.length ? (
            <button type="button" className="btn btn-sm mt-2" onClick={() => setHintsShown((n) => n + 1)}>
              <Lightbulb size={13} /> {hintsShown === 0 ? 'I need a hint' : 'Another hint'}
            </button>
          ) : (
            <p className="mt-2 text-[11.5px] text-[var(--color-text-faint)]">That is every hint.</p>
          )}
        </section>

        {verdict && !verdict.fixed && (
          <section className="rounded-md border border-[#55262c] bg-[#2a1418] p-3" role="status">
            <p className="text-[12.5px] font-semibold text-[var(--color-fault)]">Not fixed yet</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] text-[var(--color-text-dim)]">
              {verdict.remaining.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
        )}

        {verdict?.fixed && (
          <section className="rounded-md border border-[#1f4d3a] bg-[#10261c] p-3" role="status">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-ok)]">
              <CheckCircle2 size={15} /> Fixed. It works again.
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed">{challenge.answer}</p>
            <p className="mt-2 text-[11.5px] text-[var(--color-text-faint)]">
              Recorded as evidence for {challenge.skills.join(', ')}.
            </p>
          </section>
        )}
      </div>

      <div className="flex gap-2 border-t border-[var(--color-border)] p-2.5">
        <button type="button" className="btn btn-primary flex-1" onClick={check} disabled={checking}>
          <Stethoscope size={14} /> {checking ? 'Checking…' : 'Check my fix'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setVerdict(null);
            setHintsShown(0);
            setRecorded(false);
            onRestart();
          }}
          aria-label="Restart the challenge"
          title="Restart the challenge"
        >
          <RotateCcw size={14} />
        </button>
      </div>
    </div>
  );
}
