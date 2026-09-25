import type { ControlDef } from '@/lib/parts/types';
import type { ChipDef, ChipLogic } from './chips';

/**
 * The chip authoring flow (ROADMAP Phase 13): guided composition of a new
 * custom chip from the three behaviour families the simulator genuinely
 * models — decide (inverter), compare (window comparator) and keep time
 * (pulse generator). The student names the chip and its pins, sets the
 * parameters, and gets a real part definition (which the functional runtime
 * evaluates), a Wokwi `chip.json` and a reference C implementation — the
 * same three artifacts the shipped chips carry. Free-form C authoring is
 * deliberately out of scope: there is no C compiler in the browser, and a
 * chip we cannot simulate would be a broken promise.
 */

export type ChipKind = 'not' | 'window' | 'pulse';

export interface ChipSpec {
  kind: ChipKind;
  name: string;
  author: string;
  description: string;
  /** Signal pin names (VCC/GND are fixed). Defaults: IN and OUT. */
  inPin: string;
  outPin: string;
  /** Window comparator thresholds (0–1023 ADC counts). */
  low: number;
  high: number;
  /** Pulse generator rate and duty. */
  bpm: number;
  dutyPercent: number;
}

export const DEFAULT_SPEC: ChipSpec = {
  kind: 'not',
  name: '',
  author: '',
  description: '',
  inPin: 'IN',
  outPin: 'OUT',
  low: 300,
  high: 700,
  bpm: 72,
  dutyPercent: 10,
};

/** UI metadata: one line per family, EN (the dialog translates via keys). */
export const CHIP_KIND_INFO: Record<ChipKind, { example: string; pins: string }> = {
  not: { example: 'A gate that says the opposite of its input — one slice of a 74HC04.', pins: 'IN, OUT' },
  window: { example: 'HIGH only while an analog input sits between two thresholds — battery guards, greenhouse bands.', pins: 'IN (analog), OUT' },
  pulse: { example: 'One short pulse per beat at an adjustable rate — practise interrupts and counting.', pins: 'OUT' },
};

export interface ChipComposeError {
  field: string;
  message: string;
}

export type ComposeResult = { ok: true; chip: ChipDef } | { ok: false; errors: ChipComposeError[] };

const PIN_RE = /^[A-Z][A-Z0-9]{0,7}$/;

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'chip';
}

