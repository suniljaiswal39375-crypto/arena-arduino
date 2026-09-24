/**
 * SimClient routing: functional docs keep the interpreter path, firmware docs
 * are routed to the firmware engine (worker or inline), and the adapter turns
 * a firmware snapshot into the UI's SimSnapshot shape without inventing data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KNOWN_PROGRAMS } from './firmware/known-programs';
import { blinkFixture } from './firmware/fixtures/blink';

describe('SimClient firmware routing (no Worker)', () => {
  let frameCb: FrameRequestCallback | null = null;

  beforeEach(() => {
    // Simulate "no Worker" so client.ts takes the inline firmware path. Node's
    // worker_threads provides a global Worker, so stub it away entirely. The
    // rAF stub captures the loop callback so tests can drive frames manually.
    frameCb = null;
    const af = (cb: FrameRequestCallback): number => {
      frameCb = cb;
      return 1;
    };
    vi.stubGlobal('window', {});
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('requestAnimationFrame', af);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Wait until the inline firmware runtime has installed its rAF loop. */
  async function untilLoopReady(): Promise<void> {
    const deadline = Date.now() + 1000;
    for (;;) {
      if (frameCb) return;
      if (Date.now() > deadline) throw new Error('inline firmware loop never started');
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  it('routes a firmware doc to the firmware engine and emits adapted state', async () => {
    const { SimClient } = await import('./client');
    const { doc } = blinkFixture();
    doc.engine = 'firmware';
    doc.files['sketch.ino'] = KNOWN_PROGRAMS.find((p) => p.key === 'blink')!.sketchSource;

    const client = new SimClient();
    const states: unknown[] = [];
    client.onState = (s) => states.push(s);
    client.load(doc, doc.files['sketch.ino']);
    await untilLoopReady();
    client.start();
    const t0 = performance.now();
    if (frameCb) frameCb(t0 + 16);
    if (frameCb) frameCb(t0 + 32);
    expect(states.length).toBeGreaterThan(0);
    const snap = states.at(-1) as { clockUs: number; parts: Record<string, unknown> };
    expect(snap.clockUs).toBeGreaterThan(0);
    const led = Object.values(snap.parts).find((p) => (p as { kind?: string }).kind === 'led');
    expect(led).toBeDefined();
    client.dispose();
  });

  it('reports an honest compile refusal through the firmware path', async () => {
    const { SimClient } = await import('./client');
    const { doc } = blinkFixture();
    doc.engine = 'firmware';
    doc.files['sketch.ino'] = 'void setup() {}\nvoid loop() {}\n';

    const client = new SimClient();
    const states: unknown[] = [];
    client.onState = (s) => states.push(s);
    client.load(doc, doc.files['sketch.ino']);
    await new Promise((r) => setTimeout(r, 80));
    const snap = states[0] as { error: { message: string } | null };
    expect(snap.error?.message).toMatch(/not one of the known offline baselines/);
    client.dispose();
  });

  it('keeps the functional path for non-firmware docs', async () => {
    const { SimClient } = await import('./client');
    const { doc } = blinkFixture();
    doc.engine = 'functional';
    const client = new SimClient();
    const states: unknown[] = [];
    client.onState = (s) => states.push(s);
    client.load(doc, doc.files['sketch.ino'] ?? '');
    await untilLoopReady();
    const t0b = performance.now(); if (frameCb) frameCb(t0b + 16);
    expect(client.currentDoc()?.engine).toBe('functional');
    expect(states.length).toBeGreaterThan(0);
    client.dispose();
  });
});
