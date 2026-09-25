import type { ProjectDoc, Wire } from '@/lib/doc/types';
import { makeWire } from '@/lib/doc/factory';
import { missionBySlug } from '@/lib/missions/missions';
import { referenceDoc } from '@/lib/missions/reference';
import { templateDoc } from '@/lib/templates';
import { runERC, type DiagnosticCode } from '@/lib/erc/diagnostics';
import { parseScenario } from '@/lib/scenarios/parse';
import { runScenario } from '@/lib/scenarios/runner';
import { SimEngine } from '@/lib/sim/engine';
import { EMPTY_SCHEDULE, type FaultSchedule } from '@/lib/sim/faults';

/**
 * Chaos Lab: a working project, broken on purpose, for the student to repair.
 *
 * Every challenge is a pure function of known-good data: take a reference
 * circuit, apply one seeded defect, and describe how to tell it is fixed. That
 * makes each challenge *provably solvable* - the test suite applies the answer
 * key and checks the fix passes, and checks the broken version fails - which
 * is the guarantee the spec asks for.
 */

export type ChaosDifficulty = 1 | 2 | 3;

/** One seeded defect, applied to a clean copy of the base project. */
export type ChaosFault =
  | { kind: 'remove-wire'; from: [string, string]; to: [string, string] }
  | { kind: 'move-wire-end'; from: [string, string]; to: [string, string]; end: 'from' | 'to'; newPin: string }
  | { kind: 'add-wire'; from: [string, string]; to: [string, string] }
  | { kind: 'replace-in-sketch'; find: string; replace: string }
  /** Swap the two wire ends on a two-pin part — a reversed LED or diode. */
  | { kind: 'swap-wire-ends'; partId: string; pinA: string; pinB: string }
  /** Take a two-legged part out and join what it was connected to, as a bare wire would. */
  | { kind: 'bypass-part'; partId: string };

/** How the lab decides the student has repaired the project. */
export interface ChaosCheck {
  /** ERC codes that must be absent once fixed. */
  noDiagnostics: DiagnosticCode[];
  /** Behaviour that must hold once fixed, as an automation scenario. */
  scenario?: string;
  /**
   * Behavioural fingerprint the repaired project must reproduce (generated
   * challenges). Computed from the clean base at generation time; a run whose
   * serial output and actuator states match the base is fixed.
   */
  fingerprint?: string;
  /**
   * Virtual-time run length for the fingerprint check. Mystery faults need a
   * run that outlives the fault's `afterMs`; structural ones use the default.
   */
  runMs?: number;
}

export interface ChaosChallenge {
  slug: string;
  title: string;
  difficulty: ChaosDifficulty;
  /** The story the student reads: the symptom, never the cause. */
  brief: string;
  /** `mission:<slug>` or `template:<slug>`. */
  base: string;
  /**
   * The structural defect baked into the broken document. Mystery-hardware
   * challenges have none — their broken document *is* the healthy base —
   * and carry a `mystery` schedule instead.
   */
  fault?: ChaosFault;
  /**
   * Mystery hardware (spec §12.5): the doc looks clean; the runtime
   * sabotages a part on this session-local schedule (sim/faults). The
   * schedule is applied by the functional engine only and is never stored
   * in a ProjectDoc.
   */
  mystery?: { schedule: FaultSchedule; runMs: number };
  /** Three hints, from a nudge to nearly the answer. */
  hints: [string, string, string];
  /** What was wrong and why, shown after the fix is confirmed. */
  answer: string;
  check: ChaosCheck;
  /** Skill evidence a solve earns. */
  skills: string[];
}

const sameEnd = (w: Wire, [part, pin]: [string, string], end: 'from' | 'to'): boolean =>
  w[end].part === part && w[end].pin === pin;

/** Find the wire joining two pins, in either direction. */
export function findWire(doc: ProjectDoc, a: [string, string], b: [string, string]): Wire | undefined {
  return doc.diagram.connections.find(
    (w) => (sameEnd(w, a, 'from') && sameEnd(w, b, 'to')) || (sameEnd(w, b, 'from') && sameEnd(w, a, 'to')),
  );
}

