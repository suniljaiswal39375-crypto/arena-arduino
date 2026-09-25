import { z } from 'zod';
import { redactPII } from './redact';
import { parseToolCall, type ToolCallInput } from './tools';

/**
 * The model-agnostic mentor gateway client (spec §12).
 *
 * The browser never talks to a model provider directly and never holds a key:
 * it posts a redacted, bounded conversation to the same-origin gateway route
 * (`/api/mentor`), which is only mounted when an operator configures a model.
 * Any failure — disabled, offline, timeout, malformed response — resolves to
 * `ok: false` and the session falls back to the deterministic planner, so the
 * mentor always answers.
 *
 * Privacy: student text is PII-redacted again here (defence in depth) and the
 * payload carries the minimum context needed: mission slug, diagnostic codes,
 * part types. No traces, no serial logs, no project JSON leaves the browser.
 */

export const MENTOR_ROUTE = '/api/mentor';

/** Feature flag from env; unset means "planner only", which is the default. */
export function mentorGatewayEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_MENTOR === 'true';
}

/** An operator can point the client at an external gateway instead. */
export function mentorEndpoint(): string {
  return process.env.NEXT_PUBLIC_MENTOR_ENDPOINT || MENTOR_ROUTE;
}

export interface GatewayTurn {
  role: 'user' | 'mentor';
  content: string;
}

export interface GatewayContext {
  locale: 'en' | 'hi';
  mission?: string | null;
  diagnosticCodes: string[];
  partTypes: string[];
}

export interface GatewayRequest {
  message: string;
  history: GatewayTurn[];
  context: GatewayContext;
}

const GatewayResponseSchema = z.object({
  reply: z.string().max(8_000),
  plan: z.string().max(400).optional(),
  calls: z.array(z.unknown()).max(8).default([]),
});

export type GatewayResult =
  | { ok: true; reply: string; plan: string | null; calls: ToolCallInput[] }
  | { ok: false; reason: string };

const TIMEOUT_MS = 12_000;

export async function callMentorGateway(
  req: GatewayRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayResult> {
  const payload = {
    message: redactPII(req.message).slice(0, 2_000),
    history: req.history.slice(-6).map((h) => ({ role: h.role, content: redactPII(h.content).slice(0, 2_000) })),
    context: req.context,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(mentorEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, reason: `gateway ${res.status}` };
    }
    const data: unknown = await res.json();
    const parsed = GatewayResponseSchema.safeParse(data);
    if (!parsed.success) return { ok: false, reason: 'gateway response failed validation' };
    // Only tool calls that satisfy the full contract survive.
    const calls: ToolCallInput[] = [];
    for (const raw of parsed.data.calls) {
      const call = parseToolCall(raw);
      if (call) calls.push(call);
    }
    return { ok: true, reply: parsed.data.reply, plan: parsed.data.plan ?? null, calls };
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'gateway timeout' : 'gateway unreachable';
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
