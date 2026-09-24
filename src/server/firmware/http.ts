/**
 * HTTP boundary for the firmware compile service (`POST /api/firmware-compile`).
 *
 * This is the "toolchain present" upgrade path only. It never fakes a build:
 * when arduino-cli 1.x is absent the response is a precise 503, and the client
 * falls back to the offline baseline stub. The route is server-side Node.js,
 * resource-bounded (streamed body cap, sketch/libraries limits, compile
 * heartbeat + deadline) and origin-checked the same way classrooms are.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CompileUnavailableError,
  assertWithinCompileLimits,
  assertSupportedAvrBuild,
  type FirmwareCompileInput,
} from '@/lib/sim/firmware/compile-contract';
import { discoverLocalCli, compileSketch } from './compile-service';
import { proxyFirmwareBuild, type FarmProxyOptions } from './farm-client';

export const MAX_FIRMWARE_BODY_BYTES = 64 * 1024;

const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
} as const;
const reply = (data: unknown, status = 200): Response => Response.json(data, { status, headers });

/** A sketch is the only accepted payload: bounded, with a bounded library list. */
export const compileBody = z.object({
  boardFqbn: z.string().trim().min(1).max(80),
  sketch: z.string().min(1),
  libraries: z.array(z.string().trim().max(256)).max(16).default([]),
}).strict();

async function readJson(request: Request): Promise<{ json: unknown } | { response: Response }> {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    return { response: replyError(415, 'json-required', 'Send an application/json body.') };
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_FIRMWARE_BODY_BYTES) {
    return { response: replyError(413, 'too-large', 'Firmware compile requests are limited to 64 KiB.') };
  }
  const reader = request.body?.getReader();
  if (!reader) return { response: replyError(400, 'invalid-json', 'A JSON body is required.') };
  let total = 0;
  let text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_FIRMWARE_BODY_BYTES) {
        await reader.cancel();
        return { response: replyError(413, 'too-large', 'Firmware compile requests are limited to 64 KiB.') };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { json: JSON.parse(text) };
  } catch {
    return { response: replyError(400, 'invalid-json', 'The request body must contain valid JSON.') };
  } finally {
    reader.releaseLock();
  }
}

function replyError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

export interface FirmwareCompileDeps {
  origin: string | null;
  cli: () => Promise<{ path: string | null; version: string | null; detail: string }>;
  /** When configured, the isolated farm is preferred over the local CLI. */
  farm?: FarmProxyOptions;
}

/**
 * Compile a bounded sketch to Intel HEX. Errors map to the honest status codes
 * the client already understands, never to a fake success.
 */
export async function handleFirmwareCompile(request: Request, deps: FirmwareCompileDeps): Promise<Response> {
  if (request.method !== 'POST') {
    return replyError(405, 'method-not-allowed', 'POST is the only accepted method.');
  }
  if (deps.origin && request.headers.get('origin') !== deps.origin) {
    return replyError(403, 'origin-rejected', 'This request must come from the configured app origin.');
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return replyError(403, 'origin-rejected', 'Cross-site requests are not accepted.');
  }

  const read = await readJson(request);
  if ('response' in read) return read.response;
  const parsed = compileBody.safeParse(read.json);
  if (!parsed.success) {
    return replyError(400, 'invalid-input', 'Check the submitted sketch and fields.');
  }
  const input: FirmwareCompileInput = parsed.data;

  try {
    assertWithinCompileLimits(input);
    assertSupportedAvrBuild(input);
  } catch (err) {
    const e = err as CompileUnavailableError;
    const status = e.reason === 'unsupported-board' || e.reason === 'unsupported-library' ? 422 : 413;
    return replyError(status, e.reason, e.message);
  }

  if (deps.farm) {
    if (!deps.origin) return replyError(503, 'farm-not-configured', 'Set a canonical AUTH_URL before enabling the build farm.');
    return proxyFirmwareBuild(request, input, deps.farm);
  }

  const cli = await deps.cli();
  if (!cli.path) {
    return replyError(503, 'no-arduino-cli', cli.detail || 'No AVR toolchain is available to this build service.');
  }
  // Spawning avr-gcc beside Next.js is a developer-only validation path.
  // Arbitrary C++ compilation in a deployed service MUST use the isolated farm.
  if (process.env.NODE_ENV === 'production') {
    return replyError(503, 'isolated-farm-required', 'Production firmware compilation requires an isolated build farm.');
  }

  try {
    const result = await compileSketch(input, cli, randomUUID());
    return reply({ ok: true, hex: result.hex, hexBytes: result.hex.length, cacheKey: result.cacheKey, fqbn: result.fqbn, toolchain: result.toolchain });
  } catch (err) {
    const e = err as CompileUnavailableError | Error;
    if (e instanceof CompileUnavailableError) {
      const status = e.reason === 'sketch-too-large' || e.reason === 'libraries-too-many' ? 413 : 503;
      return replyError(status, e.reason ?? 'compile-failed', e.message);
    }
    return replyError(503, 'compile-failed', e.message ?? 'The firmware build failed.');
  }
}