export const CHAOS_CHALLENGES: ChaosChallenge[] = [
  {
    slug: 'the-dark-streetlight',
    title: 'The streetlight that never comes on',
    difficulty: 1,
    brief:
      'The council installed the new smart streetlight. The sketch prints sensible light readings and the relay clicks at dusk, but the lamp stays dark all night. Residents are complaining.',
    base: 'mission:smart-streetlight',
    fault: { kind: 'remove-wire', from: ['led', 'K'], to: ['uno', 'GND'] },
    hints: [
      'The relay switches, so the decision is right. Follow the current, not the code.',
      'Trace the lamp circuit from 5V through the relay, the resistor and the LED. Where does the current go next?',
      'The LED cathode is not connected to anything. Current needs a way back to ground.',
    ],
    answer:
      'The LED cathode had no wire back to GND, so the lamp circuit was open. Current flows in a loop: out of the supply, through the load, and back. The relay was closing a switch in a circuit that was never complete.',
    check: {
      noDiagnostics: ['missing-return-path'],
      scenario: `name: lamp works at night
steps:
  - set-control: { part-id: ldr, control: ldrLux, value: 60 }
  - delay: 1s
  - expect-pin: { part-id: led, pin: A, expected: 1 }
`,
    },
    skills: ['pc.return-path', 'al.self-diagnosis'],
  },
  {
    slug: 'the-burnt-led',
    title: 'Blink, then smoke',
    difficulty: 1,
    brief:
      'A student rebuilt the classic blink circuit from memory. On their bench it blinked beautifully for a minute, then the LED went dark forever and smelled faintly of burnt plastic. Here is the circuit exactly as they built it.',
    base: 'template:uno-blink',
    fault: { kind: 'bypass-part', partId: 'r1' },
    hints: [
      'The code is fine. Something in the circuit let far too much current through.',
      'Look at what sits in series with the LED between D13 and the anode.',
      'A jumper wire has almost no resistance. The LED needs a resistor there to limit its current.',
    ],
    answer:
      'The 220 Ω resistor had been left out and D13 wired straight to the LED. An LED only drops about 2 V; with nothing to absorb the other 3 V, Ohm\'s law says the current is limited only by the wire, so it spikes far past 20 mA and the junction overheats. The simulator keeps the LED alive so you can see the circuit, and flags the fault instead.',
    check: {
      noDiagnostics: ['thermal-overload'],
      scenario: `name: still blinks
steps:
  - delay: 250ms
  - expect-pin: { part-id: led1, pin: A, expected: 1 }
`,
    },
    skills: ['pc.ohms-law', 'pc.thermal'],
  },
  {
    slug: 'the-ghost-button',
    title: 'The button that presses itself',
    difficulty: 2,
    brief:
      'The desk lamp switches on by itself the moment the board powers up, and pressing the button changes nothing. The button wiring looks perfect.',
    base: 'template:button-led',
    fault: { kind: 'replace-in-sketch', find: 'INPUT_PULLUP', replace: 'INPUT' },
    hints: [
      'The wiring is right. Ask what voltage the input pin sees while the button is not pressed.',
      'With the button open, is anything holding D2 HIGH or LOW? Or is it just floating?',
      'The pin needs a pull-up. Arduino has one built in: pinMode(buttonPin, INPUT_PULLUP).',
    ],
    answer:
      'The input was set to INPUT instead of INPUT_PULLUP. With the button open the pin connected to nothing, so its level was undefined. The simulator reads a floating pin as LOW, so the lamp was simply on; on a real bench the pin acts as an antenna and the lamp flickers with noise from the room. Either way the button could not be heard.',
    check: {
      noDiagnostics: ['missing-pull-up'],
      scenario: `name: only a real press lights the lamp
steps:
  - delay: 100ms
  - expect-pin: { part-id: led1, pin: A, expected: 0 }
  - set-control: { part-id: btn, control: pressed, value: 1 }
  - delay: 50ms
  - expect-pin: { part-id: led1, pin: A, expected: 1 }
`,
    },
    skills: ['pc.pull-resistor', 'al.self-diagnosis'],
  },
  {
    slug: 'the-silent-alarm',
    title: 'The burglar alarm that sleeps',
    difficulty: 2,
    brief:
      'The motion alarm passed its demo in the shop. At home, walking straight past it does nothing: no light, no buzzer, no message on the serial monitor. The PIR sensor is brand new.',
    base: 'mission:motion-alarm',
    fault: { kind: 'move-wire-end', from: ['pir', 'OUT'], to: ['uno', 'D7'], end: 'to', newPin: 'D6' },
    hints: [
      'The sensor is fine and the sketch is fine. Check that they are talking about the same pin.',
      'Which pin does the sketch read? Now follow the wire from the PIR OUT pin. Where does it land?',
      'The PIR output is wired to D6, but the sketch reads pin 7.',
    ],
    answer:
      'The PIR output went to D6 while the sketch read D7. The code was listening to an empty pin. Software and wiring are one system: a pin number in code is a promise about a wire.',
    check: {
      noDiagnostics: ['floating-net'],
      scenario: `name: motion is noticed
steps:
  - set-control: { part-id: pir, control: motionDetected, value: 1 }
  - wait-serial: { text: motion detected, timeout: 1s }
`,
    },
    skills: ['pc.signal-pin', 'ct.structure'],
  },
  {
    slug: 'the-backwards-light',
    title: 'The streetlight that works in reverse',
    difficulty: 2,
    brief:
      'The new streetlight is on all day and switches off the moment the sun sets. Everything is wired exactly as on the diagram.',
    base: 'mission:smart-streetlight',
    fault: { kind: 'replace-in-sketch', find: 'light < threshold', replace: 'light > threshold' },
    hints: [
      'The lamp does switch, just at the wrong times. So the hardware works.',
      'Low readings mean dark. What condition turns the lamp on?',
      'The comparison is backwards: it should switch on when light is below the threshold.',
    ],
    answer:
      'The sketch switched the lamp on when light > threshold, which is daylight. Flipping one character inverts the whole behaviour, which is why testing both sides of a threshold matters.',
    check: {
      noDiagnostics: [],
      scenario: `name: dark on, light off
steps:
  - set-control: { part-id: ldr, control: ldrLux, value: 60 }
  - delay: 1s
  - expect-pin: { part-id: led, pin: A, expected: 1 }
  - set-control: { part-id: ldr, control: ldrLux, value: 900 }
  - delay: 1s
  - expect-pin: { part-id: led, pin: A, expected: 0 }
`,
    },
    skills: ['ct.conditional', 'al.self-diagnosis'],
  },
  {
    slug: 'the-shorted-pin',
    title: 'The board that gets hot',
    difficulty: 2,
    brief:
      'Someone tidied the blink circuit and added "a spare wire for later". On the bench the Uno got warm to the touch and the USB port kept disconnecting. Here is their circuit.',
    base: 'template:uno-blink',
    fault: { kind: 'add-wire', from: ['uno', 'D13'], to: ['uno', '5V'] },
    hints: [
      'Heat means current is flowing somewhere it should not. Look for a path with no load in it.',
      'Is any board pin connected straight to a supply rail?',
      'D13 is wired directly to 5V. Whenever the sketch writes LOW, the pin shorts the rail to ground.',
    ],
    answer:
      'A bare wire joined D13 to 5V. When the sketch drove D13 LOW, the pin tried to pull the whole 5 V rail to ground through its tiny output transistor: a short circuit that heats the chip and can destroy the pin.',
    check: {
      noDiagnostics: ['short-circuit'],
      scenario: `name: blinks again
steps:
  - delay: 250ms
  - expect-pin: { part-id: led1, pin: A, expected: 1 }
  - delay: 500ms
  - expect-pin: { part-id: led1, pin: A, expected: 0 }
`,
    },
    skills: ['pc.short-circuit', 'pc.pin-conflict'],
  },
  {
    slug: 'the-frozen-thermostat',
    title: 'The thermostat that never lets go',
    difficulty: 3,
    brief:
      'The greenhouse heater came on during a cold night, as designed. It is now 32 °C inside, the plants are wilting, and the heater is still running.',
    base: 'mission:thermostat-hysteresis',
    fault: { kind: 'replace-in-sketch', find: 'else if (heating && t > heatOff) heating = false;', replace: '' },
    hints: [
      'It switches on correctly. Read the code for the moment it should switch off.',
      'Find every place heating becomes true. Now find where it becomes false again.',
      'Nothing ever sets heating back to false. The upper threshold is missing.',
    ],
    answer:
      'The line that turns heating off above the upper threshold had been deleted. The state variable latched on forever. Hysteresis needs two rules: one to switch on below the band, and one to switch off above it.',
    check: {
      noDiagnostics: [],
      scenario: `name: heats when cold, stops when hot
steps:
  - set-control: { part-id: dht, control: dhtTemperature, value: 20 }
  - delay: 1s
  - expect-pin: { part-id: relay, pin: IN, expected: 0 }
  - set-control: { part-id: dht, control: dhtTemperature, value: 30 }
  - delay: 1s
  - expect-pin: { part-id: relay, pin: IN, expected: 1 }
`,
    },
    skills: ['ct.hysteresis', 'ct.state'],
  },
  {
    slug: 'the-overfed-sensor',
    title: 'The weather station that died overnight',
    difficulty: 3,
    brief:
      'A BMP280 pressure sensor was added to the blink project to start a weather station. It read fine for an evening. By morning it returned nothing at all, and a replacement died the same way.',
    base: 'template:uno-blink',
    fault: { kind: 'move-wire-end', from: ['uno', '3V3'], to: ['bmp', 'VCC'], end: 'from', newPin: '5V' },
    hints: [
      'Two identical sensors failing the same way is a pattern, not bad luck. Read the sensor\'s rating.',
      'What supply voltage is the BMP280 designed for? What is it connected to?',
      'The BMP280 is a 3.3 V part on the 5 V rail. Move VCC to the 3V3 pin.',
    ],
    answer:
      'The BMP280 is a 3.3 V sensor and its VCC was on the 5 V rail. Over-voltage stresses the thin oxide layers inside the chip; it often works for a while and then fails permanently. The fix is the 3V3 pin, plus a level shifter on the data lines for a real build.',
    check: { noDiagnostics: ['level-mismatch'] },
    skills: ['pc.analog-conditioning', 'pc.power-budget'],
  },
  {
    slug: 'the-lying-sensor',
    title: 'The streetlight with a mind of its own',
    difficulty: 3,
    brief:
      'Dusk fell, the lamp came on, everyone smiled. A few seconds later it switched itself off — and it keeps doing that. The code is exactly the version that worked last week, and the meter says every connection is good.',
    base: 'template:ldr-relay-lamp',
    // Mystery hardware: the wiring and sketch are innocent. A couple of
    // seconds in, the LDR module's reading starts climbing (~+140/s), the
    // sketch decides the street is bright again, and the lamp drops out.
    mystery: { schedule: [{ kind: 'sensor-drift', partId: 'ldr', afterMs: 2000, perSecond: 140 }], runMs: 4500 },
    hints: [
      'Do not just glance at it — let it run. Does the trouble need warm-up time to appear?',
      'Watch the numbers, not the lamp: print the sensor reading (or scope A0) while it runs and see whether the input itself is moving.',
      'The light sensor is the liar — fine at first, then its reading climbs though the street has not got brighter. Swap it for a fresh module on the same pins.',
    ],
    answer:
      'The light-sensor module was failing as it warmed up: a couple of seconds after power-on its reading started drifting upward, so the sketch decided the street was bright again and switched the lamp off. Nothing in the code or wiring was wrong — real sensor modules fail exactly like this, drifting with temperature and age. Replacing the module on the same pins fixes it.',
    check: { noDiagnostics: [], runMs: 4500 },
    skills: ['pc.analog-conditioning', 'al.self-diagnosis'],
  },
];

