import type { ControlDef, PartDef } from '@/lib/parts/types';
import { parsePins } from '@/lib/parts/types';

/**
 * Custom chips: small parts whose behaviour is data, not a new simulator
 * adapter. Each chip ships three things:
 *
 *  - a SparkLab part definition, so it sits in the palette and the ERC like any
 *    other part;
 *  - declarative logic the functional runtime evaluates when a sketch reads the
 *    chip's output (honestly badged MODEL - the logic is right, the analogue
 *    timing is not);
 *  - a Wokwi-compatible `chip.json` plus a reference C implementation against
 *    the Wokwi Chips API, so the same chip can be compiled for the firmware
 *    emulator.
 */

/** What a chip can observe about its own pins while the simulation runs. */
export interface ChipIO {
  /** Digital level (0 or 1) on the net connected to one of the chip's pins. */
  digital(pin: string): number;
  /** Analog level (0-1023) on the net connected to one of the chip's pins. */
  analog(pin: string): number;
  /** Current value of one of the chip's virtual controls. */
  control(id: string): number;
  /** Virtual time in microseconds. */
  nowUs(): number;
}

export type ChipLogic =
  | { kind: 'not'; input: string; output: string }
  | { kind: 'window'; input: string; output: string; low: string; high: string }
  | { kind: 'pulse'; output: string; rate: string; dutyPercent: number };

export interface ChipDef {
  id: string;
  name: string;
  author: string;
  description: string;
  /** Compact pin spec, same syntax as the part catalogue. */
  pins: string;
  controls: ControlDef[];
  logic: ChipLogic;
  /** Skill ids this chip is designed to exercise. */
  teaches: string[];
  wiring: string[];
  exampleSketch: string;
  /** Reference implementation against the Wokwi Chips API. */
  source: string;
}

