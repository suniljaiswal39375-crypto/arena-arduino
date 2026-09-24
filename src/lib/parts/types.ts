import type { FidelityTier } from '@/lib/brand';
import type { PinElectrical } from '@/lib/doc/types';

export const PART_CATEGORIES = [
  'Microcontroller',
  'IoT',
  'Sensor',
  'Actuator',
  'Display',
  'Driver',
  'Motor',
  'Passive',
  'Custom',
] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];

export type PinSide = 'left' | 'right' | 'top' | 'bottom';

export interface PinDef {
  name: string;
  electrical: PinElectrical;
  side: PinSide;
}

/** Which runtime adapter drives this part inside the simulation. */
export type AdapterKind =
  | 'board'
  | 'led'
  | 'rgb-led'
  | 'servo'
  | 'stepper'
  | 'motor'
  | 'relay'
  | 'buzzer'
  | 'lcd'
  | 'oled'
  | 'sensor-value'
  | 'button'
  | 'potentiometer'
  | 'matrix'
  | 'seven-seg'
  | 'power'
  | 'chip'
  | 'static';

export interface ControlDef {
  id: string;
  label: string;
  kind: 'slider' | 'toggle' | 'button';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  default?: number;
}

export interface PartDocs {
  wiring: string[];
  exampleSketch?: string;
  datasheetUrl?: string;
  commonMistakes?: string[];
}

export interface PartDef {
  id: string;
  name: string;
  category: PartCategory;
  description: string;
  tags: string[];
  aliases: string[];
  pins: PinDef[];
  controls: ControlDef[];
  fidelity: {
    engine: 'functional' | 'firmware' | 'any';
    tier: FidelityTier;
    notes: string;
  };
  adapter: AdapterKind;
  models: string[];
  docs: PartDocs;
  /** Wokwi part type this maps to, for lossless export. */
  wokwi?: string;
  /** Default attributes applied when the part is dropped on the canvas. */
  defaults?: Record<string, string | number | boolean>;
  /**
   * Pins that are electrically the same node inside the part, e.g. the two
   * legs of a resistor. Wires alone cannot express this.
   */
  bonds?: string[][];
  /** Nominal supply voltage, used by the electrical rule check. */
  supply?: number;
  /** Typical current draw in mA, used for the power budget check. */
  current?: number;
}

/** Parse a compact pin spec: "VCC:power GND:ground OUT:digital:r" */
export function parsePins(spec: string): PinDef[] {
  const pins = spec
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok, i) => {
      const bits = tok.split(':');
      const name = bits[0] ?? `P${i}`;
      const electrical = (bits[1] ?? 'digital') as PinElectrical;
      const sides: Record<string, PinSide> = { l: 'left', r: 'right', t: 'top', b: 'bottom', left: 'left', right: 'right', top: 'top', bottom: 'bottom' };
      const side = sides[bits[2] ?? ''] ?? (i % 2 === 0 ? 'left' : 'right');
      return { name, electrical, side };
    });
  return pins;
}

export function pinNames(def: PartDef): string[] {
  return def.pins.map((p) => p.name);
}

export function findPin(def: PartDef, name: string): PinDef | undefined {
  return def.pins.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

export function isPowerPin(p: PinDef): boolean {
  return p.electrical === 'power';
}
export function isGroundPin(p: PinDef): boolean {
  return p.electrical === 'ground';
}

/** Colour used to draw a pin head on the canvas. */
export const PIN_COLOR: Record<PinElectrical, string> = {
  power: '#e63946',
  ground: '#12171d',
  digital: '#00b4d8',
  analog: '#a7c957',
  pwm: '#8b7cf6',
  i2c: '#ffb703',
  spi: '#ff8fab',
  uart: '#2ec4b6',
  onewire: '#f77f00',
};

export const ELECTRICAL_LABEL: Record<PinElectrical, string> = {
  power: 'power',
  ground: 'ground',
  digital: 'digital I/O',
  analog: 'analog in',
  pwm: 'PWM / digital',
  i2c: 'I2C',
  spi: 'SPI',
  uart: 'UART',
  onewire: '1-Wire',
};
