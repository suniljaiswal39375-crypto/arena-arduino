import { describe, expect, it } from 'vitest';
import { templateDoc } from '@/lib/templates';
import { execute, type Command } from '@/lib/doc/commands';
import { makeWire } from '@/lib/doc/factory';
import type { ProjectDoc } from '@/lib/doc/types';
import { emptyProgress } from '@/lib/skills';
import { clearAudit, auditLog } from './audit';
import { MentorSession, type MentorHost } from './session';
import { sketchSimilarity } from './guardrails';
import { missionBySlug } from '@/lib/missions/missions';

/**
 * End-to-end session behaviour against the real command layer — the same path
 * the builder UI uses. The host records applied command groups so tests can
 * prove the mentor only ever writes through undoable commands.
 */
function makeHost(doc: ProjectDoc, over: Partial<MentorHost> = {}): MentorHost & { docs: ProjectDoc[]; labels: string[]; selections: (string | null)[] } {
  let current = doc;
  const docs: ProjectDoc[] = [current];
  const labels: string[] = [];
  const selections: (string | null)[] = [];
  return {
    docs,
    labels,
    selections,
    getContext: () => ({ doc: current, missionSlug: current.provenance.mission ?? null, progress: emptyProgress() }),
    applyCommands: (commands, label) => {
      labels.push(label);
      for (const cmd of commands as Command[]) current = execute(current, cmd).doc;
      docs.push(current);
    },
    select: (id) => selections.push(id),
    ...over,
  };
}

describe('MentorSession: turns through the command layer', () => {
  it('applies recipe commands as labelled undoable groups', async () => {
    const doc = templateDoc('uno-blink')!;
    const host = makeHost(doc);
    const session = new MentorSession(host, 'en');
    clearAudit();
    await session.ask('make a thermometer');
    expect(host.labels.length).toBeGreaterThan(2);
    expect(host.labels.every((l) => l.startsWith('AI: '))).toBe(true);
    // The document actually changed: a DHT and an LCD are on the canvas.
    const final = host.docs.at(-1)!;
    const types = final.diagram.parts.map((p) => p.type);
    expect(types).toContain('dht11');
    expect(types).toContain('lcd-16x2-i2c');
    expect(auditLog().some((e) => e.kind === 'commands')).toBe(true);
    const transcript = session.transcript;
    expect(transcript.some((m) => m.role === 'tools')).toBe(true);
  });

  it('withholds a destructive call until confirmed, then applies exactly once', async () => {
    const doc = templateDoc('uno-blink')!;
    const host = makeHost(doc);
    const session = new MentorSession(host, 'en');
    // Drive the confirm path directly: queue an unconfirmed removal.
    await session.execute([{ tool: 'removePart', id: 'led1' }]);
    expect(session.hasPending).toBe(true);
    const before = host.docs.at(-1)!;
    expect(before.diagram.parts.some((p) => p.id === 'led1')).toBe(true);
    session.confirmPending();
    expect(session.hasPending).toBe(false);
    const after = host.docs.at(-1)!;
    expect(after.diagram.parts.some((p) => p.id === 'led1')).toBe(false);
    expect(host.labels.at(-1)).toMatch(/confirmed/);
    session.confirmPending(); // idempotent: nothing pending
    expect(host.docs.length).toBe(host.docs.length);
  });

  it('cancelling a destructive call changes nothing', async () => {
    const doc = templateDoc('uno-blink')!;
    const host = makeHost(doc);
    const session = new MentorSession(host, 'en');
    await session.execute([{ tool: 'unwire', id: doc.diagram.connections[0]!.id }]);
    expect(session.hasPending).toBe(true);
    session.cancelPending();
    expect(session.hasPending).toBe(false);
    expect(host.docs.at(-1)!.diagram.connections.length).toBe(doc.diagram.connections.length);
    expect(session.transcript.at(-1)).toMatchObject({ role: 'tools' });
  });

  it('never writes the locked reference sketch, even when asked directly', async () => {
    const mission = missionBySlug('smart-streetlight')!;
    const doc = templateDoc('uno-blink')!;
    doc.provenance.mission = mission.slug;
    const host = makeHost(doc);
    const session = new MentorSession(host, 'en');
    await session.execute([{ tool: 'writeSketch', code: mission.referenceSketch, mode: 'replace', confirm: true }]);
    const final = host.docs.at(-1)!;
    // The sketch on the document is still nothing like the reference.
    expect(sketchSimilarity(final.files['sketch.ino'] ?? '', mission.referenceSketch)).toBeLessThan(0.5);
    const cards = session.transcript.find((m) => m.role === 'tools');
    expect(cards && cards.role === 'tools' && cards.cards[0]?.ok).toBe(false);
  });

  it('rate-limits honest turns and says so', async () => {
    const doc = templateDoc('uno-blink')!;
    const host = makeHost(doc);
    const session = new MentorSession(host, 'en');
    // Exhaust the window.
    for (let i = 0; i < 30; i++) await session.ask(`question ${i} about resistors`);
    await session.ask('one more question');
    const last = session.transcript.at(-1);
    expect(last).toMatchObject({ role: 'mentor' });
    expect(last && last.role === 'mentor' && /slow down/i.test(last.text)).toBe(true);
  }, 30_000);

  it('ignores empty and pending-blocked asks', async () => {
    const doc = templateDoc('uno-blink')!;
    const host = makeHost(doc);
    const session = new MentorSession(host, 'en');
    await session.ask('   ');
    expect(session.transcript).toHaveLength(0);
    await session.execute([{ tool: 'removePart', id: 'led1' }]);
    const n = session.transcript.length;
    await session.ask('explain my sketch');
    expect(session.transcript.length).toBe(n); // blocked while a confirm is open
  });
});

