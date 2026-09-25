import { z } from 'zod';
import { ToolCallSchema } from '@/lib/ai/tools';

/**
 * The server-side mentor gateway (spec §12: one gateway, model-agnostic).
 *
 * Mounted at `POST /api/mentor`. It exists so the browser never holds a model
 * API key: the client posts a redacted, bounded conversation; this handler
 * forwards it to an OpenAI-compatible chat-completions endpoint (so any
 * compatible provider works via `OPENAI_BASE_URL`), enforces a per-IP rate
 * limit, validates the model's tool calls against the same zod contract the
 * client uses, and returns `{ reply, plan, calls }`.
 *
 * With no `OPENAI_API_KEY` configured it answers 503 `mentor-not-configured`
 * — and the client silently falls back to the deterministic offline planner.
 * Nothing is logged or persisted: no conversation content touches disk.
 */

const RequestSchema = z.object({
  message: z.string().min(1).max(2_000),
  history: z
    .array(z.object({ role: z.enum(['user', 'mentor']), content: z.string().max(2_000) }))
    .max(6)
    .default([]),
  context: z
    .object({
      locale: z.enum(['en', 'hi']).default('en'),
      mission: z.string().max(80).nullable().default(null),
      diagnosticCodes: z.array(z.string().max(40)).max(20).default([]),
      partTypes: z.array(z.string().max(40)).max(60).default([]),
    })
    .default({
      locale: 'en' as const,
      mission: null,
      diagnosticCodes: [],
      partTypes: [],
    }),
});

export const MENTOR_BODY_LIMIT = 32 * 1024;

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

export function mentorRateConfig(env: Record<string, string | undefined>): { max: number; windowMs: number } {
  const parsed = Number(env.MENTOR_RATE_LIMIT_PER_HOUR ?? '');
  const max = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 60;
  return { max, windowMs: 3_600_000 };
}

/** In-memory sliding window, bounded key count; per process, not a cluster store. */
export class IpRateLimiter {
  private buckets = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 1_000,
  ) {}

  trySpend(key: string, now = Date.now()): boolean {
    let times = this.buckets.get(key);
    if (times) times = times.filter((t) => now - t < this.windowMs);
    else times = [];
    if (times.length >= this.max) {
      this.buckets.set(key, times);
      return false;
    }
    if (this.buckets.size >= this.maxKeys && !this.buckets.has(key)) {
      // Evict the oldest bucket to bound memory; honest for a single process.
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    times.push(now);
    this.buckets.set(key, times);
    return true;
  }
}

function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

const SYSTEM_PROMPT = `You are Saksham, the mentor inside SparkLab, a browser electronics lab for students aged 12-17.
Rules you must never break:
- You answer with strict JSON: {"reply": string, "plan": string, "calls": ToolCall[]}.
- "plan" is ONE short sentence saying what you will do before doing it.
- A ToolCall is one of: placePart{part,x,y}, removePart{id,confirm}, wire{from:{part,pin},to:{part,pin},colour?}, unwire{id?|from,to,confirm}, setAttr{id,key,value}, setInput{name,value}, writeSketch{code,mode:"replace"|"append",confirm}, explainSketch{}, runSimulation{ms}, readSerial{filter?,tail?}, readDiagnostics{}, diffAgainstReference{mission?}, applyReferenceStep{step,confirm}, recommendNextMission{}, summariseMistake{}, openPart{id}, createCapture{}.
- For "from"/"to", "part" may be a part instance id or a catalogue type name (e.g. "led"); "pin" is the pin name (e.g. "A", "K", "D13").
- Destructive tools (removePart, unwire, writeSketch replacing work) must arrive with confirm:false so the student can approve them.
- Never output a locked mission's reference sketch or full solution. Give the smallest next hint instead.
- Keep "reply" under 120 words, warm and concrete, in the student's locale (en or hi). Physics-first explanations.
- You cannot see traces or serial logs directly: use runSimulation/readSerial/readDiagnostics and reason from their later results in the next turn.`;

export interface MentorHandlerDeps {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  limiter?: IpRateLimiter;
  now?: () => number;
}

export async function handleMentorRequest(request: Request, deps: MentorHandlerDeps): Promise<Response> {
  const { env } = deps;
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'mentor-not-configured' }, { status: 503 });
  }
  const rate = mentorRateConfig(env);
  const limiter = deps.limiter ?? new IpRateLimiter(rate.max, rate.windowMs);
  if (!limiter.trySpend(clientIp(request), deps.now?.() ?? Date.now())) {
    return Response.json({ error: 'rate-limited' }, { status: 429 });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return Response.json({ error: 'unreadable-body' }, { status: 400 });
  }
  if (raw.length > MENTOR_BODY_LIMIT) {
    return Response.json({ error: 'payload-too-large' }, { status: 413 });
  }
  const parsed = RequestSchema.safeParse(safeJson(raw));
  if (!parsed.success) {
    return Response.json({ error: 'invalid-request' }, { status: 400 });
  }
  const { message, history, context } = parsed.data;

  const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let providerRes: Response;
  try {
    providerRes = await (deps.fetchImpl ?? fetch)(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history.map((h) => ({ role: h.role === 'mentor' ? 'assistant' : 'user', content: h.content })),
          {
            role: 'user',
            content: `Student locale: ${context.locale}. Active mission: ${context.mission ?? 'none'}. Diagnostics: ${context.diagnosticCodes.join(', ') || 'none'}. Parts on canvas: ${context.partTypes.join(', ') || 'none'}.\n\nStudent says: ${message}`,
          },
        ],
      }),
    });
  } catch {
    clearTimeout(timer);
    return Response.json({ error: 'model-unreachable' }, { status: 502 });
  }
  clearTimeout(timer);
  if (!providerRes.ok) {
    return Response.json({ error: 'model-error', status: providerRes.status }, { status: 502 });
  }
  let content: unknown;
  try {
    const body = (await providerRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content ?? '';
    content = JSON.parse(text);
  } catch {
    return Response.json({ error: 'model-response-unparseable' }, { status: 502 });
  }

  const shape = z.object({
    reply: z.string().max(8_000),
    plan: z.string().max(400).optional(),
    calls: z.array(z.unknown()).max(8).default([]),
  });
  const checked = shape.safeParse(content);
  if (!checked.success) {
    return Response.json({ error: 'model-response-invalid' }, { status: 502 });
  }
  // Validate every tool call against the shared contract; drop anything else.
  const calls = checked.data.calls
    .map((c) => ToolCallSchema.safeParse(c))
    .filter((r) => r.success)
    .map((r) => r.data);
  return Response.json({ reply: checked.data.reply, plan: checked.data.plan ?? null, calls });
}
