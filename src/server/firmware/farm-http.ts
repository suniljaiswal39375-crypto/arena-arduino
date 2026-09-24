/**
 * Operator-only build farm service. Public browsers must contact the Next.js
 * same-origin route, NEVER this bearer-authenticated internal service or the
 * Docker daemon. Every accepted job gets one disposable no-network container.
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { CompileResult, FirmwareCompileInput } from '@/lib/sim/firmware/compile-contract';
import { CompileUnavailableError } from '@/lib/sim/firmware/compile-contract';
import { compileBody, MAX_FIRMWARE_BODY_BYTES } from './http';
import { assertFarmInput, compileInContainer, FarmError, type FarmWorkerOptions } from './farm-worker';

export interface FarmConfig {
  token: string;
  image: string;
  dockerPath?: string;
  maxConcurrent?: number;
  timeoutMs?: number;
  /** Injected only by unit tests; deployment always runs the Docker worker. */
  build?: (input: FirmwareCompileInput, options: FarmWorkerOptions) => Promise<CompileResult>;
}

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { ...NO_STORE, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
function authorized(req: IncomingMessage, token: string): boolean {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(auth.slice(7));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function inputFrom(req: IncomingMessage): Promise<FirmwareCompileInput> {
  if (req.headers['content-type']?.split(';')[0]?.toLowerCase() !== 'application/json') {
    throw new FarmError('json-required', 'Send a JSON compile request.', 415);
  }
  if (Number(req.headers['content-length'] ?? 0) > MAX_FIRMWARE_BODY_BYTES) {
    throw new FarmError('too-large', 'Build requests are limited to 64 KiB.', 413);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_FIRMWARE_BODY_BYTES) {
      throw new FarmError('too-large', 'Build requests are limited to 64 KiB.', 413);
    }
    chunks.push(chunk as Buffer);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new FarmError('invalid-json', 'Build request must be valid JSON.', 400); }
  const parsed = compileBody.safeParse(value);
  if (!parsed.success) throw new FarmError('invalid-input', 'Check the sketch and board fields.', 400);
  assertFarmInput(parsed.data);
  return parsed.data;
}

function failure(err: unknown): { code: string; message: string; status: number } {
  if (err instanceof FarmError) return { code: err.code, message: err.message, status: err.status };
  if (err instanceof CompileUnavailableError) {
    const status = err.reason === 'unsupported-board' || err.reason === 'unsupported-library' ? 422 : 413;
    return { code: err.reason, message: err.message, status };
  }
  // Never return unhandled stack traces, absolute paths or the Docker token.
  return { code: 'build-unavailable', message: 'The AVR builder is unavailable.', status: 503 };
}

/** The same service handles JSON for legacy callers and streamed SSE for UI. */
export function createFirmwareFarm(config: FarmConfig): Server {
  if (!config.token || config.token.length < 32) throw new Error('A build-farm bearer token of at least 32 characters is required.');
  if (!config.image) throw new Error('A pinned AVR container image is required.');
  const limit = Math.max(1, Math.min(8, config.maxConcurrent ?? 2));
  let active = 0;
  const build = config.build ?? compileInContainer;
  const server = createServer(async (req, res) => {
    if (req.url !== '/v1/compile' || req.method !== 'POST') {
      json(res, 404, { error: { code: 'not-found', message: 'Unknown build-farm endpoint.' } });
      return;
    }
    if (!authorized(req, config.token)) {
      json(res, 401, { error: { code: 'unauthorized', message: 'The internal build service requires authorization.' } });
      return;
    }
    if (active >= limit) {
      res.setHeader('Retry-After', '5');
      json(res, 429, { error: { code: 'farm-busy', message: 'All AVR build slots are occupied.' } });
      return;
    }
    active++;
    try {
      const input = await inputFrom(req);
      const stream = req.headers.accept?.split(',').some((item) => item.trim() === 'text/event-stream') ?? false;
      const controller = new AbortController();
      const onClose = (): void => controller.abort();
      res.once('close', onClose);
      const onLog = (text: string): void => {
        if (stream && !res.destroyed) res.write(`event: log\ndata: ${JSON.stringify({ text })}\n\n`);
      };
      if (stream) {
        res.writeHead(200, {
          ...NO_STORE,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'X-Accel-Buffering': 'no',
          'Connection': 'keep-alive',
        });
        res.write(`event: status\ndata: ${JSON.stringify({ text: 'Building in an isolated AVR container' })}\n\n`);
      }
      const heartbeat = stream ? setInterval(() => {
        if (!res.destroyed) res.write(': keepalive\n\n');
      }, 5_000) : null;
      try {
        const result = await build(input, {
          image: config.image, dockerPath: config.dockerPath, timeoutMs: config.timeoutMs,
          signal: controller.signal, onLog,
        });
        if (!res.destroyed) {
          if (stream) {
            res.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
            res.end();
          } else {
            json(res, 200, { ok: true, ...result });
          }
        }
      } catch (err) {
        const { status, code, message } = failure(err);
        if (!res.destroyed) {
          if (stream) {
            res.write(`event: error\ndata: ${JSON.stringify({ code, message })}\n\n`);
            res.end();
          } else {
            json(res, status, { error: { code, message } });
          }
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        res.off('close', onClose);
      }
    } catch (err) {
      const { status, code, message } = failure(err);
      if (!res.headersSent && !res.destroyed) json(res, status, { error: { code, message } });
    } finally {
      active--;
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
