import { describe, expect, it } from 'vitest';
import { LogicCapture, LOGIC_CHANNELS, MAX_LOGIC_EDGES, toVcd, type LogicLevel } from './logic-analyzer';

const levels = (first: LogicLevel): LogicLevel[] => [first, ...Array<LogicLevel>(7).fill('x')];
const sources = LOGIC_CHANNELS.map((channel) => channel);

function capture(): LogicCapture {
  return new LogicCapture('la-1', 'wiring-1', 'Probe <script>', true, sources, 0, levels('x'));
}

describe('eight-channel bounded virtual edge capture', () => {
  it('records both sub-frame edges with nanosecond timestamps, without invented samples', () => {
    const c = capture();
    c.observe(0, levels('0'));
    c.observe(63, levels('1'));
    c.observe(126, levels('0'));
    c.observe(100_000_000, levels('0'));
    const snap = c.snapshot(100_000_000);
    expect(snap.edges).toEqual([
      { timeNs: 0, channel: 0, value: '0' },
      { timeNs: 63, channel: 0, value: '1' },
      { timeNs: 126, channel: 0, value: '0' },
    ]);
    expect(snap.channels[1]?.level).toBe('x');
    expect(snap.endNs).toBe(100_000_000);
    const vcd = toVcd(snap);
    expect(vcd).toContain('$timescale 1ns $end');
    expect(vcd).toContain('$var wire 1 ! D0 $end');
    expect(vcd).toContain('$dumpvars\nx!\n');
    expect(vcd).toContain('#63\n1!\n#126\n0!\n#100000000\n');
    expect(vcd).not.toContain('<script>'); // untrusted part labels never enter VCD syntax
  });

  it('records a whole port update atomically at one virtual time', () => {
    const c = capture();
    c.observe(50, ['1', '0', ...Array<LogicLevel>(6).fill('x')]);
    const snap = c.snapshot(50);
    expect(snap.edges).toEqual([
      { timeNs: 50, channel: 0, value: '1' },
      { timeNs: 50, channel: 1, value: '0' },
    ]);
    expect(toVcd(snap)).toContain('#50\n1!\n0"\n');
  });

  it('retains the correct initial level when old edges are evicted, and reports dropped count', () => {
    const c = new LogicCapture('la-1', 'w', 'Bounded', true, sources, 0, levels('0'));
    for (let time = 1; time <= MAX_LOGIC_EDGES + 7; time++) {
      c.observe(time, levels(time % 2 ? '1' : '0'));
    }
    const snap = c.snapshot(MAX_LOGIC_EDGES + 7);
    expect(snap.edges).toHaveLength(MAX_LOGIC_EDGES);
    expect(snap.dropped).toBe(7);
    expect(snap.startNs).toBe(7);
    expect(snap.initial[0]).toBe('1'); // last discarded edge at t=7
    expect(snap.edges[0]).toEqual({ timeNs: 8, channel: 0, value: '0' });
    expect(toVcd(snap)).toContain('$dumpvars\n1!');
    expect(toVcd(snap)).toContain('#1\n0!');
    expect(toVcd(snap)).not.toContain('#-');
  });
});
