import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromWokwiDiagram, fromWokwiPin, librariesTxt, toWokwiDiagram, toWokwiPin, type WokwiDiagram } from './wokwi';
import { crc32, createZip, readZip } from './zip';
import { importWokwiZip, wokwiZip } from './bundle';
import { CHIPS, chipById, chipJson } from '@/lib/chips/chips';
import { makeWire } from '@/lib/doc/factory';
import { bomCsv, bomRows, kicadNetlist } from './exports';
import { templateDoc, templates } from '@/lib/templates';
import { MISSIONS } from '@/lib/missions/missions';
import { referenceDoc } from '@/lib/missions/reference';
import { SHOWCASE, showcaseDoc } from '@/lib/showcase';
import type { ProjectDoc } from '@/lib/doc/types';
import { runERC } from '@/lib/erc/diagnostics';
import { parseScenario } from '@/lib/scenarios/parse';
import { runScenario } from '@/lib/scenarios/runner';

/** The electrical content of a project: what connects to what, ignoring ids of wires. */
function topology(doc: ProjectDoc): string[] {
  return doc.diagram.connections
    .map((w) => [`${w.from.part}:${w.from.pin}`, `${w.to.part}:${w.to.pin}`].sort().join(' - '))
    .sort();
}

const allProjects = (): Array<[string, ProjectDoc]> => [
  ...templates().map((t): [string, ProjectDoc] => [`template:${t.slug}`, templateDoc(t.slug)!]),
  ...MISSIONS.map((m): [string, ProjectDoc] => [`mission:${m.slug}`, referenceDoc(m)]),
  ...SHOWCASE.map((p): [string, ProjectDoc] => [`showcase:${p.slug}`, showcaseDoc(p)]),
];

