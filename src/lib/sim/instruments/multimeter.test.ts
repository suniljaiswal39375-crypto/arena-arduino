import { describe, expect, it } from 'vitest';
import { templateDoc } from '@/lib/templates';
import { makePart, makeWire } from '@/lib/doc/factory';
import { buildNetlist } from '@/lib/erc/netlist';
import {
  findPathResistance,
  solveMultimeter,
  type MultimeterMode,
} from './multimeter';
import type { Circuit } from '../runtime';

describe('Multimeter impedance & resistance solver', () => {
  it('returns 0 for the same node or directly wired nodes', () => {
    const doc = templateDoc('uno-blink')!;
    expect(findPathResistance(doc, 'uno:D13', 'uno:D13')).toBe(0);
    // uno:D13 is wired to r1:1
    expect(findPathResistance(doc, 'uno:D13', 'r1:1')).toBe(0);
  });

  it('measures resistance across a 220-ohm resistor', () => {
    const doc = templateDoc('uno-blink')!;
    // r1:1 to r1:2 is across the resistor
    expect(findPathResistance(doc, 'r1:1', 'r1:2')).toBe(220);
  });

  it('measures series resistance across two connected resistors', () => {
    const doc = templateDoc('uno-blink')!;
    const r2 = makePart('resistor', 300, 200, { attrs: { resistance: 330 } });
    doc.diagram.parts.push(r2);
    // Wire r1:2 to r2:1
    doc.diagram.connections.push(makeWire({ part: 'r1', pin: '2' }, { part: r2.id, pin: '1' }));

    // From r1:1 to r2:2 should be 220 + 330 = 550 ohms
    expect(findPathResistance(doc, 'r1:1', `${r2.id}:2`)).toBe(550);
  });

  it('returns Infinity for disconnected nodes', () => {
    const doc = templateDoc('uno-blink')!;
    const lonePart = makePart('resistor', 600, 600, { attrs: { resistance: 1000 } });
    doc.diagram.parts.push(lonePart);

    expect(findPathResistance(doc, 'uno:5V', `${lonePart.id}:1`)).toBe(Infinity);
  });
});

describe('solveMultimeter modes', () => {
  const doc = templateDoc('uno-blink')!;
  const nl = buildNetlist(doc);

  it('measures passive resistance and formats units correctly', () => {
    const reading = solveMultimeter(doc, nl, null, 'resistance', 'r1:1', 'r1:2');
    expect(reading.valid).toBe(true);
    expect(reading.status).toBe('ok');
    expect(reading.displayText).toBe('220.0 Ω');
    expect(reading.value).toBe(220);

    const openReading = solveMultimeter(doc, nl, null, 'resistance', 'uno:5V', 'uno:A0');
    expect(openReading.displayText).toBe('O.L');
    expect(openReading.status).toBe('open');
  });

  it('tests continuity with beep and short/open status', () => {
    // Directly wired nodes
    const short = solveMultimeter(doc, nl, null, 'continuity', 'uno:D13', 'r1:1');
    expect(short.valid).toBe(true);
    expect(short.beep).toBe(true);
    expect(short.displayText).toContain('SHORT');

    // Disconnected nodes
    const open = solveMultimeter(doc, nl, null, 'continuity', 'uno:5V', 'uno:A5');
    expect(open.valid).toBe(true);
    expect(open.beep).toBe(false);
    expect(open.displayText).toContain('OPEN');
  });

  it('tests diode / LED forward and reverse bias', () => {
    // In uno-blink: led1:A is anode, led1:K is cathode
    const fwd = solveMultimeter(doc, nl, null, 'diode', 'led1:A', 'led1:K');
    expect(fwd.valid).toBe(true);
    expect(fwd.status).toBe('ok');
    expect(fwd.displayText).toBe('2.000 V');

    // Reverse bias
    const rev = solveMultimeter(doc, nl, null, 'diode', 'led1:K', 'led1:A');
    expect(rev.displayText).toBe('O.L');
    expect(rev.status).toBe('open');
  });

  it('measures DC voltage when simulation provides node voltages', () => {
    const mockCircuit = {
      nodeVoltage: (node: string) => {
        if (node === 'uno:5V') return { kind: 'voltage', volts: 5.0, source: 'rail' };
        if (node === 'uno:GND') return { kind: 'voltage', volts: 0.0, source: 'ground' };
        return { kind: 'unmeasured', reason: 'floating' };
      },
    } as unknown as Circuit;

    const vReading = solveMultimeter(doc, nl, mockCircuit, 'dc-v', 'uno:5V', 'uno:GND');
    expect(vReading.valid).toBe(true);
    expect(vReading.value).toBe(5.0);
    expect(vReading.displayText).toBe('+5.000 V');

    // Floating node
    const floatingReading = solveMultimeter(doc, nl, mockCircuit, 'dc-v', 'uno:A3', 'uno:GND');
    expect(floatingReading.valid).toBe(false);
    expect(floatingReading.status).toBe('floating');
    expect(floatingReading.displayText).toBe('--- V');
  });

  it('measures DC branch current using Ohm law', () => {
    const mockCircuit = {
      nodeVoltage: (node: string) => {
        if (node === 'r1:1') return { kind: 'voltage', volts: 5.0, source: 'driven' };
        if (node === 'r1:2') return { kind: 'voltage', volts: 2.0, source: 'driven' };
        return { kind: 'unmeasured', reason: 'floating' };
      },
    } as unknown as Circuit;

    // 3.0 V difference across 220 Ω: I = 3.0 / 220 = 13.64 mA
    const iReading = solveMultimeter(doc, nl, mockCircuit, 'dc-i', 'r1:1', 'r1:2');
    expect(iReading.valid).toBe(true);
    expect(iReading.value).toBeCloseTo(13.64, 1);
    expect(iReading.displayText).toBe('13.64 mA');
  });
});
