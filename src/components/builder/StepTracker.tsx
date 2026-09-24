'use client';

import { useI18n } from '@/lib/i18n/client';
import { useEffect, useRef, useState } from 'react';
import { useLab } from '@/store/lab';
import { loadProgress, completeMission, saveProgress } from '@/lib/skills';
import { checkMission, missionProgress } from '@/lib/missions/validate';
import type { Mission } from '@/lib/missions/missions';
import { CheckCircle2, Circle, Eye, HelpCircle, Lightbulb, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';

const IDLE_MS = 90_000;

export function StepTracker({
  mission,
  confirmed,
  onConfirm,
  onReveal,
}: {
  mission: Mission;
  confirmed: Set<string>;
  onConfirm: (note: string) => void;
  onReveal: () => void;
}) {
  const { t, locale } = useI18n();
  const doc = useLab((s) => s.doc);
  const results = checkMission(mission, doc, confirmed);
  const progress = missionProgress(results);
  const [openHints, setOpenHints] = useState<Set<string>>(new Set());
  const [autoHint, setAutoHint] = useState<string | null>(null);

  const firstTodo = results.find((r) => r.status !== 'done');

  // Record the mission as evidence the moment it is completed in front of us:
  // skill observations, First Circuit, Ten Goes. Reopening a mission that was
  // already complete does not record it again.
  const wasComplete = useRef<boolean | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  useEffect(() => {
    if (wasComplete.current === null) {
      wasComplete.current = progress.complete;
      return;
    }
    if (progress.complete && !wasComplete.current) {
      const previous = loadProgress();
      const next = completeMission(previous, mission.skills, mission.slug);
      if (next !== previous) {
        saveProgress(next);
        setJustCompleted(true);
      }
    }
    wasComplete.current = progress.complete;
  }, [progress.complete, mission.skills, mission.slug]);

  // Stuck detection: after 90 seconds on the same unfinished step, offer the hint.
  useEffect(() => {
    if (!firstTodo) {
      setAutoHint(null);
      return;
    }
    const timer = setTimeout(() => setAutoHint(firstTodo.id), IDLE_MS);
    return () => clearTimeout(timer);
  }, [firstTodo?.id, firstTodo?.status]);

  const toggleHint = (id: string): void => {
    setOpenHints((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div lang={locale} className="flex h-full flex-col">
      <div className="border-b border-[var(--color-border)] p-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-lg">
            {mission.emoji}
          </span>
          <h3 lang="en" className="text-[13.5px] font-semibold">{mission.title}</h3>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-300"
              style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
          <span className="mono text-[11px] text-[var(--color-text-dim)]">
            {progress.done}/{progress.total}
          </span>
        </div>
      </div>

      <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {mission.steps.map((step, i) => {
          const result = results[i];
          const status = result?.status ?? 'todo';
          const hintOpen = openHints.has(step.id) || autoHint === step.id;
          const isManual = step.validate.type === 'manualConfirm';
          const note = step.validate.type === 'manualConfirm' ? step.validate.note : '';
          return (
            <li
              key={step.id}
              className={cn(
                'rounded-lg border px-2.5 py-2',
                status === 'done'
                  ? 'border-[#1d5f57] bg-[rgba(42,157,143,0.08)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-2)]',
              )}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  {status === 'done' ? (
                    <CheckCircle2 size={15} className="text-[var(--color-ok)]" />
                  ) : (
                    <Circle size={15} className="text-[var(--color-text-faint)]" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p lang="en"
                    className={cn(
                      'text-[12.5px] leading-snug',
                      status === 'done' && 'text-[var(--color-text-dim)] line-through',
                    )}
                  >
                    {step.instruction}
                  </p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => toggleHint(step.id)}
                      aria-expanded={hintOpen}
                    >
                      <Lightbulb size={12} /> {t('hint')}
                    </button>
                    {isManual && status !== 'done' && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => onConfirm(note)}
                      >
                        <CheckCircle2 size={12} /> {t('confirm')}
                      </button>
                    )}
                    {status === 'manual' && (
                      <span className="text-[10.5px] text-[var(--color-text-faint)]">
                        {t('selfConfirmed')}
                      </span>
                    )}
                  </div>

                  {hintOpen && (
                    <div className="mt-2 space-y-1.5 rounded-md bg-black/25 p-2 text-[11.5px]">
                      <p className="flex gap-1.5">
                        <Lightbulb size={12} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
                        <span lang="en">{step.hint}</span>
                      </p>
                      <p className="flex gap-1.5 text-[var(--color-text-dim)]">
                        <HelpCircle size={12} className="mt-0.5 shrink-0" />
                        <span lang="en">{step.whyItMatters}</span>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-[var(--color-border)] p-2.5">
        {justCompleted && (
          <p role="status" className="mb-2 text-center text-[11.5px] text-[var(--color-ok)]">
            {t('missionComplete', { count: mission.skills.length })}
          </p>
        )}
        {progress.complete ? (
          <button type="button" className="btn btn-primary w-full" style={{ whiteSpace: 'normal' }} onClick={onReveal}>
            <Eye size={13} /> {t('reveal')}
          </button>
        ) : (
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--color-text-faint)]">
            <Lock size={12} /> {t('locked')}
          </p>
        )}
      </div>
    </div>
  );
}
