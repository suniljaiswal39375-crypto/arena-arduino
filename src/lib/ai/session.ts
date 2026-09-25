import type { Command } from '@/lib/doc/commands';
import {
  runTool,
  requiresConfirmation,
  type SimRunResult,
  type ToolCallInput,
  type ToolContext,
} from './tools';
import { containsInjection, filterInjection, MENTOR_SESSION_RATE, RateLimiter } from './guardrails';
import { callMentorGateway, mentorGatewayEnabled, type GatewayTurn } from './gateway';
import { planTurn, type Locale } from './planner';
import { inspectRun, rankFindings, type TraceFinding } from './trace-inspector';
import { recordAudit } from './audit';

/**
 * The mentor session: the orchestrator between the chat UI, the tools and the
 * document. Framework-free and therefore unit-testable end to end.
 *
 * Contract with the store (the only way the mentor touches the document):
 * the host exposes `applyCommands`, which must route through `useLab.applyAll`
 * — the same Immer command layer a human edit uses — so AI mutations are
 * undoable, autosaved and audited exactly like hand edits. The session itself
 * never mutates a document.
 */

export interface MentorHost {
  /** A fresh context: current doc, mission, live snapshot, completed missions. */
  getContext(): ToolContext;
  /** Apply one tool's commands as a single undoable step. */
  applyCommands(commands: Command[], label: string): void;
  /** UI selection effect (never a document mutation). */
  select(id: string | null): void;
}

export interface ToolCard {
  tool: string;
  ok: boolean;
  message: string;
  /** Structured payload for progressive disclosure in the UI. */
  data?: unknown;
}

export type MentorMessage =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'mentor'; text: string; plan?: string }
  | { id: number; role: 'tools'; cards: ToolCard[] }
  | { id: number; role: 'findings'; findings: TraceFinding[] }
  | { id: number; role: 'confirm'; text: string; call: ToolCallInput };

const MAX_MESSAGES = 60;

export class MentorSession {
  private messages: MentorMessage[] = [];
  private seq = 0;
  private lastRun: SimRunResult | null = null;
  private rate = new RateLimiter(MENTOR_SESSION_RATE.max, MENTOR_SESSION_RATE.windowMs);
  private history: GatewayTurn[] = [];
  private pending: { call: ToolCallInput; commands: Command[]; text: string } | null = null;

  constructor(
    private readonly host: MentorHost,
    private locale: Locale = 'en',
  ) {}

  setLocale(locale: Locale): void {
    this.locale = locale;
  }

  get transcript(): readonly MentorMessage[] {
    return this.messages;
  }

  get pendingConfirmation(): MentorMessage | null {
    return (this.messages.find((m) => m.role === 'confirm') ?? null) as MentorMessage | null;
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  private push(message: MentorMessage): void {
    this.messages.push(message);
    if (this.messages.length > MAX_MESSAGES) {
      this.messages = this.messages.slice(-MAX_MESSAGES);
    }
  }

  private nextId(): number {
    this.seq += 1;
    return this.seq;
  }

  /** One student turn: plan (gateway → planner fallback), then execute tools. */
  async ask(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.pending) return;
    if (!this.rate.trySpend()) {
      recordAudit('rate-limited', 'session rate limit reached');
      this.push({
        id: this.nextId(),
        role: 'mentor',
        text:
          this.locale === 'hi'
            ? 'एक मिनट रुकें — बहुत सारे सवाल एक साथ। यह सीमा हर सत्र के लिए है।'
            : 'Slow down a moment — that is a lot of questions at once. This limit protects the session.',
      });
      return;
    }
    const filtered = filterInjection(trimmed);
    if (filtered !== trimmed) recordAudit('plan', 'injection attempt filtered');
    this.push({ id: this.nextId(), role: 'user', text: trimmed });
    recordAudit('ask', `${filtered.length} chars, locale=${this.locale}`);

    let plan: string;
    let reply: string;
    let calls: ToolCallInput[];

    if (mentorGatewayEnabled()) {
      const ctx = this.host.getContext();
      const gateway = await callMentorGateway(
        {
          message: filtered,
          history: this.history,
          context: {
            locale: this.locale,
            mission: ctx.missionSlug,
            diagnosticCodes: [],
            partTypes: ctx.doc.diagram.parts.map((p) => p.type),
          },
        },
      );
      if (gateway.ok) {
        plan = gateway.plan ?? '';
        reply = gateway.reply;
        calls = gateway.calls;
        recordAudit('plan', 'hosted model responded');
      } else {
        recordAudit('fallback', gateway.reason);
        const turn = planTurn({ text: filtered, locale: this.locale, ctx });
        plan = turn.plan;
        reply = turn.reply;
        calls = turn.calls;
      }
    } else {
      const turn = planTurn({ text: filtered, locale: this.locale, ctx: this.host.getContext() });
      plan = turn.plan;
      reply = turn.reply;
      calls = turn.calls;
    }

    this.push({ id: this.nextId(), role: 'mentor', text: reply, plan: plan || undefined });
    this.history.push({ role: 'user', content: filtered });
    this.history.push({ role: 'mentor', content: reply });
    this.history = this.history.slice(-12);

    await this.execute(calls);
  }

