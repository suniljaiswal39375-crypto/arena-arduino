'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown, Info, Send, Sparkles, ThumbsDown, TriangleAlert, Undo2, XCircle } from 'lucide-react';
import { useLab, type DockTab } from '@/store/lab';
import { useI18n } from '@/lib/i18n/client';
import { loadProgress } from '@/lib/skills';
import type { SimSnapshot } from '@/lib/sim/engine';
import { MentorSession, type MentorMessage, type ToolCard } from '@/lib/ai/session';
import type { TraceFinding } from '@/lib/ai/trace-inspector';
import { cn } from '@/lib/cn';

/**
 * The docked lab-mentor chat (spec §12.1): a plan line before it acts, typed
 * tool cards routed through the store's command layer, confirm cards for
 * destructive actions, trace findings with jumps (§12.2), the "AI-generated"
 * label and a thumbs-down path (§12.8). Offline it runs the deterministic
 * planner; a configured gateway upgrades the words, never the write path.
 */

/** Scope timebase steps, mirroring the Scope panel's own selector. */
const TIMEBASE_STEPS = [100, 200, 500, 1_000, 2_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];

function timebaseFor(windowUs: number): number {
  const perDiv = Math.max(1, Math.round(windowUs / 10));
  for (const step of TIMEBASE_STEPS) if (step >= perDiv) return step;
  return TIMEBASE_STEPS.at(-1)!;
}

const SEVERITY_DOT: Record<TraceFinding['severity'], string> = {
  error: 'bg-[var(--color-fault)]',
  warning: 'bg-[var(--color-warn)]',
  info: 'bg-[var(--color-accent)]',
};

const PANEL_LABEL: Record<string, string> = {
  scope: 'Scope',
  logic: 'Logic',
  serial: 'Serial',
  diagnostics: 'Diagnostics',
};

