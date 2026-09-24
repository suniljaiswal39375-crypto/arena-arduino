import type { FidelityTier } from '@/lib/brand';

export const SCHEMA_VERSION = 1;

export type Engine = 'auto' | 'functional' | 'firmware';

export type PinElectrical =
  | 'power'
  | 'ground'
  | 'digital'
  | 'analog'
  | 'pwm'
  | 'i2c'
  | 'spi'
  | 'uart'
  | 'onewire';

export interface PinRef {
  part: string;
  pin: string;
}

export type AttrValue = string | number | boolean;

export interface PartInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  rotate: 0 | 90 | 180 | 270;
  attrs: Record<string, AttrValue>;
  label?: string;
}

export const WIRE_COLORS = [
  'green',
  'red',
  'black',
  'yellow',
  'blue',
  'white',
  'orange',
  'purple',
  'gray',
  'brown',
  'cyan',
  'magenta',
  'lime',
  'pink',
  'teal',
  'violet',
] as const;
export type WireColor = (typeof WIRE_COLORS)[number];

export const WIRE_COLOR_HEX: Record<WireColor, string> = {
  green: '#2a9d8f',
  red: '#e63946',
  black: '#12171d',
  yellow: '#ffb703',
  blue: '#3a86ff',
  white: '#e6edf3',
  orange: '#f77f00',
  purple: '#8338ec',
  gray: '#8d99ae',
  brown: '#7f5539',
  cyan: '#00b4d8',
  magenta: '#d81e5b',
  lime: '#a7c957',
  pink: '#ff8fab',
  teal: '#2ec4b6',
  violet: '#8b7cf6',
};

/** Keyboard shortcuts for wire colour, 0-9 then C L M P Y (Wokwi-compatible). */
export const WIRE_COLOR_KEYS: Record<string, WireColor> = {
  '0': 'black',
  '1': 'brown',
  '2': 'red',
  '3': 'orange',
  '4': 'yellow',
  '5': 'green',
  '6': 'blue',
  '7': 'violet',
  '8': 'gray',
  '9': 'white',
  c: 'cyan',
  l: 'lime',
  m: 'magenta',
  p: 'purple',
  y: 'pink',
};

export interface Wire {
  id: string;
  from: PinRef;
  to: PinRef;
  color: WireColor;
  /** Optional manual routing waypoints, in canvas coordinates. */
  via?: Array<{ x: number; y: number }>;
}

export interface Diagram {
  version: 1;
  parts: PartInstance[];
  connections: Wire[];
}

export interface SimPrefs {
  prefsVersion: 2;
  inputs: Record<string, number>;
  speed: number;
}

export interface Provenance {
  confirmedSteps?: string[];
  mission?: string;
  step?: number;
  forkedFrom?: string;
  author?: string;
}

export interface FidelityMap {
  exact: string[];
  model: string[];
  visual: string[];
  export: string[];
}

/**
 * The canonical project document. Serialised form is `project.json`.
 * Wokwi diagrams use a different schema; use the interop translator.
 */
export interface ProjectDoc {
  schema: string;
  version: number;
  id: string;
  name: string;
  engine: Engine;
  board: string;
  diagram: Diagram;
  files: Record<string, string>;
  sim: SimPrefs;
  provenance: Provenance;
  fidelity: FidelityMap;
  updatedAt: number;
}

export const DEFAULT_FILES: Record<string, string> = {
  'sketch.ino': `void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`,
  'libraries.txt': '',
};

export function refKey(ref: PinRef): string {
  return `${ref.part}:${ref.pin}`;
}

export function partById(doc: ProjectDoc, id: string): PartInstance | undefined {
  return doc.diagram.parts.find((p) => p.id === id);
}

export function wireById(doc: ProjectDoc, id: string): Wire | undefined {
  return doc.diagram.connections.find((w) => w.id === id);
}

export function pinsOf(w: Wire): [string, string] {
  return [refKey(w.from), refKey(w.to)];
}

export function engineLabel(e: Engine): string {
  return e === 'auto' ? 'Auto' : e === 'functional' ? 'Functional' : 'Firmware';
}

export function tierOfFidelity(doc: ProjectDoc, partId: string): FidelityTier | null {
  if (doc.fidelity.exact.includes(partId)) return 'exact';
  if (doc.fidelity.model.includes(partId)) return 'model';
  if (doc.fidelity.visual.includes(partId)) return 'visual';
  if (doc.fidelity.export.includes(partId)) return 'export';
  return null;
}