/** A fresh unique id for a chip called `name`, avoiding every taken id. */
export function chipIdFor(name: string, taken: ReadonlySet<string>): string {
  const base = `user-chip-${slug(name)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function checkPin(pin: string, field: string, other: string | null, errors: ChipComposeError[]): void {
  if (!PIN_RE.test(pin)) {
    errors.push({
      field,
      message: 'Use 1–8 characters: capital letters and digits, starting with a letter (e.g. IN, OUT, ECHO).',
    });
  }
  if (pin === 'VCC' || pin === 'GND') {
    errors.push({ field, message: 'VCC and GND are already on every chip — pick another name.' });
  }
  if (other !== null && pin === other) {
    errors.push({ field, message: `Input and output pins must differ.` });
  }
}

/** Validate a spec and build the chip. Pure; never throws. */
export function composeChip(raw: ChipSpec, takenIds: ReadonlySet<string>): ComposeResult {
  const errors: ChipComposeError[] = [];
  const name = raw.name.trim();
  const author = (raw.author.trim() || 'You').slice(0, 40);
  const description = raw.description.trim();
  const inPin = raw.inPin.trim().toUpperCase();
  const outPin = raw.outPin.trim().toUpperCase();

  if (name.length < 2 || name.length > 40) {
    errors.push({ field: 'name', message: 'Give the chip a name of 2–40 characters.' });
  } else if (/\bchip\b/i.test(name) && name.length < 8) {
    // Not an error by itself, but keep names from shadowing catalogue ids.
    errors.push({ field: 'name', message: 'Name it after what it does (e.g. "Night Light Trigger"), not just "chip".' });
  }
  if (description.length < 10 || description.length > 300) {
    errors.push({ field: 'description', message: 'Describe what the chip is for in 10–300 characters.' });
  }
  if (raw.kind !== 'pulse') checkPin(inPin, 'inPin', null, errors);
  checkPin(outPin, 'outPin', raw.kind === 'pulse' ? null : inPin, errors);

  const low = Math.round(raw.low);
  const high = Math.round(raw.high);
  const bpm = Math.round(raw.bpm);
  const duty = Math.round(raw.dutyPercent);
  if (raw.kind === 'window') {
    if (!Number.isFinite(low) || low < 0 || low > 1023) errors.push({ field: 'low', message: 'The lower threshold must be 0–1023.' });
    if (!Number.isFinite(high) || high < 0 || high > 1023) errors.push({ field: 'high', message: 'The upper threshold must be 0–1023.' });
    if (low === high) errors.push({ field: 'high', message: 'The two thresholds must differ, or the window is empty.' });
  }
  if (raw.kind === 'pulse') {
    if (!Number.isFinite(bpm) || bpm < 1 || bpm > 300) errors.push({ field: 'bpm', message: 'The rate must be 1–300 beats per minute.' });
    if (!Number.isFinite(duty) || duty < 1 || duty > 99) errors.push({ field: 'dutyPercent', message: 'The pulse width must be 1–99 % of the beat.' });
  }
  if (errors.length > 0) return { ok: false, errors };

  const id = chipIdFor(name, takenIds);
  const usesInput = raw.kind !== 'pulse';
  const pins = usesInput
    ? `${inPin}:${raw.kind === 'window' ? 'analog' : 'digital'}:l GND:ground:l ${outPin}:digital:r VCC:power:r`
    : `GND:ground:l ${outPin}:digital:r VCC:power:r`;

  let controls: ControlDef[] = [];
  let logic: ChipLogic;
  switch (raw.kind) {
    case 'not':
      logic = { kind: 'not', input: inPin, output: outPin };
      break;
    case 'window':
      controls = [
        { id: 'thrLow', label: 'Lower threshold', kind: 'slider', min: 0, max: 1023, step: 1, unit: '', default: low },
        { id: 'thrHigh', label: 'Upper threshold', kind: 'slider', min: 0, max: 1023, step: 1, unit: '', default: high },
      ];
      logic = { kind: 'window', input: inPin, output: outPin, low: 'thrLow', high: 'thrHigh' };
      break;
    case 'pulse':
      controls = [{ id: 'pulseBpm', label: 'Rate', kind: 'slider', min: 1, max: 300, step: 1, unit: ' bpm', default: bpm }];
      logic = { kind: 'pulse', output: outPin, rate: 'pulseBpm', dutyPercent: duty };
      break;
  }

  const wiring = [
    'VCC to 5V and GND to GND',
    ...(usesInput
      ? [`${inPin} from the signal you want the chip to watch (a board output or a sensor line)`]
      : []),
    `${outPin} to a board input (D2 is interrupt-capable)`,
  ];

  return {
    ok: true,
    chip: {
      id,
      name,
      author,
      description,
      pins,
      controls,
      logic,
      teaches: raw.kind === 'pulse' ? ['ct.interrupts', 'ct.nonblocking-timing'] : raw.kind === 'window' ? ['pc.analog-conditioning', 'ct.conditional'] : ['ct.conditional', 'pc.signal-pin'],
      wiring,
      exampleSketch: exampleSketchFor(raw.kind, inPin, outPin),
      source: sourceFor(raw.kind, inPin, outPin, low, high, bpm, duty),
    },
  };
}

/** The shipped wiring-demo sketches, adapted to the authored pin names. */
export function exampleSketchFor(kind: ChipKind, inPin: string, outPin: string): string {
  switch (kind) {
    case 'not':
      return `// Drive the ${inPin} pin and read back ${outPin}.
const int toChip = 7;
const int fromChip = 2;

void setup() {
  pinMode(toChip, OUTPUT);
  pinMode(fromChip, INPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(toChip, HIGH);
  Serial.print("in=1 out=");
  Serial.println(digitalRead(fromChip));
  delay(500);
  digitalWrite(toChip, LOW);
  Serial.print("in=0 out=");
  Serial.println(digitalRead(fromChip));
  delay(500);
}
`;
    case 'window':
      return `// The comparator does the thresholding in hardware; the sketch just listens.
const int fromChip = 2;

void setup() {
  pinMode(fromChip, INPUT);
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(fromChip) == HIGH) {
    Serial.println("inside the window");
  } else {
    Serial.println("outside the window");
  }
  delay(300);
}
`;
    case 'pulse':
      return `// Count pulses from ${outPin} with an interrupt and report the rate.
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
`;
  }
}

/** Reference C for the Wokwi Chips API, mirroring the shipped implementations. */
export function sourceFor(kind: ChipKind, inPin: string, outPin: string, low: number, high: number, bpm: number, duty: number): string {
  const header = `// ${kind === 'not' ? 'Inverter' : kind === 'window' ? 'Window comparator' : 'Pulse generator'} for the Wokwi Chips API.\n#include "wokwi-api.h"\n#include <stdlib.h>\n`;
  switch (kind) {
    case 'not':
      return `${header}
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
  chip->in = pin_init("${inPin}", INPUT);
  chip->out = pin_init("${outPin}", OUTPUT);
  const pin_watch_config_t watch = {
    .edge = BOTH,
    .pin_change = on_input_change,
    .user_data = chip,
  };
  pin_watch(chip->in, &watch);
  pin_write(chip->out, pin_read(chip->in) == HIGH ? LOW : HIGH);
}
`;
    case 'window':
      return `${header}
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
  chip->in = pin_init("${inPin}", ANALOG);
  chip->out = pin_init("${outPin}", OUTPUT_LOW);
  chip->low_attr = attr_init_float("thrLow", ${low.toFixed(1)}f);
  chip->high_attr = attr_init_float("thrHigh", ${high.toFixed(1)}f);
  const timer_config_t config = { .callback = on_timer, .user_data = chip };
  timer_t timer = timer_init(&config);
  timer_start(timer, 1000, true); // re-evaluate every millisecond
}
`;
    case 'pulse':
      return `${header}
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
  uint32_t high_ms = period_ms / ${Math.round(100 / duty)};
  chip->elapsed_ms = (chip->elapsed_ms + 1) % period_ms;
  pin_write(chip->out, chip->elapsed_ms < high_ms ? HIGH : LOW);
}

void chip_init(void) {
  chip_state_t *chip = malloc(sizeof(chip_state_t));
  chip->out = pin_init("${outPin}", OUTPUT_LOW);
  chip->bpm_attr = attr_init("pulseBpm", ${bpm});
  chip->elapsed_ms = 0;
  const timer_config_t config = { .callback = on_timer, .user_data = chip };
  timer_t timer = timer_init(&config);
  timer_start(timer, 1000, true); // 1 ms tick
}
`;
  }
}