/** The clean project a challenge starts from, before the fault is applied. */
export function baseProject(challenge: ChaosChallenge): ProjectDoc {
  const [kind, slug] = challenge.base.split(':');
  let doc: ProjectDoc | null = null;
  if (kind === 'template' && slug) doc = templateDoc(slug);
  if (kind === 'mission' && slug) {
    const m = missionBySlug(slug);
    if (m) doc = referenceDoc(m);
  }
  if (!doc) throw new Error(`chaos challenge ${challenge.slug} has unknown base ${challenge.base}`);

  // The overfed-sensor challenge adds a correctly wired pressure sensor to the
  // blink project; the fault then moves its supply to the wrong rail.
  if (challenge.slug === 'the-overfed-sensor') {
    doc.diagram.parts.push({ id: 'bmp', type: 'bmp280', x: 420, y: 320, rotate: 0, attrs: {} });
    doc.diagram.connections.push(
      makeWire({ part: 'uno', pin: '3V3' }, { part: 'bmp', pin: 'VCC' }, 'red'),
      makeWire({ part: 'uno', pin: 'GND' }, { part: 'bmp', pin: 'GND' }, 'black'),
      makeWire({ part: 'bmp', pin: 'SDA' }, { part: 'uno', pin: 'A4' }, 'blue'),
      makeWire({ part: 'bmp', pin: 'SCL' }, { part: 'uno', pin: 'A5' }, 'yellow'),
    );
  }
  doc.provenance = {};
  doc.name = `Chaos Lab: ${challenge.title}`;
  return doc;
}

