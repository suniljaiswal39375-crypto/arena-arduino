import { describe, expect, it } from 'vitest';
import { accumulateSerial, emptySerialTranscript, SERIAL_VIEW_CAP, type SerialTranscriptState } from './serial-transcript';
import type { SerialLine } from './runtime';

const line = (i: number): SerialLine => ({ at: i * 1000, text: `line ${i}\n` });
const windowOf = (from: number, to: number): SerialLine[] =>
  Array.from({ length: to - from }, (_, i) => line(from + i));

describe('session serial transcript', () => {
  it('folds consecutive overlapping windows without duplicating a line', () => {
    let state = emptySerialTranscript();
    state = accumulateSerial(state, windowOf(0, 4), 4);
    state = accumulateSerial(state, windowOf(2, 8), 8); // overlaps by 2
    state = accumulateSerial(state, windowOf(6, 9), 9); // overlaps by 2, one new
    expect(state.lines.map((l) => l.text)).toEqual([
      'line 0\n', 'line 1\n', 'line 2\n', 'line 3\n', 'line 4\n', 'line 5\n', 'line 6\n', 'line 7\n', 'line 8\n',
    ]);
    expect(state.seen).toBe(9);
    expect(state.dropped).toBe(0);
  });

  it('is idempotent when the same snapshot arrives twice', () => {
    let state = accumulateSerial(emptySerialTranscript(), windowOf(0, 5), 5);
    state = accumulateSerial(state, windowOf(0, 5), 5);
    expect(state.lines).toHaveLength(5);
    expect(state.dropped).toBe(0);
  });

  it('counts lines lost between snapshots instead of silently forgetting them', () => {
    let state = accumulateSerial(emptySerialTranscript(), windowOf(0, 3), 3);
    // The engine printed lines 3..9 before the next snapshot; its window only
    // reaches back to 6, so 3..5 were never visible here.
    state = accumulateSerial(state, windowOf(6, 10), 10);
    expect(state.lines.map((l) => l.text)).toEqual(['line 0\n', 'line 1\n', 'line 2\n', 'line 6\n', 'line 7\n', 'line 8\n', 'line 9\n']);
    expect(state.dropped).toBe(3);
  });

  it('starts over when the engine restarts (lifetime count rewinds)', () => {
    let state = accumulateSerial(emptySerialTranscript(), windowOf(0, 6), 6);
    state = accumulateSerial(state, windowOf(0, 2), 2); // fresh run
    expect(state.lines.map((l) => l.text)).toEqual(['line 0\n', 'line 1\n']);
    expect(state.seen).toBe(2);
    expect(state.dropped).toBe(0);
  });

  it('keeps the view bounded and counts the evicted head', () => {
    let state: SerialTranscriptState = emptySerialTranscript();
    for (let i = 0; i < 10; i++) {
      const end = i * 300;
      state = accumulateSerial(state, windowOf(Math.max(0, end - 300), end), end, 500);
    }
    expect(state.lines.length).toBeLessThanOrEqual(500);
    expect(state.seen).toBe(2700);
    expect(state.dropped).toBe(2700 - state.lines.length);
    // The retained tail is the newest output, in order.
    expect(state.lines.at(-1)?.text).toBe('line 2699\n');
    expect(state.lines[0]?.text).toBe(`line ${2700 - state.lines.length}\n`);
  });

  it('uses the panel cap by default', () => {
    let state = emptySerialTranscript();
    const burst = windowOf(0, SERIAL_VIEW_CAP + 400);
    state = accumulateSerial(state, burst, burst.length);
    expect(state.lines).toHaveLength(SERIAL_VIEW_CAP);
    expect(state.dropped).toBe(400);
  });
});
