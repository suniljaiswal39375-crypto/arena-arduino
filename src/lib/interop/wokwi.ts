import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { WIRE_COLORS, type PartInstance, type ProjectDoc, type WireColor } from '@/lib/doc/types';
import { getPart } from '@/lib/parts';
import { PRODUCT_NAME } from '@/lib/brand';

/**
 * Wokwi interchange: `diagram.json` export and import.
 *
 * SparkLab pin names are chosen for teaching ("K" for an LED's cathode, "D13"
 * for a board pin), Wokwi's for its own part library ("C", "13"). This module
 * owns the translation in both directions so a project moves between the two
 * without losing a wire. Every mapping below comes from the Wokwi part
 * reference (docs.wokwi.com/parts).
 */

export interface WokwiPart {
  type: string;
  id: string;
  top: number;
  left: number;
  rotate?: number;
  attrs: Record<string, string>;
}

/** [from, to, colour, routing]: Wokwi's connection tuple. */
export type WokwiConnection = [string, string, string, string[]];

export interface WokwiDiagram {
  version: 1;
  author: string;
  editor: string;
  parts: WokwiPart[];
  connections: WokwiConnection[];
  dependencies: Record<string, string>;
}

interface PartMapping {
  /** Wokwi part type. */
  type: string;
  /** SparkLab pin -> Wokwi pin, where they differ. */
  pins?: Record<string, string>;
  /** Attributes Wokwi needs to reproduce this part. */
  attrs?: (inst: PartInstance) => Record<string, string>;
}

const BOARD_PIN = (pin: string): string => {
  const d = /^D(\d+)$/.exec(pin);
  if (d?.[1]) return d[1];
  if (pin === 'GND') return 'GND.1';
  if (pin === 'GND2') return 'GND.2';
  if (pin === '3V3') return '3.3V';
  return pin;
};

/** Parts whose SparkLab and Wokwi pin names differ, or whose type needs attrs. */
const MAPPINGS: Record<string, PartMapping> = {
  led: {
    type: 'wokwi-led',
    pins: { K: 'C' },
    attrs: (i) => ({ color: colourName(String(i.attrs.colour ?? '#e63946')) }),
  },
  resistor: { type: 'wokwi-resistor', attrs: (i) => ({ value: String(i.attrs.resistance ?? 220) }) },
  pushbutton: { type: 'wokwi-pushbutton', pins: { '1': '1.l', '2': '2.l' }, attrs: () => ({ color: 'green' }) },
  'servo-sg90': { type: 'wokwi-servo', pins: { VCC: 'V+', SIG: 'PWM' } },
  'servo-mg90s': { type: 'wokwi-servo', pins: { VCC: 'V+', SIG: 'PWM' } },
  'servo-mg995': { type: 'wokwi-servo', pins: { VCC: 'V+', SIG: 'PWM' } },
  'relay-1ch': {
    type: 'wokwi-relay-module',
    pins: { 'DC+': 'VCC', 'DC-': 'GND' },
    // SparkLab relays default to active LOW; Wokwi's "pnp" transistor is active HIGH.
    attrs: (i): Record<string, string> => ((i.attrs.activeLow ?? true) ? {} : { transistor: 'pnp' }),
  },
  'potentiometer-10k': { type: 'wokwi-potentiometer', pins: { OUT: 'SIG' } },
  'hc-sr04': { type: 'wokwi-hc-sr04' },
  dht22: { type: 'wokwi-dht22', pins: { DATA: 'SDA' } },
  dht11: { type: 'wokwi-dht22', pins: { DATA: 'SDA' } },
  'buzzer-active': { type: 'wokwi-buzzer', pins: { '+': '2', '-': '1' } },
  'buzzer-passive': { type: 'wokwi-buzzer', pins: { '+': '2', '-': '1' } },
  'lcd-16x2-i2c': { type: 'wokwi-lcd1602', attrs: () => ({ pins: 'i2c' }) },
  'oled-128x64': { type: 'board-ssd1306' },
  'pir-motion': { type: 'wokwi-pir-motion-sensor' },
  'ldr-module': { type: 'wokwi-photoresistor-sensor' },
  'led-rgb': { type: 'wokwi-rgb-led', pins: { K: 'COM' }, attrs: () => ({ common: 'cathode' }) },
  'led-rgb-module': { type: 'wokwi-rgb-led', pins: { GND: 'COM' }, attrs: () => ({ common: 'cathode' }) },
  'seven-segment': { type: 'wokwi-7segment', attrs: () => ({ common: 'cathode' }) },
  'arduino-uno': { type: 'wokwi-arduino-uno' },
  'arduino-nano': { type: 'wokwi-arduino-nano' },
  'arduino-mega': { type: 'wokwi-arduino-mega' },
  'emu-uno': { type: 'wokwi-arduino-uno' },
  'emu-nano': { type: 'wokwi-arduino-nano' },
  'emu-mega': { type: 'wokwi-arduino-mega' },
};

