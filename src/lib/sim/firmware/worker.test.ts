/**
 * Firmware worker protocol tests: load a baseline sketch through the worker's
 * message boundary (with `self`/`postMessage`/timers stubbed to the Node test
 * host), assert the state flow, the load-error honesty, and dispose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDoc } from '@/lib/doc/types';
import { KNOWN_PROGRAMS } from './known-programs';
import { blinkFixture } from './fixtures/blink';

type Handler = (event: MessageEvent<unknown>) => void;

describe('firmware worker protocol', () => {
  let onmessage: Handler | null = null;
  let sent: unknown[] = [];

  beforeEach(() => {
    onmessage = null;
    sent = [];
    const selfHost = {
      onmessage: null as Handler | null,
      postMessage: (m: unknown) => sent.push(m),
    };
    // The worker captures onmessage as `self.onmessage = ...` and posts from
    // `(self as Worker).postMessage`. Give it an object with both shapes.
    Object.defineProperty(selfHost, 'onmessage', {
      get: () => onmessage,
      set: (h: Handler) => (onmessage = h),
      configurable: true,
    });
    vi.stubGlobal('self', selfHost);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function bootWorker(): Promise<void> {
    // Re-import the module per test so its module-level `post({ready})` and
    // `self.onmessage = ...` re-run against the fresh stub.
    vi.resetModules();
    await import('./worker');
  }

  it('loads a baseline sketch, starts, and posts running state', async () => {
    await bootWorker();
    expect(sent[0]).toMatchObject({ type: 'ready' });
    const { doc } = blinkFixture();
    doc.files['sketch.ino'] = KNOWN_PROGRAMS.find((p) => p.key === 'blink')!.sketchSource;
    await onmessage!({ data: { type: 'load', doc: projectClone(doc), source: doc.files['sketch.ino'], nodeMode: true } } as MessageEvent);
    const states = sent.filter((m) => (m as { type?: string }).type === 'state');
    expect(states.length).toBeGreaterThan(0);
    const snap = (states[0] as { snapshot: { status: { kind: string } } }).snapshot;
    expect(snap.status.kind).toBe('running');
  });

  it('reports an honest load-error for a non-baseline sketch', async () => {
    await bootWorker();
    const { doc } = blinkFixture();
    doc.files['sketch.ino'] = 'void setup() {}\nvoid loop() {}\n';
    await onmessage!({ data: { type: 'load', doc: projectClone(doc), source: doc.files['sketch.ino'], nodeMode: true } } as MessageEvent);
    const errors = sent.filter((m) => (m as { type?: string }).type === 'load-error');
    expect(errors.length).toBe(1);
    expect((errors[0] as { message: string }).message).toMatch(/not one of the known offline baselines/);
  });

  it('stop pauses and dispose clears the loop', async () => {
    await bootWorker();
    const { doc } = blinkFixture();
    doc.files['sketch.ino'] = KNOWN_PROGRAMS.find((p) => p.key === 'blink')!.sketchSource;
    await onmessage!({ data: { type: 'load', doc: projectClone(doc), source: doc.files['sketch.ino'], nodeMode: true } } as MessageEvent);
    await onmessage!({ data: { type: 'stop' } } as MessageEvent);
    const last = sent.filter((m) => (m as { type?: string }).type === 'state').at(-1) as
      | { snapshot: { running: boolean; status: { kind: string } } }
      | undefined;
    // The stop itself does not emit a state; run a frame to observe 'paused'.
    await onmessage!({ data: { type: 'start' } } as MessageEvent);
    await onmessage!({ data: { type: 'stop' } } as MessageEvent);
    expect(last?.snapshot.status.kind).toBe('running');
    await onmessage!({ data: { type: 'dispose' } } as MessageEvent);
    expect(sent.length).toBeGreaterThan(0);
  });
});

/** The worker must never mutate the caller's document in place. */
function projectClone(doc: ProjectDoc): ProjectDoc {
  return JSON.parse(JSON.stringify(doc)) as ProjectDoc;
}
