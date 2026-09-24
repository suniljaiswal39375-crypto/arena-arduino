import { describe, expect, it } from 'vitest';
import { makePart, makeWire } from '@/lib/doc/factory';
import { SimEngine } from '../engine';
import { FirmwareEngine } from '../firmware/engine';
import { BLINK_SKETCH, blinkFixture } from '../firmware/fixtures/blink';
import { assembleProgram } from '../firmware/program-image';
import { toVcd } from './logic-analyzer';

function instrumentedBlink(ground = true) {
  const { doc, unoId, hex } = blinkFixture();
  const probe = makePart('emu-logic-analyzer', 430, 190);
  doc.diagram.parts.push(probe);
  doc.diagram.connections.push(
    makeWire({ part: unoId, pin: 'D13' }, { part: probe.id, pin: 'D0' }),
    makeWire({ part: unoId, pin: 'D12' }, { part: probe.id, pin: 'D1' }),
  );
  if (ground) doc.diagram.connections.push(makeWire({ part: unoId, pin: 'GND' }, { part: probe.id, pin: 'GND' }));
  return { doc, probeId: probe.id, unoId, hex };
}

const edgeValues = (edges: Array<{ channel: number; value: string }>) =>
  edges.filter((edge) => edge.channel === 0).map((edge) => edge.value);

describe('logic analyzer on real project nets', () => {
  it('captures functional blink on writes, not at rendered frames, and resets on rewiring', () => {
    const { doc, unoId, probeId } = instrumentedBlink();
    const fe = new SimEngine(doc);
    fe.load(doc, BLINK_SKETCH);
    fe.start();
    for (let i = 0; i < 11; i++) fe.tick(100);
    const trace = fe.snapshot().logicAnalyzers[0]!;
    expect(trace.id).toBe(probeId);
    expect(trace.grounded).toBe(true);
    expect(trace.channels[1]?.level).toBe('x'); // wired to INPUT, not guessed LOW
    expect(edgeValues(trace.edges).slice(0, 4)).toEqual(['0', '1', '0', '1']);
    expect(trace.edges.filter((edge) => edge.channel === 0).map((edge) => edge.timeNs).slice(0, 4))
      .toEqual([0, 0, 500_000_000, 1_000_000_000]);
    expect(toVcd(trace)).toContain('#500000000\n0!');

    // Input state update does not erase a capture of the same wiring.
    doc.sim.inputs.someInput = 1;
    fe.setDoc(doc);
    expect(fe.snapshot().logicAnalyzers[0]?.edges.length).toBe(trace.edges.length);

    // Changing which pin D0 probes invalidates the old channel assignment.
    doc.diagram.connections = doc.diagram.connections.filter((wire) => wire.to.part !== probeId || wire.to.pin !== 'D0');
    doc.diagram.connections.push(makeWire({ part: unoId, pin: 'D11' }, { part: probeId, pin: 'D0' }));
    fe.setDoc(doc);
    const rewired = fe.snapshot().logicAnalyzers[0]!;
    expect(rewired.edges).toHaveLength(0);
    expect(rewired.initial[0]).toBe('x');
  });

  it('keeps every channel unknown without a grounded reference, even when GPIO is driven', () => {
    const { doc } = instrumentedBlink(false);
    const fe = new SimEngine(doc);
    fe.load(doc, BLINK_SKETCH);
    fe.start();
    fe.tick(100);
    const trace = fe.snapshot().logicAnalyzers[0]!;
    expect(trace.grounded).toBe(false);
    expect(trace.channels.every((ch) => ch.level === 'x')).toBe(true);
    expect(trace.edges).toHaveLength(0);
    expect(fe.snapshot().unsupported.join(' ')).toMatch(/connect GND/);
  });

  it('records a pulled-up input and the button edge on document update', () => {
    const { doc, unoId, probeId } = instrumentedBlink();
    const button = makePart('pushbutton', 430, 100);
    doc.diagram.parts.push(button);
    doc.diagram.connections.push(
      makeWire({ part: unoId, pin: 'D2' }, { part: button.id, pin: '1' }),
      makeWire({ part: unoId, pin: 'GND' }, { part: button.id, pin: '2' }),
    );
    doc.diagram.connections = doc.diagram.connections.filter((wire) => wire.to.part !== probeId || wire.to.pin !== 'D0');
    doc.diagram.connections.push(makeWire({ part: unoId, pin: 'D2' }, { part: probeId, pin: 'D0' }));
    const fe = new SimEngine(doc);
    fe.load(doc, 'void setup() { pinMode(2, INPUT_PULLUP); } void loop() { delay(100); }');
    fe.start();
    fe.tick(20);
    expect(edgeValues(fe.snapshot().logicAnalyzers[0]!.edges)).toContain('1');
    doc.sim.inputs.buttonPressed = 1;
    fe.setDoc(doc);
    expect(edgeValues(fe.snapshot().logicAnalyzers[0]!.edges).slice(-1)).toEqual(['0']);
  });

  it('bounds concurrent captures and names excess analyzers instead of silently simulating them', () => {
    const { doc } = instrumentedBlink();
    const second = makePart('emu-logic-analyzer', 570, 180);
    const third = makePart('emu-logic-analyzer', 680, 180);
    doc.diagram.parts.push(second, third);
    const fe = new SimEngine(doc);
    fe.load(doc, BLINK_SKETCH);
    fe.start();
    fe.tick(20);
    expect(fe.snapshot().logicAnalyzers).toHaveLength(2);
    expect(fe.snapshot().unsupported.join(' ')).toMatch(/at most two concurrent/);
    const thirdState = fe.snapshot().parts[third.id];
    expect(thirdState?.kind).toBe('logic-analyzer');
    if (thirdState?.kind === 'logic-analyzer') expect(thirdState.levels.every((level) => level === 'x')).toBe(true);
  });

  it('marks functional averaged PWM unknown, not a made-up digital duty waveform', () => {
    const { doc, unoId, probeId } = instrumentedBlink();
    doc.diagram.connections = doc.diagram.connections.filter((wire) => wire.to.part !== probeId || wire.to.pin !== 'D0');
    doc.diagram.connections.push(makeWire({ part: unoId, pin: 'D9' }, { part: probeId, pin: 'D0' }));
    const fe = new SimEngine(doc);
    fe.load(doc, 'void setup() { pinMode(9, OUTPUT); analogWrite(9, 128); } void loop() { delay(100); }');
    fe.start();
    fe.tick(10);
    expect(fe.snapshot().logicAnalyzers[0]?.channels[0]?.level).toBe('x');
    expect(fe.snapshot().unsupported.join(' ')).toMatch(/averaged PWM/);
  });
});