/**
 * Apply one seeded defect to a document. Pure: clones, never mutates.
 * Shared by the authored challenges (`brokenProject`) and the seeded
 * generator, so a fault means exactly one thing everywhere.
 */
export function applyFault(clean: ProjectDoc, fault: ChaosFault, slug: string): ProjectDoc {
  const doc = structuredClone(clean);
  switch (fault.kind) {
    case 'remove-wire': {
      const w = findWire(doc, fault.from, fault.to);
      if (!w) throw new Error(`${slug}: no wire ${fault.from.join('.')} - ${fault.to.join('.')} to remove`);
      doc.diagram.connections = doc.diagram.connections.filter((x) => x.id !== w.id);
      break;
    }
    case 'move-wire-end': {
      const w = findWire(doc, fault.from, fault.to);
      if (!w) throw new Error(`${slug}: no wire to move`);
      const end = sameEnd(w, fault[fault.end], 'from') ? 'from' : 'to';
      w[end] = { part: w[end].part, pin: fault.newPin };
      break;
    }
    case 'add-wire':
      doc.diagram.connections.push(
        makeWire({ part: fault.from[0], pin: fault.from[1] }, { part: fault.to[0], pin: fault.to[1] }, 'orange'),
      );
      break;
    case 'replace-in-sketch': {
      const src = doc.files['sketch.ino'] ?? '';
      if (!src.includes(fault.find)) throw new Error(`${slug}: sketch does not contain "${fault.find}"`);
      doc.files['sketch.ino'] = src.replace(fault.find, fault.replace);
      break;
    }
    case 'swap-wire-ends': {
      const touch = (pin: string) =>
        doc.diagram.connections.filter((w) =>
          (w.from.part === fault.partId && w.from.pin === pin) || (w.to.part === fault.partId && w.to.pin === pin),
        );
      const wa = touch(fault.pinA)[0];
      const wb = touch(fault.pinB)[0];
      if (!wa || !wb || wa === wb) throw new Error(`${slug}: swap-wire-ends needs two distinct wired pins`);
      const swap = (w: Wire, pin: string): void => {
        if (w.from.part === fault.partId && w.from.pin === pin) w.from = { part: w.from.part, pin: fault.pinA === pin ? fault.pinB : fault.pinA };
        if (w.to.part === fault.partId && w.to.pin === pin) w.to = { part: w.to.part, pin: fault.pinA === pin ? fault.pinB : fault.pinA };
      };
      swap(wa, fault.pinA);
      swap(wb, fault.pinB);
      break;
    }
    case 'bypass-part': {
      const touching = doc.diagram.connections.filter(
        (w) => w.from.part === fault.partId || w.to.part === fault.partId,
      );
      const far = touching.map((w) => (w.from.part === fault.partId ? w.to : w.from));
      if (far.length !== 2) throw new Error(`${slug}: ${fault.partId} must have exactly two wires to bypass`);
      doc.diagram.parts = doc.diagram.parts.filter((p) => p.id !== fault.partId);
      doc.diagram.connections = doc.diagram.connections.filter((w) => !touching.includes(w));
      doc.diagram.connections.push(makeWire(far[0]!, far[1]!, 'green'));
      break;
    }
  }
  return doc;
}