const NAMED_COLOURS: Record<string, string> = {
  '#e63946': 'red',
  '#2a9d8f': 'green',
  '#3a86ff': 'blue',
  '#ffb703': 'yellow',
  '#ffd166': 'yellow',
  '#ffffff': 'white',
  '#f77f00': 'orange',
  '#2ec4b6': 'cyan',
};

function colourName(hex: string): string {
  return NAMED_COLOURS[hex.toLowerCase()] ?? hex;
}

function isBoard(type: string): boolean {
  return getPart(type)?.adapter === 'board';
}

/** SparkLab pin name as Wokwi calls it. */
export function toWokwiPin(type: string, pin: string): string {
  if (isBoard(type)) return BOARD_PIN(pin);
  return MAPPINGS[type]?.pins?.[pin] ?? pin;
}

/** Wokwi pin name back to SparkLab's, for one SparkLab part type. */
export function fromWokwiPin(type: string, pin: string): string {
  if (isBoard(type)) {
    if (/^\d+$/.test(pin)) return `D${pin}`;
    if (pin === 'GND.1' || pin === 'GND.3') return 'GND';
    if (pin === 'GND.2') return 'GND2';
    if (pin === '3.3V') return '3V3';
    return pin;
  }
  // Pushbutton contacts: both legs of contact 1 are the same node.
  if (type === 'pushbutton' && /^[12]\.[lr]$/.test(pin)) return pin[0]!;
  const back = Object.entries(MAPPINGS[type]?.pins ?? {}).find(([, w]) => w === pin);
  return back ? back[0] : pin;
}

/** The Wokwi part type for a SparkLab part, or null when Wokwi has no equivalent. */
export function wokwiTypeFor(type: string): string | null {
  // Authored chips export as Wokwi custom chips: type `chip-<name>` plus the
  // `<name>.chip.json` and `<name>.c` files wokwiZip attaches.
  if (type.startsWith('user-chip-')) return `chip-${type.slice('user-chip-'.length)}`;
  return MAPPINGS[type]?.type ?? getPart(type)?.wokwi ?? null;
}

export interface WokwiExport {
  diagram: WokwiDiagram;
  /** Parts with no Wokwi equivalent, which are left out of diagram.json. */
  skipped: Array<{ id: string; type: string; name: string }>;
}

/** Export a project's diagram as a Wokwi diagram.json. */
export function toWokwiDiagram(doc: ProjectDoc): WokwiExport {
  const skipped: WokwiExport['skipped'] = [];
  const exported = new Map<string, string>();
  const parts: WokwiPart[] = [];

  for (const inst of doc.diagram.parts) {
    const wtype = wokwiTypeFor(inst.type);
    if (!wtype) {
      skipped.push({ id: inst.id, type: inst.type, name: getPart(inst.type)?.name ?? inst.type });
      continue;
    }
    exported.set(inst.id, inst.type);
    const attrs = MAPPINGS[inst.type]?.attrs?.(inst) ?? {};
    // Several SparkLab parts share one Wokwi type (a bare RGB LED and the RGB
    // module, a DHT11 and a DHT22). Wokwi ignores unknown attributes, so the
    // exact SparkLab type rides along and a round trip restores it.
    if (FROM_WOKWI.get(wtype) !== inst.type) attrs[SPARKLAB_TYPE_ATTR] = inst.type;
    const part: WokwiPart = {
      type: wtype,
      id: inst.id,
      top: Math.round(inst.y),
      left: Math.round(inst.x),
      attrs,
    };
    if (inst.rotate) part.rotate = inst.rotate;
    parts.push(part);
  }

  const connections: WokwiConnection[] = [];
  for (const w of doc.diagram.connections) {
    const fromType = exported.get(w.from.part);
    const toType = exported.get(w.to.part);
    if (!fromType || !toType) continue;
    connections.push([
      `${w.from.part}:${toWokwiPin(fromType, w.from.pin)}`,
      `${w.to.part}:${toWokwiPin(toType, w.to.pin)}`,
      w.color,
      [],
    ]);
  }

  return {
    diagram: { version: 1, author: PRODUCT_NAME, editor: 'wokwi', parts, connections, dependencies: {} },
    skipped,
  };
}

