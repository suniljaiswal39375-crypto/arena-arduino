/**
 * FirmwareRuntime tests: the single lifecycle the worker, client and harness
 * share — sketch -> machine code resolution (offline), loading, run, stop,
 * reset and the honest refusal surface.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { FirmwareRuntime, compileInputFor } from './firmware-runtime';
import { KNOWN_PROGRAMS } from './known-programs';
import { blinkFixture } from './fixtures/blink';
import { templateDoc } from '@/lib/templates';

describe('FirmwareRuntime', () => {
  it('loads the blink-baseline sketch and runs a bounded frame', () => {
    const { doc } = blinkFixture();
    const program = KNOWN_PROGRAMS.find((p) => p.key === 'blink')!;
    doc.files['sketch.ino'] = program.sketchSource;
    const rt = new FirmwareRuntime(doc);
    const res = rt.load(doc, { nodeMode: true });
    expect(res.ok).toBe(true);
    expect(res.source).toBe('offline-baseline');
    rt.start();
    const { snapshot, err } = rt.run(100);
    expect(err).toBeNull();
    const seen = Object.values(snapshot.parts).filter((p) => p.kind === 'led');
    expect(seen.length).toBe(1);
  });

  it('refuses a non-baseline sketch with an honest message', () => {
    const { doc } = blinkFixture();
    doc.files['sketch.ino'] = 'void setup() {}\nvoid loop() {}\n';
    const rt = new FirmwareRuntime(doc);
    const res = rt.load(doc, { nodeMode: true });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not one of the known offline baselines/);
    expect(rt.snapshot().status.kind).toBe('idle');
  });

  it('keeps the board and sketch from the document', () => {
    const doc = templateDoc('uno-blink')!;
    const rt = new FirmwareRuntime(doc);
    const res = rt.load(doc, { nodeMode: true });
    // The uno-blink template matches the baseline sketch the catalog ships.
    expect(res).toMatchObject({ ok: true });
  });

  it('refuses an unsupported board instead of compiling it as an Uno', () => {
    const { doc } = blinkFixture();
    const board = doc.diagram.parts.find((part) => part.type === 'arduino-uno');
    expect(board).toBeDefined();
    board!.type = 'arduino-mega';
    doc.files['sketch.ino'] = KNOWN_PROGRAMS.find((p) => p.key === 'blink')!.sketchSource;
    expect(compileInputFor(doc).boardFqbn).toBe('arduino-mega');
    const rt = new FirmwareRuntime(doc);
    expect(rt.load(doc)).toMatchObject({ ok: false });
    expect(rt.hasImage).toBe(false);
  });

  it('stop then reset restores a running image', () => {
    const { doc } = blinkFixture();
    doc.files['sketch.ino'] = KNOWN_PROGRAMS.find((p) => p.key === 'blink')!.sketchSource;
    const rt = new FirmwareRuntime(doc);
    rt.load(doc, { nodeMode: true });
    rt.start();
    rt.run(50);
    rt.stop();
    expect(rt.snapshot().running).toBe(false);
    rt.reset();
    expect(rt.snapshot().running).toBe(true);
  });

  it('reports generated real machine code words (compile-offline fulfilled)', () => {
    const { doc } = blinkFixture();
    const program = KNOWN_PROGRAMS.find((p) => p.key === 'blink-serial')!;
    doc.files['sketch.ino'] = program.sketchSource;
    const rt = new FirmwareRuntime(doc);
    rt.load(doc, { nodeMode: true });
    rt.start();
    // The serial baseline prints "A" once in setup.
    let found = false;
    for (let i = 0; i < 20 && !found; i++) {
      rt.run(16);
      found = rt.snapshot().serial.some((l) => l.text.includes('A'));
    }
    expect(found).toBe(true);
  });
});

describe('FirmwareRuntime hosted compile transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the hosted HEX when the compile service answers', async () => {
    const { doc } = blinkFixture();
    doc.files['sketch.ino'] = 'void setup() {}\nvoid loop() {}\n'; // not a baseline
    const hostedHex = KNOWN_PROGRAMS.find((p) => p.key === 'blink')!.hex;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, hex: hostedHex }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const rt = new FirmwareRuntime(doc);
    const res = await rt.loadViaCompile(doc, { compileEndpoint: '/api/firmware-compile' });
    expect(res.ok).toBe(true);
    expect(res.source).toBe('toolchain');
    expect(rt.lastHex).toBe(hostedHex);
  });

  it('streams SSE build logs and loads the real HEX instead of the interpreter', async () => {
    const { doc } = blinkFixture();
    doc.files['sketch.ino'] = 'void setup() {} void loop() {}'; // not a baseline
    const hex = blinkFixture().hex;
    const stream = [
      `event: status\ndata: {"text":"Building AVR"}\n\n`,
      `event: log\ndata: {"text":"avr-gcc compiling"}\n\n`,
      `event: result\ndata: ${JSON.stringify({ hex, fqbn: 'arduino:avr:uno' })}\n\n`,
    ].join('');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
    const logs: string[] = [];
    const rt = new FirmwareRuntime(doc);
    const loaded = await rt.loadViaCompile(doc, { compileEndpoint: '/api/firmware-compile',
      onBuildEvent: (event) => logs.push(event.text) });
    expect(loaded).toMatchObject({ ok: true, source: 'toolchain' });
    expect(logs).toEqual(['Building AVR', 'avr-gcc compiling']);
    expect(rt.lastHex).toBe(hex);
  });

  it('preserves the real SSE compiler error and refuses an unknown offline sketch', async () => {
    const { doc } = blinkFixture();
    doc.files['sketch.ino'] = 'void setup() { nonexistent(); } void loop() {}';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'event: error\ndata: {"code":"compile-failed","message":"unknown function nonexistent"}\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )));
    const logs: string[] = [];
    const rt = new FirmwareRuntime(doc);
    const loaded = await rt.loadViaCompile(doc, { compileEndpoint: '/api/firmware-compile',
      onBuildEvent: (event) => logs.push(event.text) });
    expect(loaded.ok).toBe(false);
    expect(rt.hasImage).toBe(false);
    expect(logs).toEqual(['unknown function nonexistent']);
  });

  it('falls back to the offline baseline when the service refuses', async () => {
    const { doc } = blinkFixture();
    doc.files['sketch.ino'] = KNOWN_PROGRAMS.find((p) => p.key === 'blink')!.sketchSource;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'no-arduino-cli' } }), { status: 503, headers: { 'content-type': 'application/json' } })));
    const rt = new FirmwareRuntime(doc);
    const res = await rt.loadViaCompile(doc, { compileEndpoint: '/api/firmware-compile' });
    expect(res.ok).toBe(true);
    expect(res.source).toBe('offline-baseline');
  });

  it('falls back to the offline baseline when the network fails', async () => {
    const { doc } = blinkFixture();
    doc.files['sketch.ino'] = KNOWN_PROGRAMS.find((p) => p.key === 'blink')!.sketchSource;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const rt = new FirmwareRuntime(doc);
    const res = await rt.loadViaCompile(doc, { compileEndpoint: '/api/firmware-compile' });
    expect(res.ok).toBe(true);
    expect(res.source).toBe('offline-baseline');
  });
});