export const CHIPS: ChipDef[] = [
  {
    id: 'chip-not-gate',
    name: 'NOT Gate',
    author: 'SparkLab',
    description:
      'A single logic inverter, like one gate of a 74HC04. OUT is always the opposite of IN. The smallest possible example of a chip that makes a decision.',
    pins: 'IN:digital:l GND:ground:l OUT:digital:r VCC:power:r',
    controls: [],
    logic: { kind: 'not', input: 'IN', output: 'OUT' },
    teaches: ['ct.conditional', 'pc.signal-pin'],
    wiring: ['VCC to 5V and GND to GND', 'IN from a board output (D7)', 'OUT to a board input (D2)'],
    exampleSketch: `// Drive the gate's input and read back its output.
const int toGate = 7;
const int fromGate = 2;

void setup() {
  pinMode(toGate, OUTPUT);
  pinMode(fromGate, INPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(toGate, HIGH);
  Serial.print("in=1 out=");
  Serial.println(digitalRead(fromGate));
  delay(500);
  digitalWrite(toGate, LOW);
  Serial.print("in=0 out=");
  Serial.println(digitalRead(fromGate));
  delay(500);
}
`,
    source: `// NOT gate for the Wokwi Chips API.
#include "wokwi-api.h"
#include <stdlib.h>

typedef struct {
  pin_t in;
  pin_t out;
} chip_state_t;

static void on_input_change(void *user_data, pin_t pin, uint32_t value) {
  chip_state_t *chip = (chip_state_t *)user_data;
  (void)pin;
  pin_write(chip->out, value == HIGH ? LOW : HIGH);
}

void chip_init(void) {
  chip_state_t *chip = malloc(sizeof(chip_state_t));
  chip->in = pin_init("IN", INPUT);
  chip->out = pin_init("OUT", OUTPUT);
  const pin_watch_config_t watch = {
    .edge = BOTH,
    .pin_change = on_input_change,
    .user_data = chip,
  };
  pin_watch(chip->in, &watch);
  pin_write(chip->out, pin_read(chip->in) == HIGH ? LOW : HIGH);
}
`,
  },
  {
    id: 'chip-window-comparator',
    name: 'Window Comparator',
    author: 'SparkLab',
    description:
      'Turns an analog voltage into a yes/no answer: OUT is HIGH only while IN sits between the LOW and HIGH thresholds. Real window comparators guard battery chargers and greenhouse sensors.',
    pins: 'IN:analog:l GND:ground:l OUT:digital:r VCC:power:r',
    controls: [
      { id: 'windowLow', label: 'Lower threshold', kind: 'slider', min: 0, max: 1023, step: 1, unit: '', default: 300 },
      { id: 'windowHigh', label: 'Upper threshold', kind: 'slider', min: 0, max: 1023, step: 1, unit: '', default: 700 },
    ],
    logic: { kind: 'window', input: 'IN', output: 'OUT', low: 'windowLow', high: 'windowHigh' },
    teaches: ['pc.analog-conditioning', 'ct.conditional'],
    wiring: [
      'VCC to 5V and GND to GND',
      'IN to the wiper of a potentiometer (or any analog sensor output)',
      'OUT to a board input (D2)',
    ],
    exampleSketch: `// The comparator does the thresholding in hardware; the sketch just listens.
const int inWindow = 2;

void setup() {
  pinMode(inWindow, INPUT);
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(inWindow) == HIGH) {
    Serial.println("inside the window");
  } else {
    Serial.println("outside the window");
  }
  delay(300);
}
`,
    source: `// Window comparator for the Wokwi Chips API.
#include "wokwi-api.h"
#include <stdlib.h>

typedef struct {
  pin_t in;
  pin_t out;
  uint32_t low_attr;
  uint32_t high_attr;
} chip_state_t;

static void on_timer(void *user_data) {
  chip_state_t *chip = (chip_state_t *)user_data;
  // pin_adc_read returns volts against a 5 V reference.
  float level = pin_adc_read(chip->in) * 1023.0f / 5.0f;
  float low = attr_read_float(chip->low_attr);
  float high = attr_read_float(chip->high_attr);
  pin_write(chip->out, (level >= low && level <= high) ? HIGH : LOW);
}

void chip_init(void) {
  chip_state_t *chip = malloc(sizeof(chip_state_t));
  chip->in = pin_init("IN", ANALOG);
  chip->out = pin_init("OUT", OUTPUT_LOW);
  chip->low_attr = attr_init_float("windowLow", 300.0f);
  chip->high_attr = attr_init_float("windowHigh", 700.0f);
  const timer_config_t config = { .callback = on_timer, .user_data = chip };
  timer_t timer = timer_init(&config);
  timer_start(timer, 1000, true); // re-evaluate every millisecond
}
`,
  },
  {
    id: 'chip-pulse-generator',
    name: 'Heartbeat Pulse Generator',
    author: 'SparkLab',
    description:
      'Produces one short pulse per heartbeat at an adjustable rate, like the output of a pulse sensor after signal conditioning. Perfect for practising counting with interrupts.',
    pins: 'GND:ground:l OUT:digital:r VCC:power:r',
    controls: [
      { id: 'pulseBpm', label: 'Heart rate', kind: 'slider', min: 30, max: 200, step: 1, unit: ' bpm', default: 72 },
    ],
    logic: { kind: 'pulse', output: 'OUT', rate: 'pulseBpm', dutyPercent: 10 },
    teaches: ['ct.interrupts', 'ct.nonblocking-timing'],
    wiring: ['VCC to 5V and GND to GND', 'OUT to D2 (an interrupt-capable pin)'],
    exampleSketch: `// Count heartbeats with an interrupt and report beats per minute.
volatile int beats = 0;
unsigned long windowStart = 0;

void onBeat() {
  beats = beats + 1;
}

void setup() {
  pinMode(2, INPUT);
  attachInterrupt(digitalPinToInterrupt(2), onBeat, RISING);
  Serial.begin(9600);
  windowStart = millis();
}

void loop() {
  if (millis() - windowStart >= 10000) {
    Serial.print("bpm: ");
    Serial.println(beats * 6);
    beats = 0;
    windowStart = millis();
  }
}
`,
    source: `// Heartbeat pulse generator for the Wokwi Chips API.
#include "wokwi-api.h"
#include <stdlib.h>

typedef struct {
  pin_t out;
  uint32_t bpm_attr;
  uint32_t elapsed_ms;
} chip_state_t;

static void on_timer(void *user_data) {
  chip_state_t *chip = (chip_state_t *)user_data;
  uint32_t bpm = attr_read(chip->bpm_attr);
  if (bpm < 1) bpm = 1;
  uint32_t period_ms = 60000 / bpm;
  uint32_t high_ms = period_ms / 10; // 10 % duty cycle
  chip->elapsed_ms = (chip->elapsed_ms + 1) % period_ms;
  pin_write(chip->out, chip->elapsed_ms < high_ms ? HIGH : LOW);
}

void chip_init(void) {
  chip_state_t *chip = malloc(sizeof(chip_state_t));
  chip->out = pin_init("OUT", OUTPUT_LOW);
  chip->bpm_attr = attr_init("pulseBpm", 72);
  chip->elapsed_ms = 0;
  const timer_config_t config = { .callback = on_timer, .user_data = chip };
  timer_t timer = timer_init(&config);
  timer_start(timer, 1000, true); // 1 ms tick
}
`,
  },
];