describe('AVR GPIO timing and functional parity', () => {
  it('records distinct instruction-cycle edges within one worker frame and exports them as VCD', () => {
    const { doc } = instrumentedBlink();
    const hex = assembleProgram([
      'rjmp reset', ...Array(14).fill('rjmp reset'), 'reset:',
      '  sbi 0x04, 5', // DDRB5 output, initially LOW
      '  sbi 0x05, 5', // PORTB5 HIGH
      '  cbi 0x05, 5', // PORTB5 LOW within the SAME frame
      'done:', '  rjmp done',
    ].join('\n'));
    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();
    const trace = fw.run(16).snapshot.logicAnalyzers[0]!;
    const edges = trace.edges.filter((e) => e.channel === 0);
    expect(edgeValues(edges)).toEqual(['0', '1', '0']);
    expect(edges[0]!.timeNs).toBeLessThan(edges[1]!.timeNs);
    expect(edges[1]!.timeNs).toBeLessThan(edges[2]!.timeNs);
    expect(edges[2]!.timeNs).toBeLessThan(10_000); // nanoseconds, not 16 ms frames
    expect(toVcd(trace)).toContain(`#${edges[1]!.timeNs}\n1!`);
    expect(trace.channels[1]?.level).toBe('x');
  });

  it('marks SPI-owned SCK unknown rather than presenting the GPIO latch as a waveform', () => {
    const { doc } = instrumentedBlink(); // D0 probes SCK (D13)
    const hex = assembleProgram([
      'rjmp reset', ...Array(14).fill('rjmp reset'), 'reset:',
      '  sbi 0x04, 5', // DDRB5 output
      '  sbi 0x05, 5', // GPIO latch HIGH
      '  ldi r16, 0x50', '  out 0x2c, r16', // SPCR: SPE/MSTR, SCK is now SPI-owned
      'done:', '  rjmp done',
    ].join('\n'));
    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();
    const snap = fw.run(16).snapshot;
    expect(edgeValues(snap.logicAnalyzers[0]!.edges)).toEqual(['0', '1', 'x']);
    expect(snap.logicAnalyzers[0]?.channels[0]?.level).toBe('x');
    expect(snap.unsupported.join(' ')).toMatch(/peripheral outputs are not sampled/);
  });

  it('compares the observed blink edge sequence and bridge-time tolerance across engines', () => {
    const { doc, hex } = instrumentedBlink();
    const fe = new SimEngine(doc);
    fe.load(doc, BLINK_SKETCH);
    fe.start();
    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();
    for (let i = 0; i < 12; i++) { fe.tick(100); fw.run(100); }
    const functional = fe.snapshot().logicAnalyzers[0]!.edges.filter((e) => e.channel === 0);
    const firmware = fw.snapshot().logicAnalyzers[0]!.edges.filter((e) => e.channel === 0);
    expect(edgeValues(firmware).slice(0, 3)).toEqual(edgeValues(functional).slice(0, 3));
    for (let i = 0; i < 3; i++) {
      // The clock-bridge's delay advances in whole milliseconds; instruction
      // overhead should differ by far less than one millisecond per edge.
      expect(Math.abs(firmware[i]!.timeNs - functional[i]!.timeNs)).toBeLessThan(1_000_000);
    }
  });
});
