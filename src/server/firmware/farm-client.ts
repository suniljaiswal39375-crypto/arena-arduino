/**
 * Next.js -> private build farm proxy. The browser sees only the same-origin
 * `/api/firmware-compile` route and never receives the farm URL/bearer token.
 */
import { z } from 'zod';
import type { FirmwareCompileInput } from '@/lib/sim/firmware/compile-contract';
import { MAX_HEX_BYTES } from './farm-worker';

export interface FarmProxyOptions {
  url: string;
  token: string;
  fetchFn?: typeof fetch;
}

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const MAX_PROXY_BYTES = MAX_HEX_BYTES + 128 * 1024;
const resultSchema = z.object({
  ok: z.literal(true), hex: z.string().min(1).max(MAX_HEX_BYTES),
  cacheKey: z.string().max(120), fqbn: z.string().max(80),
  toolchain: z.object({ path: z.null(), version: z.string().nullable() }).nullable(),
}).strict();
const errorSchema = z.object({ error: z.object({ code: z.string().max(80), message: z.string().max(2048) }) });

function error(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: NO_STORE });
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty farm reply.');
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.length;
      if (total > MAX_PROXY_BYTES) throw new Error('Oversized farm reply.');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) { merged.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(merged));
}

export async function proxyFirmwareBuild(
  request: Request,
  input: FirmwareCompileInput,
  farm: FarmProxyOptions,
): Promise<Response> {
  if (!farm.url || !farm.token) {
    return error(503, 'farm-not-configured', 'Build farm URL and token must both be configured.');
  }
  let url: URL;
  try {
    url = new URL('/v1/compile', farm.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid build farm URL.');
  } catch {
    return error(503, 'farm-not-configured', 'Invalid build farm URL.');
  }
  const stream = request.headers.get('accept')?.split(',').some((value) => value.trim() === 'text/event-stream') ?? false;
  try {
    const remote = await (farm.fetchFn ?? fetch)(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${farm.token}`,
        'Content-Type': 'application/json',
        'Accept': stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(input),
      redirect: 'error', cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]),
    });
    if (stream && remote.ok && remote.body && remote.headers.get('content-type')?.startsWith('text/event-stream')) {
      // Never forward remote Set-Cookie, CORS or cache headers. Event framing
      // and build logs are produced by the trusted internal farm only.
      return new Response(remote.body, {
        status: 200,
        headers: {
          ...NO_STORE, 'Content-Type': 'text/event-stream; charset=utf-8',
          'X-Accel-Buffering': 'no',
        },
      });
    }
    const data = await boundedJson(remote);
    if (!remote.ok) {
      const parsed = errorSchema.safeParse(data);
      const status = [400, 413, 415, 422, 429, 503].includes(remote.status) ? remote.status : 502;
      return error(status, parsed.success ? parsed.data.error.code : 'farm-unavailable',
        parsed.success ? parsed.data.error.message : 'The AVR build farm is unavailable.');
    }
    const parsed = resultSchema.safeParse(data);
    if (!parsed.success || parsed.data.fqbn !== input.boardFqbn || stream) {
      return error(502, 'invalid-farm-reply', 'The AVR build farm returned an invalid response.');
    }
    return Response.json(parsed.data, { headers: NO_STORE });
  } catch {
    return error(503, 'farm-unavailable', 'The AVR build farm is unreachable or timed out.');
  }
}
