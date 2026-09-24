import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { createFirmwareFarm } from './farm-http';
import { handleFirmwareCompile } from './http';
import { readSseBuild, type BuildMessage } from '@/lib/sim/firmware/build-events';
import { blinkFixture } from '@/lib/sim/firmware/fixtures/blink';

const token = 'a'.repeat(40);
const input = { boardFqbn: 'arduino:avr:uno', sketch: 'void setup() {} void loop() {}', libraries: [] };
const result = () => ({ hex: blinkFixture().hex, fqbn: 'arduino:avr:uno', cacheKey: 'arduino:avr:uno/01234567', toolchain: { path: null, version: null } });
const active: Server[] = [];
async function listen(server: Server): Promise<string> {
  active.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await Promise.all(active.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});
const internal = (url: string, body: unknown, opts: { token?: string; accept?: string } = {}) => fetch(`${url}/v1/compile`, {
  method: 'POST', headers: {
    authorization: `Bearer ${opts.token ?? token}`, 'content-type': 'application/json',
    accept: opts.accept ?? 'application/json',
  }, body: JSON.stringify(body),
});

describe('private build farm HTTP boundary', () => {
  it('refuses unauthenticated, oversized and unsupported builds before executing', async () => {
    const build = vi.fn(async () => result());
    const url = await listen(createFirmwareFarm({ token, image: 'avr:test', build }));
    expect((await internal(url, input, { token: 'wrong' })).status).toBe(401);
    expect((await internal(url, { ...input, sketch: 'x'.repeat(70_000) })).status).toBe(413);
    const bad = await internal(url, { ...input, libraries: ['download-me@latest'] });
    expect(bad.status).toBe(422);
    expect((await bad.json() as { error: { code: string } }).error.code).toBe('unsupported-library');
    expect(build).not.toHaveBeenCalled();
  });

  it('streams compiler text BEFORE the HEX, without disclosing bearer credentials', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const build = vi.fn(async (_input, options: { onLog?: (text: string) => void }) => {
      options.onLog?.('avr-gcc compiling\n');
      await pending;
      return result();
    });
    const url = await listen(createFirmwareFarm({ token, image: 'avr:test', build, maxConcurrent: 1 }));
    const res = await internal(url, input, { accept: 'text/event-stream' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-store');
    const busy = await internal(url, input);
    expect(busy.status).toBe(429);
    const events: BuildMessage[] = [];
    let sawStatus!: () => void;
    const statusReceived = new Promise<void>((resolve) => { sawStatus = resolve; });
    const image = readSseBuild(res, input.boardFqbn, (event) => {
      events.push(event);
      if (event.type === 'status') sawStatus();
    });
    try {
      // The build has not completed yet; its SSE status was already sent.
      await statusReceived;
      expect(events.map((event) => event.text).join('')).toContain('Building');
    } finally {
      finish();
    }
    expect(await image).toBe(result().hex);
    expect(events.map((event) => event.text).join('')).toContain('avr-gcc compiling');
    expect(events.map((event) => event.text).join('')).not.toContain(token);
  });

  it('cancels the job when the SSE client disconnects', async () => {
    let cancelled!: () => void;
    const aborted = new Promise<void>((resolve) => { cancelled = resolve; });
    const build = vi.fn(async (_input, options: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve) => {
        options.signal?.addEventListener('abort', () => { cancelled(); resolve(); }, { once: true });
      });
      return result();
    });
    const url = await listen(createFirmwareFarm({ token, image: 'avr:test', build }));
    const res = await internal(url, input, { accept: 'text/event-stream' });
    await res.body?.cancel();
    await aborted;
    expect(build).toHaveBeenCalledOnce();
  });
});

describe('same-origin Next.js proxy -> internal farm', () => {
  const origin = 'https://lab.example';
  const request = (accept: string, from = origin) => new Request(`${origin}/api/firmware-compile`, {
    method: 'POST', headers: { origin: from, 'content-type': 'application/json', accept },
    body: JSON.stringify(input),
  });

  it('forwards JSON and SSE through the private farm, never exposes its token and never uses the local CLI', async () => {
    const build = vi.fn(async (_input, options: { onLog?: (text: string) => void }) => {
      options.onLog?.('Compiling a real sketch\n');
      return result();
    });
    const url = await listen(createFirmwareFarm({ token, image: 'avr:test', build }));
    const deps = { origin, farm: { url, token }, cli: () => { throw new Error('local CLI must not run'); } };
    const response = await handleFirmwareCompile(request('application/json'), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const json = await response.text();
    expect(json).toContain('00000001FF');
    expect(json).not.toContain(token);

    const streamed = await handleFirmwareCompile(request('text/event-stream'), deps);
    expect(streamed.headers.get('content-type')).toContain('text/event-stream');
    const events: BuildMessage[] = [];
    expect(await readSseBuild(streamed, input.boardFqbn, (event) => events.push(event))).toBe(result().hex);
    expect(events.map((event) => event.text).join('')).toContain('Compiling a real sketch');
    expect(build).toHaveBeenCalledTimes(2);
    expect((await handleFirmwareCompile(request('text/event-stream', 'https://other.example'), deps)).status).toBe(403);
  });

  it('refuses a farm without a configured canonical origin or bearer token', async () => {
    const noCli = async () => ({ path: null, version: null, detail: 'no local CLI' });
    const res = await handleFirmwareCompile(request('text/event-stream'), {
      origin: null, farm: { url: 'http://127.0.0.1:4010', token }, cli: noCli,
    });
    expect(res.status).toBe(503);
    const missing = await handleFirmwareCompile(request('application/json'), {
      origin, farm: { url: 'http://127.0.0.1:4010', token: '' }, cli: noCli,
    });
    expect(missing.status).toBe(503);
  });
});