/** Attribute carrying the exact SparkLab part type through Wokwi. */
const SPARKLAB_TYPE_ATTR = 'sparklabType';

/** Wokwi type -> the SparkLab part it imports as. First mapping wins. */
const FROM_WOKWI: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [type, mapping] of Object.entries(MAPPINGS)) {
    if (!type.startsWith('emu-') && !m.has(mapping.type)) m.set(mapping.type, type);
  }
  return m;
})();

export interface WokwiImport {
  doc: ProjectDoc;
  /** Wokwi parts with no SparkLab equivalent. */
  unknownParts: Array<{ id: string; type: string }>;
  /** Connections dropped because an end was on an unknown part. */
  droppedConnections: number;
}

function wireColour(raw: string): WireColor {
  return (WIRE_COLORS as readonly string[]).includes(raw) ? (raw as WireColor) : 'green';
}

/** Import a Wokwi diagram.json (plus an optional sketch) as a SparkLab project. */
export function fromWokwiDiagram(diagram: WokwiDiagram, sketch?: string, name = 'Imported from Wokwi'): WokwiImport {
  const doc = createProject({ name });
  doc.diagram.parts = [];
  doc.diagram.connections = [];
  const unknownParts: WokwiImport['unknownParts'] = [];
  const typeOf = new Map<string, string>();

  for (const p of diagram.parts ?? []) {
    const hinted = p.attrs?.[SPARKLAB_TYPE_ATTR];
    const type = hinted && getPart(hinted) && wokwiTypeFor(hinted) === p.type ? hinted : FROM_WOKWI.get(p.type);
    if (!type) {
      unknownParts.push({ id: p.id, type: p.type });
      continue;
    }
    const def = getPart(type);
    const inst = makePart(type, Number(p.left ?? 0), Number(p.top ?? 0), {
      attrs: { ...(def?.defaults ?? {}) } as never,
    });
    inst.id = p.id;
    if (p.rotate === 90 || p.rotate === 180 || p.rotate === 270) inst.rotate = p.rotate;
    if (type === 'resistor' && p.attrs?.value) inst.attrs.resistance = Number(p.attrs.value) || 220;
    if (type === 'relay-1ch' && p.attrs?.transistor === 'pnp') inst.attrs.activeLow = false;
    doc.diagram.parts.push(inst);
    typeOf.set(p.id, type);
    if (def?.adapter === 'board') doc.board = type;
  }

  let droppedConnections = 0;
  for (const c of diagram.connections ?? []) {
    const [from, to, colour] = c;
    const [fp, fpin] = splitEnd(from);
    const [tp, tpin] = splitEnd(to);
    const ft = typeOf.get(fp);
    const tt = typeOf.get(tp);
    if (!ft || !tt) {
      droppedConnections++;
      continue;
    }
    doc.diagram.connections.push(
      makeWire({ part: fp, pin: fromWokwiPin(ft, fpin) }, { part: tp, pin: fromWokwiPin(tt, tpin) }, wireColour(colour)),
    );
  }

  if (sketch !== undefined) doc.files['sketch.ino'] = sketch;
  return { doc, unknownParts, droppedConnections };
}

function splitEnd(end: string): [string, string] {
  const i = end.indexOf(':');
  return i < 0 ? [end, ''] : [end.slice(0, i), end.slice(i + 1)];
}

/**
 * Library names the sketch needs, one per line, for Wokwi's libraries.txt.
 * Derived from #include lines so it never goes stale.
 */
export function librariesTxt(sketch: string): string {
  const known: Record<string, string> = {
    'Servo.h': 'Servo',
    'DHT.h': 'DHT sensor library',
    'LiquidCrystal_I2C.h': 'LiquidCrystal I2C',
    'Adafruit_SSD1306.h': 'Adafruit SSD1306',
    'Adafruit_GFX.h': 'Adafruit GFX Library',
    'Stepper.h': 'Stepper',
  };
  const libs = new Set<string>();
  for (const m of sketch.matchAll(/#include\s*[<"]([^>"]+)[>"]/g)) {
    const lib = known[m[1] ?? ''];
    if (lib) libs.add(lib);
  }
  if (libs.has('Adafruit SSD1306')) libs.add('Adafruit GFX Library');
  if (libs.has('DHT sensor library')) libs.add('Adafruit Unified Sensor');
  return [...libs].sort().join('\n') + (libs.size ? '\n' : '');
}