const CHIP_BY_ID = new Map(CHIPS.map((c) => [c.id, c]));

/** Student-authored chips (see compose.ts + registry.ts). */
const USER_CHIPS = new Map<string, ChipDef>();

export function chipById(id: string): ChipDef | undefined {
  return CHIP_BY_ID.get(id) ?? USER_CHIPS.get(id);
}

/** Store an authored chip definition. Returns false when the id is taken. */
export function addUserChip(def: ChipDef): boolean {
  if (CHIP_BY_ID.has(def.id) || USER_CHIPS.has(def.id)) return false;
  USER_CHIPS.set(def.id, def);
  return true;
}

/**
 * Drop a chip from the definition registry. Parts already placed on a canvas
 * keep working (their catalogue entry stays registered); only authoring and
 * re-export disappear.
 */
export function unregisterUserChip(id: string): void {
  USER_CHIPS.delete(id);
}

/** The student-authored chips registered this session. */
export function userChips(): ChipDef[] {
  return [...USER_CHIPS.values()];
}

/**
 * Evaluate a chip output pin. Returns the level the chip drives on `pin`, or
 * null when `pin` is not one of its outputs (so the caller keeps looking).
 */
export function evaluateChip(chip: ChipDef, pin: string, io: ChipIO): number | null {
  const logic = chip.logic;
  if (logic.output !== pin) return null;
  switch (logic.kind) {
    case 'not':
      return io.digital(logic.input) ? 0 : 1;
    case 'window': {
      const level = io.analog(logic.input);
      const low = io.control(logic.low);
      const high = io.control(logic.high);
      return level >= Math.min(low, high) && level <= Math.max(low, high) ? 1 : 0;
    }
    case 'pulse': {
      const bpm = Math.max(1, io.control(logic.rate));
      const periodUs = 60_000_000 / bpm;
      const phase = io.nowUs() % periodUs;
      return phase < (periodUs * logic.dutyPercent) / 100 ? 1 : 0;
    }
  }
}

/** The chip as a catalogue part. */
export function chipPart(chip: ChipDef): PartDef {
  return {
    id: chip.id,
    name: chip.name,
    category: 'Custom',
    description: chip.description,
    tags: ['custom-chip', 'logic', ...chip.teaches],
    aliases: [chip.name.toLowerCase()],
    pins: parsePins(chip.pins),
    controls: chip.controls,
    fidelity: {
      engine: 'functional',
      tier: 'model',
      notes:
        'Custom chip. The functional runtime evaluates its logic whenever the sketch reads its output, so the decision is right but propagation delay and analogue edges are not modelled. Export the chip.json and C source to run it on the firmware emulator.',
    },
    adapter: 'chip',
    models: [],
    docs: {
      wiring: chip.wiring,
      exampleSketch: chip.exampleSketch,
      commonMistakes: [
        'Leaving VCC or GND unconnected: a real chip with no supply does nothing.',
        'Reading OUT with analogRead: the output is digital, so use digitalRead.',
      ],
    },
    defaults: Object.fromEntries(chip.controls.map((c) => [c.id, c.default ?? 0])),
    supply: 5,
    current: 1,
  };
}

export const CHIP_PARTS: PartDef[] = CHIPS.map(chipPart);

/** Wokwi `<name>.chip.json`. Pins follow the chip's pin order. */
export function chipJson(chip: ChipDef): {
  name: string;
  author: string;
  pins: string[];
  controls: Array<{ id: string; label: string; type: 'range'; min: number; max: number; step: number }>;
} {
  return {
    name: chip.name,
    author: chip.author,
    pins: parsePins(chip.pins).map((p) => p.name),
    controls: chip.controls.map((c) => ({
      id: c.id,
      label: c.label,
      type: 'range' as const,
      min: c.min ?? 0,
      max: c.max ?? 1023,
      step: c.step ?? 1,
    })),
  };
}