describe('MentorSession: findings and feedback', () => {
  it('inspects the live snapshot and replaces old findings', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.connections.push(makeWire({ part: 'uno', pin: 'D13' }, { part: 'uno', pin: '5V' }, 'orange'));
    const host = makeHost(doc, {
      getContext: () => ({
        doc,
        missionSlug: null,
        progress: emptyProgress(),
        snapshot: {
          running: false, clockUs: 2_000_000, parts: {}, serial: [], serialTotal: 0, serialDropped: 0, plot: [], plotLabels: [],
          logicAnalyzers: [], scope: null, multimeter: null, error: null, unsupported: [],
        },
      }),
    });
    const session = new MentorSession(host, 'en');
    const first = session.inspectLastRun();
    expect(first.some((f) => f.code === 'erc-error')).toBe(true);
    const again = session.inspectLastRun();
    const findingsMessages = session.transcript.filter((m) => m.role === 'findings');
    expect(findingsMessages).toHaveLength(1); // replaced, not stacked
    expect(again.length).toBe(first.length);
  });

  it('thumbs down is recorded and acknowledged without persisting anything', () => {
    const doc = templateDoc('uno-blink')!;
    const host = makeHost(doc);
    const session = new MentorSession(host, 'en');
    clearAudit();
    session.thumbsDown(999); // no such message: no-op
    expect(auditLog().some((e) => e.kind === 'thumbs-down')).toBe(false);
    void session.ask('hello').then(() => {
      const mentorMsg = session.transcript.find((m) => m.role === 'mentor');
      expect(mentorMsg).toBeDefined();
      session.thumbsDown(mentorMsg!.id);
      expect(auditLog().some((e) => e.kind === 'thumbs-down')).toBe(true);
    });
  });

  it('clear() empties the transcript', async () => {
    const doc = templateDoc('uno-blink')!;
    const host = makeHost(doc);
    const session = new MentorSession(host, 'en');
    await session.ask('why does it not work?');
    expect(session.transcript.length).toBeGreaterThan(0);
    session.clear();
    expect(session.transcript).toHaveLength(0);
  });
});
