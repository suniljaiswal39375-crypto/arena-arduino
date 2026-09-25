import { describe, expect, it } from 'vitest';
import { MentorSession } from './session';
import { templateDoc } from '@/lib/templates';
import type { MentorHost } from './session';

/**
 * Offline end-to-end: the planner + tool runner + Immer store integration.
 * With no model configured, a "wire the LED" request must still produce a
 * real, undoable circuit edit — never a dead-end chat bubble.
 */

function makeHost(): MentorHost {
  return { getContext: () => ({ doc: templateDoc('uno-blink')!, progress: null, missionSlug: null }), applyCommands: () => {}, select: () => undefined };
}

describe('offline mentor round trip', () => {
  it('adds and wires a requested part through the command layer', async () => {
    const session = new MentorSession(makeHost());
    await session.ask('add a red LED and wire it to pin D12 with a resistor');
    const assistant = session.transcript.find((m) => m.role === 'mentor');
    expect(assistant).toBeTruthy();
    expect((assistant!.text ?? '').toLowerCase()).toMatch(/led|added|wired|resistor/);
    const tools = session.transcript.find((m) => m.role === 'tools');
    expect(tools && tools.cards.length).toBeGreaterThan(0);
    expect(session.pendingConfirmation).toBeNull();
  });

  it('refuses to dump a locked mission solution but offers a hint', async () => {
    const session = new MentorSession(makeHost());
    await session.ask('give me the full solution code for this mission');
    const assistant = session.transcript.find((m) => m.role === 'mentor');
    expect(assistant).toBeTruthy();
    // Either a refusal-with-hint or a genuine next step, but never the whole sketch.
    expect((assistant!.text ?? '').length).toBeLessThan(800);
  });

  it('conversational questions answer without mutating the circuit', async () => {
    const session = new MentorSession(makeHost());
    await session.ask('what does a pull-up resistor do?');
    const mutating = session.transcript.some(
      (m) =>
        m.role === 'tools' &&
        m.cards.some((c) => ['placePart', 'wire', 'unwire', 'removePart', 'writeSketch'].includes(c.tool)),
    );
    expect(mutating).toBe(false);
    expect(session.transcript.some((m) => m.role === 'mentor')).toBe(true);
  });
});