export function MentorPanel({ snapshot }: { snapshot: SimSnapshot | null }) {
  const { t, locale } = useI18n();
  const sessionRef = useRef<MentorSession | null>(null);
  // Keep the live snapshot readable from inside getContext without re-creating
  // the session on every frame.
  const snapshotRef = useRef<SimSnapshot | null>(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);
  const [turns, setTurns] = useState<readonly MentorMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [input, setInput] = useState('');
  const [openCards, setOpenCards] = useState<Set<number>>(new Set());
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const sync = useCallback((): void => {
    setTurns(sessionRef.current ? [...sessionRef.current.transcript] : []);
  }, []);

  // The host is re-read every call so commands always target the live store.
  const ensureSession = useCallback((): MentorSession => {
    if (!sessionRef.current) {
      sessionRef.current = new MentorSession(
        {
          getContext: () => {
            const state = useLab.getState();
            return {
              doc: state.doc,
              missionSlug: state.missionSlug,
              progress: loadProgress(),
              snapshot: snapshotRef.current,
            };
          },
          applyCommands: (commands, label) => {
            useLab.getState().applyAll(commands, label);
          },
          select: (id) => useLab.getState().select(id),
        },
        locale === 'hi' ? 'hi' : 'en',
      );
    }
    sessionRef.current.setLocale(locale === 'hi' ? 'hi' : 'en');
    return sessionRef.current;
  }, [locale]);

  useEffect(() => {
    ensureSession();
    sync();
  }, [ensureSession, sync]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  const ask = useCallback(async (): Promise<void> => {
    const text = input.trim();
    if (!text || busy) return;
    const session = ensureSession();
    if (session.hasPending) return;
    setInput('');
    setBusy(true);
    try {
      await session.ask(text);
    } finally {
      setBusy(false);
      sync();
      inputRef.current?.focus();
    }
  }, [busy, ensureSession, input, sync]);

  const confirm = useCallback((): void => {
    ensureSession().confirmPending();
    sync();
  }, [ensureSession, sync]);

  const cancel = useCallback((): void => {
    ensureSession().cancelPending();
    sync();
  }, [ensureSession, sync]);

  const inspect = useCallback((): void => {
    setInspecting(true);
    setTimeout(() => {
      ensureSession().inspectLastRun();
      setInspecting(false);
      sync();
    }, 20);
  }, [ensureSession, sync]);

  const jump = useCallback((finding: TraceFinding): void => {
    if (!finding.dock) return;
    useLab.getState().setDock(finding.dock as DockTab);
    if (finding.dock === 'scope' && finding.windowUs) {
      useLab.getState().setScopePrefs({ timebaseUs: timebaseFor(finding.windowUs) });
    }
  }, []);

  const thumbsDown = useCallback((id: number): void => {
    ensureSession().thumbsDown(id);
    sync();
  }, [ensureSession, sync]);

  const toggleCard = useCallback((id: number): void => {
    setOpenCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const findingsCount = useMemo(
    () => turns.filter((m) => m.role === 'findings').length,
    [turns],
  );

  return (
    <div className="flex h-full flex-col" lang={locale}>
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] p-3">
        <Sparkles size={15} className="text-[var(--color-accent)]" />
        <h3 className="text-[13.5px] font-semibold">{t('mentorTitle')}</h3>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3" aria-live="polite">
        {turns.length === 0 && (
          <p className="panel-2 p-3 text-[12.5px] leading-relaxed text-[var(--color-text-dim)]">
            {t('mentorIntro')}
          </p>
        )}

        {turns.map((m) => {
          if (m.role === 'user') {
            return (
              <p key={m.id} className="ml-6 rounded-lg rounded-br-sm bg-[var(--color-surface-raised)] px-3 py-2 text-[12.5px] leading-relaxed">
                {m.text}
              </p>
            );
          }
          if (m.role === 'mentor') {
            return (
              <div key={m.id} className="mr-2">
                {m.plan && (
                  <p className="mb-1 flex items-start gap-1.5 text-[11.5px] italic text-[var(--color-text-faint)]">
                    <Bot size={12} className="mt-0.5 shrink-0" /> {m.plan}
                  </p>
                )}
                <p className="whitespace-pre-line rounded-lg rounded-bl-sm border border-[var(--color-border)] px-3 py-2 text-[12.5px] leading-relaxed">
                  {m.text}
                </p>
                <button
                  type="button"
                  className="mt-1 flex items-center gap-1 text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)]"
                  onClick={() => thumbsDown(m.id)}
                >
                  <ThumbsDown size={11} /> {t('mentorFeedback')}
                </button>
              </div>
            );
          }
          if (m.role === 'tools') {
            return (
              <div key={m.id} className="space-y-1.5">
                {m.cards.map((card, i) => (
                  <ToolCardView
                    key={`${m.id}-${i}`}
                    card={card}
                    open={openCards.has(m.id * 100 + i)}
                    onToggle={() => toggleCard(m.id * 100 + i)}
                  />
                ))}
              </div>
            );
          }
          if (m.role === 'confirm') {
            return (
              <div key={m.id} role="alertdialog" aria-label={t('mentorConfirmTitle')} className="rounded-lg border border-[#5c4405] bg-[#2a2109] p-3">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-warn)]">
                  <TriangleAlert size={13} /> {t('mentorConfirmTitle')}
                </p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed">{m.text}</p>
                <div className="mt-2.5 flex gap-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={confirm}>
                    <Undo2 size={12} /> {t('mentorConfirm')}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={cancel}>
                    <XCircle size={12} /> {t('mentorCancel')}
                  </button>
                </div>
                <p className="mt-2 flex items-center gap-1 text-[11px] text-[var(--color-text-faint)]">
                  <Undo2 size={10} /> {t('mentorUndoable')}
                </p>
              </div>
            );
          }
          // findings
          return (
            <section key={m.id} aria-label={t('mentorFindings')} className="space-y-1.5">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                {t('mentorFindings')} ({m.findings.length})
              </p>
              {m.findings.map((f, i) => (
                <article key={`${m.id}-${i}`} className="panel-2 p-2.5">
                  <p className="flex items-start gap-1.5 text-[12.5px] font-medium leading-snug">
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEVERITY_DOT[f.severity])} aria-hidden />
                    {f.title}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-dim)]">{f.detail}</p>
                  <p className="mono mt-1 text-[10.5px] text-[var(--color-text-faint)]">
                    {t('mentorConfidence', { percent: Math.round(f.confidence * 100) })}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed">
                    <span className="font-semibold">{t('mentorSuggestion')}: </span>
                    {f.suggestion}
                  </p>
                  {f.dock && (
                    <button type="button" className="btn btn-sm mt-2" onClick={() => jump(f)}>
                      {t('mentorShowIn', { panel: PANEL_LABEL[f.dock] ?? f.dock })}
                    </button>
                  )}
                </article>
              ))}
            </section>
          );
        })}

        {busy && (
          <p className="flex items-center gap-2 text-[12px] text-[var(--color-text-dim)]" role="status">
            <Sparkles size={12} className="animate-pulse" /> {t('mentorBusy')}
          </p>
        )}
      </div>

      <div className="border-t border-[var(--color-border)] p-2.5">
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            className="btn btn-sm flex-1"
            onClick={inspect}
            disabled={inspecting || !snapshot}
          >
            <Info size={12} /> {inspecting ? t('mentorInspecting') : t('mentorInspect')}
            {findingsCount > 0 && <span className="chip ml-1 px-1.5 py-0 text-[10px]">{findingsCount}</span>}
          </button>
        </div>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <input
            ref={inputRef}
            className="input flex-1"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('mentorPlaceholder')}
            aria-label={t('mentorAsk')}
            maxLength={2000}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()} aria-label={t('mentorAsk')}>
            <Send size={13} />
          </button>
        </form>
        <p className="mt-2 text-[10.5px] leading-snug text-[var(--color-text-faint)]">
          {t('mentorAiLabel')} {t('mentorUndoable')}
        </p>
      </div>
    </div>
  );
}

function ToolCardView({ card, open, onToggle }: { card: ToolCard; open: boolean; onToggle: () => void }): React.ReactElement {
  const hasDetails = card.data !== undefined && JSON.stringify(card.data).length > 2;
  return (
    <div className={cn('panel-2 p-2.5', !card.ok && 'border-[#55262c]')}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-start gap-1.5 text-[12px] leading-relaxed">
          {card.ok ? (
            <Sparkles size={12} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
          ) : (
            <XCircle size={12} className="mt-0.5 shrink-0 text-[var(--color-fault)]" />
          )}
          {card.message}
        </p>
        <span className="mono shrink-0 rounded bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-faint)]">
          {card.tool}
        </span>
      </div>
      {hasDetails && (
        <>
          <button
            type="button"
            className="mt-1 flex items-center gap-1 text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)]"
            aria-expanded={open}
            onClick={onToggle}
          >
            <ChevronDown size={11} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
            details
          </button>
          {open && (
            <pre className="mono mt-1.5 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--color-surface)] p-2 text-[10.5px] text-[var(--color-text-dim)]">
              {JSON.stringify(card.data, null, 1).slice(0, 4_000)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