  /** Execute tool calls in order, stopping at an unconfirmed destructive one. */
  async execute(calls: ToolCallInput[]): Promise<void> {
    if (calls.length === 0) return;
    const cards: ToolCard[] = [];
    for (const call of calls) {
      const ctx: ToolContext = { ...this.host.getContext(), lastRun: this.lastRun };
      if (requiresConfirmation(call)) {
        const outcome = runTool(ctx, call);
        // Withhold: show the confirm card and stop the queue until answered.
        this.pending = { call, commands: outcome.commands, text: outcome.message };
        this.push({ id: this.nextId(), role: 'confirm', text: outcome.message, call });
        recordAudit('tool', `${call.tool} needs confirmation`);
        break;
      }
      const outcome = runTool(ctx, call);
      recordAudit('tool', `${call.tool} → ${outcome.ok ? 'ok' : 'failed'}`);
      if (outcome.commands.length > 0) {
        this.host.applyCommands(outcome.commands, `AI: ${call.tool}`);
        recordAudit('commands', `${outcome.commands.length} command(s) from ${call.tool}`);
      }
      if (outcome.select !== undefined) this.host.select(outcome.select);
      if (outcome.run) this.lastRun = outcome.run;
      cards.push({ tool: call.tool, ok: outcome.ok, message: outcome.message, data: outcome.data });
      if (!outcome.ok && outcome.needsConfirmation === false && requiresConfirmation(call)) break;
    }
    if (cards.length > 0) {
      this.push({ id: this.nextId(), role: 'tools', cards });
    }
  }

  /** Apply the pending destructive call after the student confirms. */
  confirmPending(): void {
    if (!this.pending) return;
    const { commands, call } = this.pending;
    this.pending = null;
    if (commands.length > 0) {
      this.host.applyCommands(commands, `AI: ${call.tool} (confirmed)`);
      recordAudit('confirm', call.tool);
    }
    // Drop the confirm card; the undo stack now carries the action.
    this.messages = this.messages.filter((m) => m.role !== 'confirm');
    this.push({
      id: this.nextId(),
      role: 'tools',
      cards: [{ tool: call.tool, ok: true, message: 'Applied. Undo (Ctrl+Z) reverses it.' }],
    });
  }

  /** Decline the pending destructive call. */
  cancelPending(): void {
    if (!this.pending) return;
    recordAudit('cancel', this.pending.call.tool);
    const tool = this.pending.call.tool;
    this.pending = null;
    this.messages = this.messages.filter((m) => m.role !== 'confirm');
    this.push({
      id: this.nextId(),
      role: 'tools',
      cards: [{ tool, ok: true, message: 'Cancelled — nothing changed.' }],
    });
  }

  /** Analyse the live traces (spec §12.2) and surface findings in the chat. */
  inspectLastRun(): TraceFinding[] {
    const ctx = this.host.getContext();
    const findings = rankFindings(inspectRun(ctx.doc, ctx.snapshot));
    this.messages = this.messages.filter((m) => m.role !== 'findings');
    if (findings.length > 0) {
      this.push({ id: this.nextId(), role: 'findings', findings });
    }
    return findings;
  }

  /** Spec §12.8: every AI surface has a thumbs-down path. */
  thumbsDown(messageId: number): void {
    const message = this.messages.find((m) => m.id === messageId);
    if (!message || message.role !== 'mentor') return;
    recordAudit('thumbs-down', `message ${messageId} disliked; logged for prompt regression`);
    this.push({
      id: this.nextId(),
      role: 'tools',
      cards: [{
        tool: 'feedback',
        ok: true,
        message:
          this.locale === 'hi'
            ? 'धन्यवाद — यह उत्तर अस्पष्ट था। सुझाव दर्ज कर लिए गए हैं (इस सत्र के ऑडिट लॉग में)।'
            : 'Thanks — that answer missed. Noted in this session\'s audit log for prompt improvement.',
      }],
    });
  }

  /** Reset the conversation (keeps rate-limit state; it is the same session). */
  clear(): void {
    this.messages = [];
    this.history = [];
    this.pending = null;
  }
}