describe('Wokwi diagram.json', () => {
  it('uses Wokwi pin names: board pins are bare numbers, the LED cathode is C', () => {
    const { diagram } = toWokwiDiagram(templateDoc('uno-blink')!);
    const flat = diagram.connections.flatMap((c) => [c[0], c[1]]);
    expect(flat).toContain('uno:13');
    expect(flat).toContain('led1:C');
    expect(flat).toContain('uno:GND.1');
    expect(diagram.parts.find((p) => p.id === 'uno')?.type).toBe('wokwi-arduino-uno');
    expect(diagram.parts.find((p) => p.id === 'r1')?.attrs.value).toBe('220');
  });

  it('maps pins symmetrically', () => {
    for (const [type, pin] of [
      ['led', 'K'],
      ['servo-sg90', 'SIG'],
      ['servo-sg90', 'VCC'],
      ['relay-1ch', 'DC+'],
      ['potentiometer-10k', 'OUT'],
      ['dht22', 'DATA'],
      ['buzzer-active', '+'],
      ['arduino-uno', 'D7'],
      ['arduino-uno', 'GND'],
      ['arduino-uno', 'A0'],
      ['arduino-uno', '3V3'],
    ] as const) {
      expect(fromWokwiPin(type, toWokwiPin(type, pin)), `${type}.${pin}`).toBe(pin);
    }
  });

  it('round-trips every seed project Wokwi can fully represent without losing a wire', () => {
    let checked = 0;
    for (const [name, doc] of allProjects()) {
      const { diagram, skipped } = toWokwiDiagram(doc);
      if (skipped.length > 0) continue; // parts Wokwi has no model for are reported, not faked
      checked++;
      const back = fromWokwiDiagram(diagram, doc.files['sketch.ino']);
      expect(back.unknownParts, name).toEqual([]);
      expect(back.droppedConnections, name).toBe(0);
      expect(topology(back.doc), name).toEqual(topology(doc));
    }
    // The docs quote this number; if coverage changes, update them too.
    expect(checked).toBe(28);
    expect(allProjects()).toHaveLength(41);
  });

  it('keeps behaviour across the round trip, not just topology', () => {
    const seed = SHOWCASE.find((p) => p.slug === 'distance-parking-alert')!;
    const doc = showcaseDoc(seed);
    const back = fromWokwiDiagram(toWokwiDiagram(doc).diagram, doc.files['sketch.ino']).doc;
    back.sim.inputs = { ...doc.sim.inputs };
    const result = runScenario(back, parseScenario(seed.probe));
    expect(result.passed, result.failure?.message).toBe(true);
    expect(runERC(back).filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('restores the exact part type when Wokwi shares one type between two parts', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.parts.push({ id: 'rgb', type: 'led-rgb-module', x: 0, y: 0, rotate: 0, attrs: {} });
    doc.diagram.parts.push({ id: 'dht', type: 'dht11', x: 0, y: 0, rotate: 0, attrs: {} });
    const back = fromWokwiDiagram(toWokwiDiagram(doc).diagram).doc;
    expect(back.diagram.parts.find((p) => p.id === 'rgb')?.type).toBe('led-rgb-module');
    expect(back.diagram.parts.find((p) => p.id === 'dht')?.type).toBe('dht11');
  });

  it('reports parts Wokwi cannot simulate instead of silently dropping them', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.parts.push({ id: 'soil', type: 'soil-moisture', x: 0, y: 0, rotate: 0, attrs: {} });
    const { skipped, diagram } = toWokwiDiagram(doc);
    expect(skipped.map((s) => s.id)).toEqual(['soil']);
    expect(diagram.parts.some((p) => p.id === 'soil')).toBe(false);
  });

  it('imports a diagram written by Wokwi itself', () => {
    // Shape and pin names exactly as Wokwi writes them, including 1.l / 2.r button legs.
    const wokwi: WokwiDiagram = {
      version: 1,
      author: 'Uri Shaked',
      editor: 'wokwi',
      parts: [
        { type: 'wokwi-arduino-uno', id: 'uno', top: 0, left: 0, attrs: {} as Record<string, string> },
        { type: 'wokwi-pushbutton', id: 'btn1', top: -60, left: 120, attrs: { color: 'green' } },
        { type: 'wokwi-led', id: 'led1', top: -80, left: 220, attrs: { color: 'red' } },
        { type: 'wokwi-resistor', id: 'r1', top: 20, left: 220, rotate: 90, attrs: { value: '330' } },
        { type: 'wokwi-ntc-temperature-sensor', id: 'ntc1', top: 0, left: 400, attrs: {} },
      ],
      connections: [
        ['btn1:1.l', 'uno:2', 'green', ['v0']],
        ['btn1:2.r', 'uno:GND.1', 'black', []],
        ['uno:13', 'r1:1', 'green', []],
        ['r1:2', 'led1:A', 'green', []],
        ['led1:C', 'uno:GND.2', 'black', []],
        ['ntc1:OUT', 'uno:A0', 'green', []],
      ],
      dependencies: {},
    };
    const { doc, unknownParts, droppedConnections } = fromWokwiDiagram(wokwi, 'void setup() {}\nvoid loop() {}');
    expect(unknownParts).toEqual([{ id: 'ntc1', type: 'wokwi-ntc-temperature-sensor' }]);
    expect(droppedConnections).toBe(1);
    expect(topology(doc)).toContain('btn1:1 - uno:D2');
    expect(topology(doc)).toContain('led1:K - uno:GND2');
    expect(doc.diagram.parts.find((p) => p.id === 'r1')?.attrs.resistance).toBe(330);
    expect(doc.diagram.parts.find((p) => p.id === 'r1')?.rotate).toBe(90);
  });

  it('derives libraries.txt from the includes', () => {
    const libs = librariesTxt('#include <Servo.h>\n#include <DHT.h>\n#include "LiquidCrystal_I2C.h"\n');
    expect(libs.split('\n').filter(Boolean)).toEqual([
      'Adafruit Unified Sensor',
      'DHT sensor library',
      'LiquidCrystal I2C',
      'Servo',
    ]);
    expect(librariesTxt('void setup() {}')).toBe('');
  });
});

describe('project zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips files through its own reader', () => {
    const zip = createZip([
      { name: 'a.txt', content: 'hello' },
      { name: 'dir/b.json', content: '{"x":1}' },
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.json']);
    expect(new TextDecoder().decode(entries[1]!.data!)).toBe('{"x":1}');
  });

  it('is deterministic: the same project zips to the same bytes', () => {
    const a = wokwiZip(templateDoc('dht-lcd')!).bytes;
    const b = wokwiZip(templateDoc('dht-lcd')!).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('writes a zip the system unzip tool accepts, with the three Wokwi files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sparklab-zip-'));
    const path = join(dir, 'project.zip');
    writeFileSync(path, wokwiZip(templateDoc('dht-lcd')!).bytes);
    let listing = '';
    try {
      execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
      listing = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' });
    } catch (err) {
      // No unzip binary on this machine: the in-process reader test above still covers the format.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    expect(listing.trim().split('\n')).toEqual(['diagram.json', 'sketch.ino', 'libraries.txt']);
    execFileSync('unzip', ['-o', '-q', path, '-d', dir]);
    const diagram = JSON.parse(readFileSync(join(dir, 'diagram.json'), 'utf8')) as { editor: string };
    expect(diagram.editor).toBe('wokwi');
    expect(readFileSync(join(dir, 'libraries.txt'), 'utf8')).toContain('LiquidCrystal I2C');
  });

  it('imports its own zip losslessly', () => {
    const doc = templateDoc('ultrasonic-radar')!;
    const { doc: back } = importWokwiZip(wokwiZip(doc).bytes);
    expect(topology(back)).toEqual(topology(doc));
    expect(back.files['sketch.ino']).toBe(doc.files['sketch.ino']);
  });

  it('explains what is wrong with a zip that is not a Wokwi project', () => {
    const zip = createZip([{ name: 'notes.txt', content: 'hello' }]);
    expect(() => importWokwiZip(zip)).toThrow(/no diagram.json/);
    expect(() => importWokwiZip(new Uint8Array([1, 2, 3]))).toThrow(/Not a ZIP/);
  });
});

describe('shipped logic chips export as Wokwi custom chips', () => {
  it('exports every shipped chip as chip-<slug> and never skips it', () => {
    for (const chip of CHIPS) {
      const doc = templateDoc('uno-blink')!;
      doc.diagram.parts.push({ id: 'c1', type: chip.id, x: 0, y: 0, rotate: 0, attrs: {} });
      const { diagram, skipped } = toWokwiDiagram(doc);
      expect(diagram.parts.find((p) => p.id === 'c1')?.type, chip.id).toBe(`chip-${chip.id.slice('chip-'.length)}`);
      expect(skipped.find((s) => s.id === 'c1'), chip.id).toBeUndefined();
    }
  });

  it('keeps chip wiring intact across the round trip', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.parts.push({ id: 'gate', type: 'chip-not-gate', x: 10, y: 20, rotate: 0, attrs: {} });
    doc.diagram.connections.push(
      makeWire({ part: 'uno', pin: 'D7' }, { part: 'gate', pin: 'IN' }, 'green'),
      makeWire({ part: 'gate', pin: 'OUT' }, { part: 'led1', pin: 'A' }, 'red'),
    );
    const back = fromWokwiDiagram(toWokwiDiagram(doc).diagram).doc;
    expect(back.diagram.parts.find((p) => p.id === 'gate')?.type).toBe('chip-not-gate');
    expect(topology(back)).toEqual(topology(doc));
    expect(back.diagram.parts.find((p) => p.id === 'gate')?.rotate).toBe(0);
  });

  it('attaches chip.json and Wokwi Chips API C source once per chip type in the zip', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.parts.push({ id: 'g1', type: 'chip-not-gate', x: 0, y: 0, rotate: 0, attrs: {} });
    doc.diagram.parts.push({ id: 'g2', type: 'chip-not-gate', x: 40, y: 0, rotate: 0, attrs: {} });
    doc.diagram.parts.push({ id: 'cmp', type: 'chip-window-comparator', x: 80, y: 0, rotate: 0, attrs: {} });
    const entries = readZip(wokwiZip(doc).bytes);
    const names = entries.map((e) => e.name);
    expect(names.filter((n) => n === 'not-gate.chip.json')).toHaveLength(1); // deduped across instances
    expect(names).toContain('not-gate.c');
    expect(names).toContain('window-comparator.chip.json');
    expect(names).toContain('window-comparator.c');
    expect(names.some((n) => n.startsWith('pulse-generator'))).toBe(false); // not on the canvas
    const decoder = new TextDecoder();
    const chipJsonFile = JSON.parse(decoder.decode(entries.find((e) => e.name === 'not-gate.chip.json')!.data!));
    expect(chipJsonFile).toEqual(chipJson(chipById('chip-not-gate')!));
    const source = decoder.decode(entries.find((e) => e.name === 'not-gate.c')!.data!);
    expect(source).toBe(chipById('chip-not-gate')!.source);
    expect(source).toContain('wokwi-api.h');
  });

  it('still reports genuinely unmappable parts honestly, side by side with exported chips', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.parts.push({ id: 'soil', type: 'soil-moisture', x: 0, y: 0, rotate: 0, attrs: {} });
    doc.diagram.parts.push({ id: 'gate', type: 'chip-not-gate', x: 0, y: 40, rotate: 0, attrs: {} });
    const { skipped, diagram } = toWokwiDiagram(doc);
    expect(skipped.map((s) => s.id)).toEqual(['soil']);
    expect(diagram.parts.some((p) => p.id === 'gate')).toBe(true);
    expect(diagram.parts.some((p) => p.id === 'soil')).toBe(false);
    expect(wokwiZip(doc).skipped).toEqual(['Soil Moisture Sensor (soil)']);
  });
});