/** Apply faults in order; the generator's repair path uses this too. */
export function applyFaults(clean: ProjectDoc, faults: ChaosFault[], slug: string): ProjectDoc {
  let doc = clean;
  for (const fault of faults) doc = applyFault(doc, fault, slug);
  return doc;
}

/** Apply a challenge's defect to a fresh copy of its base project. */
export function brokenProject(challenge: ChaosChallenge): ProjectDoc {
  const clean = baseProject(challenge);
  // A mystery challenge's document is innocent — the runtime schedule does
  // the damage — so the broken project is simply the clean base.
  const doc = challenge.fault ? applyFault(clean, challenge.fault, challenge.slug) : structuredClone(clean);
  doc.provenance = { ...doc.provenance, forkedFrom: `chaos:${challenge.slug}` };
  return doc;
}

export interface ChaosVerdict {
  fixed: boolean;
  /** Plain-language reasons it is not fixed yet, empty when fixed. */
  remaining: string[];
}

/**
 * A deterministic behavioural fingerprint of a run: serial text plus the
 * observable state of every actuator-ish part after a fixed virtual-time run.
 * The runtime's RNG is seeded xorshift32, so the same document always
 * fingerprints the same — which is what makes generated challenges checkable.
 */
export function behaviourFingerprint(doc: ProjectDoc, ms = 1_500, schedule: FaultSchedule = EMPTY_SCHEDULE): string {
  const engine = new SimEngine(doc);
  engine.setFaultSchedule(schedule);
  engine.load(doc, doc.files['sketch.ino'] ?? '');
  engine.start();
  for (let t = 0; t < ms && !engine.error; t += 50) engine.tick(50, 1);
  const snap = engine.snapshot();
  const serial = snap.serial.map((l) => l.text).join('');
  const states = Object.entries(snap.parts)
    .map(([id, state]) => {
      switch (state.kind) {
        case 'led':
          return `${id}:led:${state.on ? 1 : 0}:${Math.round(state.brightness * 100)}`;
        case 'relay':
          return `${id}:relay:${state.closed ? 1 : 0}`;
        case 'servo':
          return `${id}:servo:${Math.round(state.angle)}`;
        case 'buzzer':
          return `${id}:buzzer:${state.active ? Math.round(state.frequency) : 0}`;
        case 'motor':
          return `${id}:motor:${Math.round(state.speed * 100)}`;
        case 'lcd':
          return `${id}:lcd:${state.lines.join('|')}`;
        case 'oled':
          return `${id}:oled:${state.lines.join('|')}`;
        case 'seven-seg':
          return `${id}:seg:${state.value}`;
        case 'matrix':
          return `${id}:matrix:${state.cells.map((c) => (c ? 1 : 0)).join('')}`;
        case 'rgb':
          return `${id}:rgb:${state.r},${state.g},${state.b}`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .sort()
    .join('\n');
  let h = 5381;
  const text = `${serial}‖${states}`;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16) + `:${text.length}`;
}

/** Has the student repaired the project? Checks the ERC, behaviour and (generated) fingerprint. */
export function checkRepair(challenge: ChaosChallenge, doc: ProjectDoc): ChaosVerdict {
  const remaining: string[] = [];
  const found = runERC(doc);
  for (const code of challenge.check.noDiagnostics) {
    const hit = found.find((d) => d.code === code);
    if (hit) remaining.push(hit.title);
  }
  if (challenge.check.scenario) {
    const result = runScenario(doc, parseScenario(challenge.check.scenario));
    if (!result.passed) {
      remaining.push(result.error ?? `It still does not behave: ${result.failure?.message ?? 'check failed'}`);
    }
  }
  if (challenge.check.fingerprint !== undefined || challenge.mystery) {
    const runMs = challenge.check.runMs ?? 1_500;
    const schedule = challenge.mystery?.schedule ?? EMPTY_SCHEDULE;
    // Generated challenges carry the expected fingerprint from generation
    // time (their base is 'adhoc', not rebuildable); authored mystery
    // challenges derive it from their named base project. The reference is
    // the base's *healthy* run; the student's document is then run *with*
    // the schedule, so an un-replaced faulty part still fails the check.
    const expected = challenge.check.fingerprint ?? behaviourFingerprint(baseProject(challenge), runMs);
    const now = behaviourFingerprint(doc, runMs, schedule);
    if (now !== expected) {
      remaining.push(
        runERC(doc).length > 0
          ? 'The electrical check still reports a problem.'
          : 'It runs, but not the way the original project did — compare what the parts are doing now.',
      );
    }
  }
  return { fixed: remaining.length === 0, remaining };
}

export function chaosBySlug(slug: string): ChaosChallenge | undefined {
  return CHAOS_CHALLENGES.find((c) => c.slug === slug);
}