describe('BOM and KiCad exports', () => {
  it('counts parts by type in the BOM', () => {
    const doc = showcaseDoc(SHOWCASE.find((p) => p.slug === 'line-following-rover')!);
    const motors = bomRows(doc).find((r) => r.type === 'dc-motor-bo')!;
    expect(motors.quantity).toBe(2);
    expect(motors.refs).toEqual(['left', 'right']);
    const csv = bomCsv(doc);
    expect(csv.split('\n')[0]).toBe('Quantity,Part,Category,Type,References');
    expect(csv).toContain('2,DC Gear Motor 150 RPM BO,Motor,dc-motor-bo,left right');
  });

  it('quotes CSV cells that need it', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.parts.push({ id: 'oled', type: 'oled-128x64', x: 0, y: 0, rotate: 0, attrs: {} });
    expect(bomCsv(doc)).toContain('"OLED 0.96"" 128x64"');
  });

  it('writes a KiCad netlist with every multi-pin net and a named ground', () => {
    const net = kicadNetlist(templateDoc('uno-blink')!);
    expect(net.startsWith('(export (version "E")')).toBe(true);
    expect(net).toContain('(comp (ref "uno")');
    expect(net).toContain('(name "GND")');
    expect(net).toContain('(node (ref "led1") (pin "K"))');
    // Balanced parentheses: KiCad rejects anything else.
    let depth = 0;
    for (const ch of net.replace(/"(?:[^"\\]|\\.)*"/g, '')) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });
});
