import { buildNetlist, type Netlist } from '@/lib/erc/netlist';
import { chipById, evaluateChip } from '@/lib/chips/chips';
import { getPart } from '@/lib/parts';
import type { PartDef } from '@/lib/parts/types';
import type { PartInstance, ProjectDoc } from '@/lib/doc/types';
import type { PinMode, SimHost } from './host';
import { INPUT, INPUT_PULLUP, OUTPUT } from './host';
import { GpioStepperDecoder, Max7219Decoder, SEGMENT_PINS, sevenSegmentValue, type SerialPins } from './gpio-devices';
import { LogicCapture, LOGIC_CHANNELS, MAX_LOGIC_ANALYZERS, type LogicLevel, type LogicTrace } from './instruments/logic-analyzer';
import { applyFaultEvents, EMPTY_SCHEDULE, type FaultSchedule } from './faults';
import { Oscilloscope, type ScopeTrace } from './instruments/oscilloscope';
import {
  solveMultimeter,
  type MultimeterMode,
  type MultimeterReading,
} from './instruments/multimeter';

export type VoltageReading =
  | { kind: 'voltage'; volts: number; source: 'driven' | 'rail' | 'sensor' | 'ground' | 'relay' | 'pullup' }
  | { kind: 'unmeasured'; reason: 'floating' | 'unpowered' | 'open' | 'unwired' | 'not-running' };

export interface LedState {
  kind: 'led';
  on: boolean;
  brightness: number;
  colour: string;
}
export interface RgbState {
  kind: 'rgb';
  r: number;
  g: number;
  b: number;
}
export interface ServoState {
  kind: 'servo';
  angle: number;
}
export interface RelayState {
  kind: 'relay';
  closed: boolean;
}
export interface BuzzerState {
  kind: 'buzzer';
  active: boolean;
  frequency: number;
}
export interface MotorState {
  kind: 'motor';
  speed: number;
}
export interface LcdState {
  kind: 'lcd';
  lines: string[];
  backlight: boolean;
  cols: number;
  rows: number;
}
export interface OledState {
  kind: 'oled';
  lines: string[];
}
export interface MatrixState {
  kind: 'matrix';
  cells: boolean[];
}
export interface SevenSegState {
  kind: 'seven-seg';
  /** Actual observed common-cathode segments; bit order a,b,c,d,e,f,g,dp. */
  segments: number;
  /** Only populated for an exact known digit pattern. */
  value: string;
}
export interface StepperState {
  kind: 'stepper';
  /** Observed HIGH GPIO inputs IN1..IN4; not physical coil current. */
  coils: number | null;
  /** Signed observed GPIO phase transitions; not shaft steps/angle or speed. */
  transitions: number;
  sequence: 'half' | 'full' | null;
  phase: number | null;
  powered: boolean;
}
export interface LogicAnalyzerState {
  kind: 'logic-analyzer';
  grounded: boolean;
  levels: LogicLevel[];
  edges: number;
  dropped: number;
}
export interface SensorState {
  kind: 'sensor';
  value: number;
  unit: string;
  label: string;
}
export interface BoardState {
  kind: 'board';
  pins: Record<string, number>;
}
export interface NoneState {
  kind: 'none';
}

export type PartState =
  | LedState
  | RgbState
  | ServoState
  | RelayState
  | BuzzerState
  | MotorState
  | LcdState
  | OledState
  | MatrixState
  | SevenSegState
  | StepperState
  | LogicAnalyzerState
  | SensorState
  | BoardState
  | NoneState;

export interface SerialLine {
  at: number;
  text: string;
}

interface LcdBuffer {
  lines: string[];
  row: number;
  col: number;
  backlight: boolean;
  cols: number;
  rows: number;
}

/** Board pin name "D13" or "A0" to the Arduino pin number the sketch uses. */
function arduinoPinOf(def: PartDef, pinName: string, analogBase: number): number | null {
  const d = /^D(\d+)$/.exec(pinName);
  if (d?.[1]) return Number(d[1]);
  const a = /^A(\d+)$/.exec(pinName);
  if (a?.[1]) return analogBase + Number(a[1]);
  const gp = /^GP(\d+)$/.exec(pinName);
  if (gp?.[1]) return Number(gp[1]);
  const n = /^\d+$/.exec(pinName);
  if (n?.[0]) return Number(n[0]);
  const pwm = String(def.defaults?.pwmPins ?? '');
  void pwm;
  return null;
}

export class Circuit implements SimHost {
  private doc: ProjectDoc;
  private nl: Netlist;
  private board: PartInstance | null = null;
  private boardDef: PartDef | null = null;

  /** Arduino pin number -> node key. */
  private pinNode = new Map<number, string>();
  /** Node key -> net id, cached from the netlist. */
  private netVoltage = new Map<string, number>();
  private netDuty = new Map<string, number>();
  private pinModes = new Map<number, PinMode>();

  private servoAngles = new Map<string, number>();
  private lcds = new Map<string, LcdBuffer>();
  private oleds = new Map<string, string[]>();
  private buzzerFreq = new Map<string, number>();
  private motorSpeed = new Map<string, number>();
  /** Device decoders retain their register/phase state while wiring is unchanged. */
  private matrices = new Map<string, { pins: [number, number, number]; powered: boolean; decoder: Max7219Decoder }>();
  private steppers = new Map<string, { pins: [number, number, number, number]; powered: boolean; decoder: GpioStepperDecoder }>();
  /** Bounded live captures. Never persisted in ProjectDoc or browser storage. */
  private logicCaptures = new Map<string, LogicCapture>();
  /** Peripheral waveforms not decoded by the eight-channel GPIO probe. */
  private unknownLogicPins = new Set<number>();
  /** Virtual-time dual-channel oscilloscope instance. Transient worker memory only. */
  private oscilloscope = new Oscilloscope('scope-main');

  clock = 0;
  /**
   * Session-local mystery-hardware schedule (sim/faults). The engine owns the
   * authoritative copy and re-attaches it here on every load(), because a
   * reset() rebuilds the Circuit from scratch.
   */
  faultSchedule: FaultSchedule = EMPTY_SCHEDULE;
  /** Lines printed since the plotter last harvested, used for CSV extraction. */
  serialBuffer: SerialLine[] = [];
  /** The full visible log, capped. This is what the Serial panel shows. */
  serialLog: SerialLine[] = [];
  private pendingLine: { at: number; text: string } | null = null;
  /** Lines ever completed, never capped: lets a reader find what is new. */
  serialTotal = 0;
  private serialIn = '';
  private rngState = 1;
  private interrupts = new Map<number, { mode: string; handler: () => void; last: number }>();
  private inIsr = false;
  /** An error thrown inside an interrupt handler, surfaced by the engine. */
  isrError: unknown = null;
  unsupportedCalls = new Set<string>();
  private notes: string[] = [];

  constructor(doc: ProjectDoc) {
    this.doc = doc;
    this.nl = buildNetlist(doc);
    this.rebuild();
  }

  /** Re-read the document after an edit. Keeps running state where it can. */
  update(doc: ProjectDoc): void {
    this.doc = doc;
    this.nl = buildNetlist(doc);
    this.rebuild();
    // A button press or a slider move is an input edge: interrupts see it now.
    this.pollInterrupts();
  }

  private rebuild(): void {
    this.pinNode.clear();
    const boards = this.nl.boards;
    const boardId = boards[0];
    if (!boardId) {
      this.board = null;
      this.boardDef = null;
      this.matrices.clear();
      this.steppers.clear();
      this.rebuildLogicCaptures(); // unwired probes still show unknown, never LOW
      return;
    }
    const inst = this.doc.diagram.parts.find((p) => p.id === boardId) ?? null;
    this.board = inst;
    this.boardDef = inst ? (getPart(inst.type) ?? null) : null;
    if (!inst || !this.boardDef) {
      this.rebuildLogicCaptures();
      return;
    }

    const analogBase = Number(this.boardDef.defaults?.analogBase ?? 14);
    for (const pin of this.boardDef.pins) {
      const n = arduinoPinOf(this.boardDef, pin.name, analogBase);
      if (n === null) continue;
      this.pinNode.set(n, `${inst.id}:${pin.name}`);
    }
    this.rebuildGpioDevices();
    this.rebuildLogicCaptures();
    this.rebuildOscilloscope();
  }

  /** A probe is only meaningful relative to an actual ground reference. */
  private logicGrounded(partId: string): boolean {
    const net = this.nl.nodeNet.get(`${partId}:GND`);
    const info = net ? this.nl.nets.get(net) : undefined;
    return !!info && info.nodes.length > 1 && info.isGround && !info.isPower;
  }

  private logicNet(partId: string, channel: string): string | undefined {
    return this.nl.nodeNet.get(`${partId}:${channel}`);
  }

  private logicSignature(partId: string): string {
    return ['GND', ...LOGIC_CHANNELS].map((pin) => {
      const net = this.nl.nodeNet.get(`${partId}:${pin}`);
      const info = net ? this.nl.nets.get(net) : undefined;
      return info?.nodes.join('|') ?? '';
    }).join('\n');
  }

  private logicSource(partId: string, channel: string): string {
    const net = this.logicNet(partId, channel);
    const info = net ? this.nl.nets.get(net) : undefined;
    if (!info || info.nodes.length < 2) return 'unwired';
    const boards = info.nodes.filter((node) => {
      const pin = this.nl.nodes.get(node);
      return pin?.part.adapter === 'board' && pin.pin.electrical !== 'power' && pin.pin.electrical !== 'ground';
    });
    if (boards.length === 1) {
      const board = this.nl.nodes.get(boards[0]!);
      return `${board?.part.name ?? 'Board'} ${board?.pin.name ?? ''}`;
    }
    if (info.isGround && !info.isPower) return 'ground';
    if (info.isPower && !info.isGround) return `${info.voltage ?? '?'} V rail`;
    return 'undecoded net';
  }

  /** Only a single board GPIO drive/pull-up or a sound rail is known. */
  private logicLevel(partId: string, channel: string): LogicLevel {
    if (!this.logicGrounded(partId)) return 'x';
    const net = this.logicNet(partId, channel);
    const info = net ? this.nl.nets.get(net) : undefined;
    if (!net || !info || info.nodes.length < 2 || (info.isPower && info.isGround)) return 'x';
    const boardNodes = info.nodes.filter((node) => {
      const pin = this.nl.nodes.get(node);
      return pin?.part.adapter === 'board' && pin.pin.electrical !== 'power' && pin.pin.electrical !== 'ground';
    });
    // More than one board pin on the same net can contend. This first slice
    // does not guess whether they agree, even when both happen to be HIGH.
    if (boardNodes.length > 1) return 'x';
    const boardPin = boardNodes.length === 1
      ? [...this.pinNode].find(([, node]) => node === boardNodes[0])?.[0] : undefined;
    if (boardPin !== undefined && this.unknownLogicPins.has(boardPin)) return 'x';
    if (info.isGround || info.isPower) {
      if (boardPin !== undefined && this.pinModes.get(boardPin) === OUTPUT) return 'x';
      if (info.isGround) return '0';
      return (info.voltage ?? 0) >= 2.5 ? '1' : 'x';
    }
    if (boardPin === undefined) return 'x';
    if (this.pinModes.get(boardPin) === OUTPUT && this.netVoltage.has(net)) {
      // A button, sensor, potentiometer or custom chip can drive this net too.
      // Their possible contention is not resolved by the GPIO latch model.
      if (this.partsOnNet(net).some((part) => {
        const adapter = getPart(part.type)?.adapter;
        return adapter === 'button' || adapter === 'sensor-value'
          || adapter === 'potentiometer' || adapter === 'chip';
      })) return 'x';
      const duty = this.netDuty.get(net);
      if (duty !== 0 && duty !== 255) return 'x'; // analogWrite averages PWM, not a waveform
      return (this.netVoltage.get(net) ?? 0) >= 2.5 ? '1' : '0';
    }
    if (this.pinModes.get(boardPin) === INPUT_PULLUP) {
      // A directly wired button is the only modelled digital input here. Other
      // sensor/chip outputs may be time-dependent or unpowered; do not infer.
      const others = this.partsOnNet(net).filter((p) => p.id !== partId && p.id !== this.board?.id);
      if (others.every((p) => getPart(p.type)?.adapter === 'button')) {
        return this.readNetDigital(net, true) ? '1' : '0';
      }
    }
    return 'x';
  }

  private logicValues(partId: string): LogicLevel[] {
    return LOGIC_CHANNELS.map((pin) => this.logicLevel(partId, pin));
  }

  private logicNowNs(): number {
    return Math.round(this.clock * 1000);
  }

  private rebuildLogicCaptures(): void {
    const previous = this.logicCaptures;
    this.logicCaptures = new Map();
    for (const part of this.doc.diagram.parts.filter((p) => p.type === 'emu-logic-analyzer').slice(0, MAX_LOGIC_ANALYZERS)) {
      const signature = this.logicSignature(part.id);
      const old = previous.get(part.id);
      const label = part.label || `Logic analyzer ${part.id}`;
      const grounded = this.logicGrounded(part.id);
      const sources = LOGIC_CHANNELS.map((pin) => this.logicSource(part.id, pin));
      const values = this.logicValues(part.id);
      const capture = old?.signature === signature ? old
        : new LogicCapture(part.id, signature, label, grounded, sources, this.logicNowNs(), values);
      capture.label = label;
      capture.grounded = grounded;
      capture.sources = sources;
      capture.observe(this.logicNowNs(), values);
      this.logicCaptures.set(part.id, capture);
    }
  }

  private sampleLogicCaptures(): void {
    for (const capture of this.logicCaptures.values()) {
      capture.observe(this.logicNowNs(), this.logicValues(capture.id));
    }
  }

  get hasLogicAnalyzers(): boolean { return this.logicCaptures.size > 0; }

  /** AVR SPI/UART/TWI/Timer pins are X until a timed waveform decoder exists. */
  setUnknownLogicPins(pins: ReadonlySet<number>): void {
    this.unknownLogicPins = new Set(pins);
    this.sampleInstruments();
  }

  /** Clear stale waves on a sketch reload without storing them in the document. */
  resetLogicCaptures(): void {
    this.logicCaptures.clear();
    this.rebuildLogicCaptures();
  }

  private rebuildOscilloscope(): void {
    const scopePrefs = this.doc.sim?.scope;
    let ch1 = scopePrefs?.ch1;
    let ch2 = scopePrefs?.ch2;

    if (ch1 === undefined) {
      if (this.board) {
        ch1 = `${this.board.id}:D13`;
      }
    }
    if (ch2 === undefined) {
      if (this.board) {
        ch2 = `${this.board.id}:A0`;
      }
    }

    this.oscilloscope.setConfig({
      ch1Source: ch1 ?? null,
      ch2Source: ch2 ?? null,
      timebaseUsPerDiv: scopePrefs?.timebaseUs ?? 1000,
      trigger: scopePrefs?.trigger,
    });
  }

  nodeVoltage(nodeKey: string): VoltageReading {
    if (!this.nl.nodeNet.has(nodeKey)) {
      return { kind: 'unmeasured', reason: 'unwired' };
    }
    const netId = this.nl.nodeNet.get(nodeKey)!;
    const net = this.nl.nets.get(netId);
    if (!net) return { kind: 'unmeasured', reason: 'open' };

    if (net.isGround) {
      return { kind: 'voltage', volts: 0.0, source: 'ground' };
    }

    if (this.netVoltage.has(netId)) {
      return { kind: 'voltage', volts: this.netVoltage.get(netId)!, source: 'driven' };
    }

    if (net.isPower && net.voltage !== null) {
      return { kind: 'voltage', volts: net.voltage, source: 'rail' };
    }

    // Potentiometer wiper or sensor module
    for (const inst of this.partsOnNet(netId)) {
      const def = getPart(inst.type);
      if (def?.adapter === 'potentiometer') {
        const vccNet = this.nl.nodeNet.get(`${inst.id}:VCC`) ?? this.nl.nodeNet.get(`${inst.id}:3`);
        const gndNet = this.nl.nodeNet.get(`${inst.id}:GND`) ?? this.nl.nodeNet.get(`${inst.id}:1`);
        const isPowered = vccNet && this.nl.nets.get(vccNet)?.isPower;
        const isGrounded = gndNet && this.nl.nets.get(gndNet)?.isGround;
        if (isPowered && isGrounded) {
          const v = (this.inputValue(inst, 'potentiometer') / 1023) * 5.0;
          return { kind: 'voltage', volts: Math.round(v * 1000) / 1000, source: 'sensor' };
        }
        return { kind: 'unmeasured', reason: 'unpowered' };
      }
      if (def?.adapter === 'sensor-value') {
        const val = (this.inputValue(inst) / 1023) * 5.0;
        return { kind: 'voltage', volts: Math.round(val * 1000) / 1000, source: 'sensor' };
      }
    }

    // Relay contacts
    const cv = this.contactVoltage(netId, new Set([netId]));
    if (cv !== null) {
      return { kind: 'voltage', volts: cv, source: 'relay' };
    }

    // Input pullup on board pins
    for (const [pinNum, mappedNode] of this.pinNode) {
      if (this.nl.nodeNet.get(mappedNode) === netId && this.pinModes.get(pinNum) === INPUT_PULLUP) {
        const isPulledLow = this.partsOnNet(netId).some((inst) => {
          const def = getPart(inst.type);
          if (def?.adapter === 'button' && this.inputValue(inst) !== 0) {
            const other = def.pins.find((p) => p.name !== this.pinNameOnNet(inst, netId));
            if (other) {
              const otherNet = this.nl.nodeNet.get(`${inst.id}:${other.name}`);
              return otherNet && this.nl.nets.get(otherNet)?.isGround;
            }
          }
          return false;
        });
        return { kind: 'voltage', volts: isPulledLow ? 0.0 : 5.0, source: 'pullup' };
      }
    }

    return { kind: 'unmeasured', reason: 'floating' };
  }

  private sampleOscilloscope(): void {
    let ch1Volts: number | null = null;
    if (this.oscilloscope.ch1Source) {
      const v = this.nodeVoltage(this.oscilloscope.ch1Source);
      ch1Volts = v.kind === 'voltage' ? v.volts : null;
    }
    let ch2Volts: number | null = null;
    if (this.oscilloscope.ch2Source) {
      const v = this.nodeVoltage(this.oscilloscope.ch2Source);
      ch2Volts = v.kind === 'voltage' ? v.volts : null;
    }
    this.oscilloscope.observe(this.clock, ch1Volts, ch2Volts);
  }

  sampleInstruments(): void {
    this.sampleLogicCaptures();
    this.sampleOscilloscope();
  }

  scopeTrace(): ScopeTrace {
    return this.oscilloscope.snapshot(this.clock);
  }

  multimeterReading(
    mode: MultimeterMode = 'dc-v',
    probeA: string | null = null,
    probeB: string | null = null,
  ): MultimeterReading {
    const defaultA = probeA ?? this.doc.sim?.multimeter?.probeA ?? (this.board ? `${this.board.id}:D13` : null);
    const defaultB = probeB ?? this.doc.sim?.multimeter?.probeB ?? (this.board ? `${this.board.id}:GND` : null);
    return solveMultimeter(this.doc, this.nl, this, mode, defaultA, defaultB);
  }

  resetInstruments(): void {
    this.resetLogicCaptures();
    this.oscilloscope.reset();
  }

  logicTraces(): LogicTrace[] {
    return [...this.logicCaptures.values()].map((capture) => capture.snapshot(this.logicNowNs()));
  }

  /** Only an unambiguous, distinct board GPIO on each input can be decoded. */
  private boardPinAt(partId: string, input: string): number | null {
    const net = this.nl.nodeNet.get(`${partId}:${input}`);
    if (!net) return null;
    const pins = [...this.pinNode].filter(([, node]) => this.nl.nodeNet.get(node) === net);
    return pins.length === 1 ? (pins[0]?.[0] ?? null) : null;
  }

  private rebuildGpioDevices(): void {
    const oldMatrices = this.matrices;
    const oldSteppers = this.steppers;
    this.matrices = new Map();
    this.steppers = new Map();
    for (const inst of this.doc.diagram.parts) {
      if (inst.type === 'matrix-8x8-max7219' || inst.type === 'emu-max7219') {
        const din = this.boardPinAt(inst.id, 'DIN');
        const cs = this.boardPinAt(inst.id, 'CS');
        const clk = this.boardPinAt(inst.id, 'CLK');
        if (din === null || cs === null || clk === null || new Set([din, cs, clk]).size !== 3) continue;
        const pins: [number, number, number] = [din, cs, clk];
        const old = oldMatrices.get(inst.id);
        const def = getPart(inst.type);
        const powered = !!def && this.powered(inst, def);
        const decoder = old?.powered === powered && old.pins.every((p, i) => p === pins[i])
          ? old.decoder : new Max7219Decoder();
        this.matrices.set(inst.id, { pins, powered, decoder });
      }
      if (inst.type === 'uln2003' || inst.type === 'stepper-28byj48') {
        const pins = ['IN1', 'IN2', 'IN3', 'IN4'].map((name) => this.boardPinAt(inst.id, name));
        if (pins.some((pin) => pin === null) || new Set(pins).size !== 4) continue;
        const numbered: [number, number, number, number] = [pins[0]!, pins[1]!, pins[2]!, pins[3]!];
        const old = oldSteppers.get(inst.id);
        const def = getPart(inst.type);
        const powered = !!def && this.powered(inst, def);
        const decoder = old?.powered === powered && old.pins.every((p, i) => p === numbered[i])
          ? old.decoder : new GpioStepperDecoder();
        this.steppers.set(inst.id, { pins: numbered, powered, decoder });
      }
    }
    this.sampleGpioDevices();
  }

  private netOfPin(pin: number): string | undefined {
    const node = this.pinNode.get(pin);
    if (!node) return undefined;
    return this.nl.nodeNet.get(node);
  }

  private powered(inst: PartInstance, def: PartDef): boolean {
    return def.pins.every((pin) => {
      if (pin.electrical !== 'power' && pin.electrical !== 'ground') return true;
      const net = this.nl.nodeNet.get(`${inst.id}:${pin.name}`);
      const info = net ? this.nl.nets.get(net) : undefined;
      return pin.electrical === 'power' ? info?.isPower === true : info?.isGround === true;
    });
  }

  /** A floating pin, pull-up, or a GPIO tied directly to a rail is not a drive. */
  private outputLevel(pin: number): 0 | 1 | null {
    const net = this.netOfPin(pin);
    if (!net || this.pinModes.get(pin) !== OUTPUT || !this.netVoltage.has(net)) return null;
    const info = this.nl.nets.get(net);
    if (info?.isPower || info?.isGround) return null; // short/pin conflict: level is not trustworthy
    return (this.netVoltage.get(net) ?? 0) >= 2.5 ? 1 : 0;
  }

  /** Sample on *each* drive change, not once per rendered frame. */
  private sampleGpioDevices(): void {
    for (const [id, { pins, decoder }] of this.matrices) {
      const inst = this.doc.diagram.parts.find((p) => p.id === id);
      const def = inst && getPart(inst.type);
      const powered = !!inst && !!def && this.powered(inst, def);
      const [din, cs, clk] = pins;
      const levels: SerialPins = powered
        ? { din: this.outputLevel(din), cs: this.outputLevel(cs), clk: this.outputLevel(clk) }
        : { din: null, cs: null, clk: null };
      decoder.onPins(levels);
    }
    for (const [id, { pins, decoder }] of this.steppers) {
      const inst = this.doc.diagram.parts.find((p) => p.id === id);
      const def = inst && getPart(inst.type);
      const levels = pins.map((pin) => this.outputLevel(pin));
      const complete = !!inst && !!def && this.powered(inst, def) && levels.every((v) => v !== null);
      decoder.onCoils(complete ? levels.reduce<number>((mask, v, i) => mask | ((v ?? 0) << i), 0) : null);
    }
  }

  /**
   * The AVR changes all bits of a port in one instruction. Apply the register
   * snapshot *atomically*, so an OUT writing CLK and DIN together cannot
   * create a fictitious intermediate clock edge or stepper phase.
   */
  applyAvrPins(pins: ReadonlyArray<{ pin: number; mode: PinMode; level: 0 | 1 }>): void {
    const touched = new Set<string>();
    for (const { pin, mode, level } of pins) {
      const net = this.netOfPin(pin);
      const previous = this.pinModes.get(pin);
      this.pinModes.set(pin, mode);
      if (!net) continue;
      if (mode === OUTPUT) {
        this.netVoltage.set(net, level ? 5 : 0);
        this.netDuty.set(net, level ? 255 : 0);
      } else if (mode === INPUT_PULLUP) {
        this.netVoltage.set(net, 5);
        this.netDuty.delete(net);
      } else if (previous === OUTPUT || previous === INPUT_PULLUP) {
        this.netVoltage.delete(net);
        this.netDuty.delete(net);
      }
      touched.add(net);
    }
    for (const net of touched) this.updateOutputs(net);
    this.sampleGpioDevices();
    this.sampleInstruments();
    this.pollInterrupts();
  }

  /** One byte from a completed ATmega328P hardware-SPI master transfer. */
  hardwareSpiByte(byte: number, mode: number, order: 'msbFirst' | 'lsbFirst'): void {
    for (const [id, { pins, decoder }] of this.matrices) {
      const inst = this.doc.diagram.parts.find((p) => p.id === id);
      const def = inst && getPart(inst.type);
      if (pins[0] !== 11 || pins[2] !== 13 || !inst || !def || !this.powered(inst, def)) continue;
      if (this.outputLevel(pins[1]) !== 0) continue; // the device is not selected
      if (mode !== 0 || order !== 'msbFirst' || this.outputLevel(11) === null || this.outputLevel(13) === null) {
        this.unsupported(`${inst.type}: AVR SPI mode ${mode}/${order} or MOSI/SCK direction is not decoded for MAX7219`);
        continue;
      }
      decoder.writeByte(byte);
    }
  }

  /** Engine-visible fidelity limits. Display states never guess missing buses. */
  deviceLimitations(): string[] {
    const notes: string[] = [];
    for (const inst of this.doc.diagram.parts) {
      if (inst.type === 'matrix-8x8-max7219' || inst.type === 'emu-max7219') {
        const attachment = this.matrices.get(inst.id);
        if (!attachment) notes.push(`${inst.type}: DIN/CS/CLK require three distinct board GPIO nets for MAX7219 decoding`);
        else if (attachment.powered && attachment.pins.some((pin) => this.outputLevel(pin) === null)) {
          notes.push(`${inst.type}: DIN/CS/CLK are not all driven GPIO outputs; no serial transfer decoded`);
        }
        const dout = this.nl.nodeNet.get(`${inst.id}:DOUT`);
        if (dout && this.nl.nets.get(dout)?.nodes.some((node) => node !== `${inst.id}:DOUT`)) {
          notes.push(`${inst.type}: daisy-chained DOUT is not modelled`);
        }
        const limitation = attachment?.decoder.limitation;
        if (limitation) notes.push(`${inst.type}: ${limitation}`);
      } else if (inst.type === 'uln2003' || inst.type === 'stepper-28byj48') {
        const attachment = this.steppers.get(inst.id);
        if (!attachment) notes.push(`${inst.type}: requires four distinct board GPIO inputs IN1..IN4; driver outputs/shaft motion are not simulated`);
        const state = attachment?.decoder.state;
        if (state && state.coils === null && attachment?.powered) {
          notes.push(`${inst.type}: IN1..IN4 are not all driven GPIO outputs; coil phase is unknown`);
        } else if (state && state.coils !== null && state.coils !== 0 && state.sequence === null) {
          notes.push(`${inst.type}: coil pattern 0x${state.coils.toString(16)} is ambiguous/unknown; no step inferred`);
        } else if (state && state.coils !== null && state.coils !== 0 && state.phase === null) {
          notes.push(`${inst.type}: coil pattern 0x${state.coils.toString(16)} is not in the selected sequence; no step inferred`);
        }
      } else if ((inst.type === 'seven-segment' || inst.type === 'emu-7segment') && inst.attrs.common === 'anode') {
        notes.push(`${inst.type}: common-anode polarity is not modelled; this catalogue part has a common cathode`);
      } else if (inst.type === 'emu-logic-analyzer') {
        if (!this.logicCaptures.has(inst.id)) {
          notes.push('logic analyzer: at most two concurrent eight-channel captures are supported');
        } else if (!this.logicGrounded(inst.id)) {
          notes.push('logic analyzer: connect GND to a ground reference; channels remain unknown until then');
        }
        if (LOGIC_CHANNELS.some((channel) => {
          const net = this.logicNet(inst.id, channel);
          const duty = net ? this.netDuty.get(net) : undefined;
          return duty !== undefined && duty > 0 && duty < 255;
        })) notes.push('logic analyzer: functional analogWrite is averaged PWM, not a waveform; affected channels are unknown');
        if (LOGIC_CHANNELS.some((channel) => {
          const net = this.logicNet(inst.id, channel);
          return !!net && [...this.pinNode].some(([pin, node]) =>
            this.nl.nodeNet.get(node) === net && this.unknownLogicPins.has(pin));
        })) notes.push('logic analyzer: SPI/UART/TWI/Timer peripheral outputs are not sampled as waveforms; affected channels are unknown');
      }
    }
    return [...new Set(notes)];
  }

  private partsOnNet(netId: string): PartInstance[] {
    const seen = new Set<string>();
    const out: PartInstance[] = [];
    for (const node of this.nl.nets.get(netId)?.nodes ?? []) {
      const [partId] = node.split(':');
      if (!partId || seen.has(partId)) continue;
      seen.add(partId);
      const inst = this.doc.diagram.parts.find((p) => p.id === partId);
      if (inst) out.push(inst);
    }
    return out;
  }

  /** The input control a sensor part reads, taken from its first control. */
  private inputNameFor(inst: PartInstance): string | null {
    const def = getPart(inst.type);
    return def?.controls[0]?.id ?? null;
  }

  /**
   * The current value of one of a part's controls. A per-part key
   * ("btn2.buttonPressed") wins over the shared key ("buttonPressed"), so two
   * buttons on one canvas can be pressed independently.
   */
  private inputValue(inst: PartInstance, override?: string): number {
    const def = getPart(inst.type);
    const name = override ?? this.inputNameFor(inst);
    if (!name) return 0;
    const inputs = this.doc.sim.inputs;
    const fallback = def?.controls.find((c) => c.id === name)?.default ?? (override ? undefined : def?.controls[0]?.default);
    const raw = inputs[`${inst.id}.${name}`] ?? inputs[name] ?? fallback ?? 0;
    const value = typeof raw === 'number' ? raw : 0;
    // Mystery-hardware faults (sim/faults) hit sensor modules only: a
    // potentiometer or button is a student control, not hardware under test.
    if (this.faultSchedule.length > 0 && def?.adapter === 'sensor-value') {
      return applyFaultEvents(this.faultSchedule, inst.id, value, this.clock / 1000);
    }
    return value;
  }

  /* ------------------------------------------------------------ SimHost */

  nowUs(): number {
    return this.clock;
  }

  advance(us: number): void {
    this.passTime(us);
  }

  /** Called by the engine so millis() tracks wall time even without delay(). */
  advanceIdle(us: number): void {
    this.passTime(us);
  }

  /**
   * Let time pass. With interrupts attached, time passes in 1 ms steps so an
   * edge that happens during delay() still fires its handler, as on hardware.
   */
  private passTime(us: number): void {
    const total = Math.max(0, us);
    if (this.interrupts.size === 0 || this.inIsr) {
      this.clock += total;
      this.sampleInstruments();
      return;
    }
    let left = total;
    while (left > 0) {
      const step = Math.min(left, 1000);
      this.clock += step;
      left -= step;
      this.pollInterrupts();
    }
    this.sampleInstruments();
  }

  pinMode(pin: number, mode: PinMode): void {
    const previous = this.pinModes.get(pin);
    this.pinModes.set(pin, mode);
    const net = this.netOfPin(pin);
    // Enabling OUTPUT drives the current PORT latch. A never-written Arduino
    // GPIO latch starts LOW, just like the AVR DDR register transition.
    if (net && mode === OUTPUT && !this.netVoltage.has(net)) {
      this.netVoltage.set(net, 0);
      this.netDuty.set(net, 0);
    }
    if (net && mode === INPUT_PULLUP) this.netVoltage.set(net, 5);
    if (net && mode === INPUT && (previous === OUTPUT || previous === INPUT_PULLUP)) {
      this.netVoltage.delete(net);
      this.netDuty.delete(net);
    }
    this.sampleGpioDevices();
    this.sampleInstruments();
  }

  digitalWrite(pin: number, value: number): void {
    this.digitalWritePins([{ pin, value }]);
  }

  digitalWritePins(pins: ReadonlyArray<{ pin: number; value: number }>): void {
    const touched = new Set<string>();
    for (const { pin, value } of pins) {
      const net = this.netOfPin(pin);
      if (!net) continue;
      this.netVoltage.set(net, value ? 5 : 0);
      this.netDuty.set(net, value ? 255 : 0);
      touched.add(net);
    }
    for (const net of touched) this.updateOutputs(net);
    if (touched.size > 0) {
      this.sampleGpioDevices();
      this.sampleInstruments();
      this.pollInterrupts();
    }
  }

  digitalRead(pin: number): number {
    const net = this.netOfPin(pin);
    if (!net) return 0;
    return this.readNetDigital(net, this.pinModes.get(pin) === INPUT_PULLUP);
  }

  /**
   * The digital level of any pin on the canvas, by part id and pin name. Used by
   * automation scenarios (`expect-pin`). Board pins accept Wokwi-style names:
   * "13" and "D13" are the same pin.
   */
  pinLevel(partId: string, pinName: string): number {
    const inst = this.doc.diagram.parts.find((p) => p.id === partId);
    const def = inst ? getPart(inst.type) : undefined;
    if (!inst || !def) return 0;
    let name = pinName;
    if (def.adapter === 'board' && /^\d+$/.test(pinName)) name = `D${pinName}`;
    const net = this.nl.nodeNet.get(`${partId}:${name}`);
    if (!net) return 0;
    for (const [num, node] of this.pinNode) {
      if (node === `${partId}:${name}` && this.netVoltage.has(net)) {
        // A board pin the sketch drives reads back what it drives.
        void num;
        return (this.netVoltage.get(net) ?? 0) >= 2.5 ? 1 : 0;
      }
    }
    return this.readNetDigital(net, false);
  }

  private readNetDigital(net: string, pullup: boolean): number {
    for (const inst of this.partsOnNet(net)) {
      const def = getPart(inst.type);
      if (!def) continue;

      if (def.adapter === 'button') {
        const pressed = this.inputValue(inst) !== 0;
        if (!pressed) {
          // Open switch: the pin sits at its pull-up level, or floats low.
          return pullup ? 1 : 0;
        }
        // Closed switch: the pin takes the level of the other side of the button.
        const other = def.pins.find((p) => p.name !== this.pinNameOnNet(inst, net));
        if (!other) return 0;
        const otherNet = this.nl.nodeNet.get(`${inst.id}:${other.name}`);
        if (!otherNet) return 0;
        const otherNetInfo = this.nl.nets.get(otherNet);
        if (otherNetInfo?.isGround) return 0;
        if (otherNetInfo?.isPower) return 1;
        return 0;
      }

      if (def.adapter === 'sensor-value') {
        return this.sensorDigital(inst, def, net);
      }

      if (def.adapter === 'chip') {
        const level = this.chipOutput(inst, net);
        if (level !== null) return level;
      }
    }
    const v = this.netVoltageOf(net);
    if (v === 0 && !this.netVoltage.has(net) && pullup) return 1;
    return v >= 2.5 ? 1 : 0;
  }

  /**
   * The digital output of a modelled sensor. Toggle controls (motion, touch,
   * vibration) read as 0/1 directly; analog controls cross a mid-scale
   * threshold. IR obstacle modules are active LOW, like the real LM393 boards.
   */
  private sensorDigital(inst: PartInstance, def: PartDef, net?: string): number {
    // A line-follower array: each channel D1..D5 reports whether it is over
    // the line. Position -2 puts the line under D1, 0 under D3, 2 under D5.
    if (def.defaults?.sensor === 'line' && net) {
      const pin = this.pinNameOnNet(inst, net);
      const channel = pin ? /^D(\d)$/.exec(pin)?.[1] : undefined;
      if (channel) return Number(channel) === Math.round(this.inputValue(inst)) + 3 ? 1 : 0;
    }
    const control = def.controls[0];
    const value = this.inputValue(inst);
    const toggle = control?.kind === 'toggle' || control?.kind === 'button';
    const active = toggle ? value !== 0 : value > 512;
    const activeLow = def.defaults?.activeLow ?? def.defaults?.sensor === 'ir';
    return activeLow ? (active ? 0 : 1) : active ? 1 : 0;
  }

  /** Ask a custom chip what it drives onto a net, if it drives anything. */
  private chipOutput(inst: PartInstance, netId: string): number | null {
    const chip = chipById(inst.type);
    const pin = this.pinNameOnNet(inst, netId);
    if (!chip || !pin) return null;
    const def = getPart(inst.type);
    // An unpowered chip drives nothing.
    for (const p of def?.pins ?? []) {
      if (p.electrical !== 'power' && p.electrical !== 'ground') continue;
      const n = this.nl.nodeNet.get(`${inst.id}:${p.name}`);
      const info = n ? this.nl.nets.get(n) : undefined;
      if (p.electrical === 'power' && !info?.isPower) return null;
      if (p.electrical === 'ground' && !info?.isGround) return null;
    }
    const netFor = (name: string) => this.nl.nodeNet.get(`${inst.id}:${name}`);
    return evaluateChip(chip, pin, {
      digital: (name) => {
        const n = netFor(name);
        return n !== undefined && this.netVoltageOf(n) >= 2.5 ? 1 : 0;
      },
      analog: (name) => {
        const n = netFor(name);
        return n === undefined ? 0 : this.analogOnNet(n, inst.id);
      },
      control: (id) => {
        const raw =
          this.doc.sim.inputs[`${inst.id}.${id}`] ??
          this.doc.sim.inputs[id] ??
          inst.attrs[id] ??
          def?.controls.find((c) => c.id === id)?.default ??
          0;
        return typeof raw === 'number' ? raw : Number(raw) || 0;
      },
      nowUs: () => this.clock,
    });
  }

  /** The analog reading a net would give, ignoring one part (the reader). */
  private analogOnNet(netId: string, exceptPart?: string): number {
    for (const other of this.partsOnNet(netId)) {
      if (other.id === exceptPart) continue;
      const def = getPart(other.type);
      if (def?.adapter === 'potentiometer') return Math.round(this.inputValue(other, 'potentiometer'));
      if (def?.adapter === 'sensor-value') return Math.max(0, Math.min(1023, Math.round(this.inputValue(other))));
    }
    const v = this.netVoltageOf(netId);
    return Math.round((Math.max(0, Math.min(5, v)) / 5) * 1023);
  }

  private pinNameOnNet(inst: PartInstance, netId: string): string | undefined {
    for (const node of this.nl.nets.get(netId)?.nodes ?? []) {
      if (node.startsWith(`${inst.id}:`)) return node.slice(inst.id.length + 1);
    }
    return undefined;
  }

  analogRead(pin: number): number {
    const net = this.netOfPin(pin);
    if (!net) return 0;
    for (const inst of this.partsOnNet(net)) {
      const def = getPart(inst.type);
      if (!def) continue;
      if (def.adapter === 'potentiometer') {
        return Math.round(this.inputValue(inst, 'potentiometer'));
      }
      if (def.adapter === 'sensor-value') {
        const value = this.inputValue(inst);
        return Math.max(0, Math.min(1023, Math.round(value)));
      }
    }
    return this.analogOnNet(net);
  }

  analogWrite(pin: number, value: number): void {
    const net = this.netOfPin(pin);
    if (!net) return;
    const duty = Math.max(0, Math.min(255, value));
    this.netDuty.set(net, duty);
    this.netVoltage.set(net, (duty / 255) * 5);
    this.updateOutputs(net);
    this.sampleInstruments();
  }

  pulseIn(pin: number, level: number, timeoutUs: number): number {
    const net = this.netOfPin(pin);
    if (!net) return 0;
    for (const inst of this.partsOnNet(net)) {
      const def = getPart(inst.type);
      if (!def) continue;
      if (def.id === 'hc-sr04' || def.id === 'emu-hc-sr04') {
        const cm = this.inputValue(inst, 'hcSr04Distance');
        // 58 µs per centimetre of round trip, which is the physics of sound.
        return Math.round(cm * 58);
      }
    }
    void level;
    void timeoutUs;
    return 0;
  }

  tone(pin: number, frequency: number, durationMs: number): void {
    const net = this.netOfPin(pin);
    if (!net) return;
    for (const inst of this.partsOnNet(net)) {
      const def = getPart(inst.type);
      if (def?.adapter === 'buzzer') this.buzzerFreq.set(inst.id, frequency);
    }
    if (durationMs > 0) {
      setTimeout(() => this.noTone(pin), Math.min(durationMs, 5000)).unref?.();
    }
    this.updateOutputs(net);
    void durationMs;
  }

  noTone(pin: number): void {
    const net = this.netOfPin(pin);
    if (!net) return;
    for (const inst of this.partsOnNet(net)) {
      const def = getPart(inst.type);
      if (def?.adapter === 'buzzer') this.buzzerFreq.delete(inst.id);
    }
  }

  /**
   * Accept text from the sketch. Incomplete lines are held until the newline
   * arrives, so the Serial panel shows whole lines exactly as a monitor would.
   */
  serialPrint(text: string): void {
    if (!text) return;
    let i = 0;
    while (i <= text.length) {
      const nl = text.indexOf('\n', i);
      const chunk = nl === -1 ? text.slice(i) : text.slice(i, nl);
      if (!this.pendingLine) this.pendingLine = { at: this.clock, text: '' };
      this.pendingLine.text += chunk;
      if (nl === -1) break;
      const line: SerialLine = { at: this.pendingLine.at, text: `${this.pendingLine.text}\n` };
      this.serialBuffer.push(line);
      this.serialLog.push(line);
      this.serialTotal++;
      this.pendingLine = null;
      i = nl + 1;
    }
    if (this.serialBuffer.length > 500) this.serialBuffer.splice(0, this.serialBuffer.length - 500);
    if (this.serialLog.length > 600) this.serialLog.splice(0, this.serialLog.length - 600);
  }

  /** Text printed since the last newline, not yet a complete line. */
  get pendingText(): string {
    return this.pendingLine?.text ?? '';
  }

  serialAvailable(): number {
    return this.serialIn.length;
  }

  serialRead(): number {
    if (!this.serialIn) return -1;
    const code = this.serialIn.charCodeAt(0);
    this.serialIn = this.serialIn.slice(1);
    return code;
  }

  serialPeek(): number {
    return this.serialIn ? this.serialIn.charCodeAt(0) : -1;
  }

  pushSerialInput(text: string): void {
    this.serialIn += text;
  }

  servoAttach(pin: number): void {
    void pin;
  }

  servoWrite(pin: number, microseconds: number): void {
    const net = this.netOfPin(pin);
    if (!net) return;
    for (const inst of this.partsOnNet(net)) {
      const def = getPart(inst.type);
      if (def?.adapter === 'servo') {
        const min = Number(inst.attrs.minPulse ?? def.defaults?.minPulse ?? 544);
        const max = Number(inst.attrs.maxPulse ?? def.defaults?.maxPulse ?? 2400);
        const t = (microseconds - min) / (max - min);
        this.servoAngles.set(inst.id, Math.max(0, Math.min(180, t * 180)));
      }
    }
  }

  servoDetach(pin: number): void {
    void pin;
  }

  lcdCommand(address: number, command: string, args: unknown[]): void {
    const target = this.findDisplay('lcd', address) ?? this.firstDisplay('lcd');
    if (!target) return;
    const buf = this.lcds.get(target.id) ?? {
      lines: [],
      row: 0,
      col: 0,
      backlight: true,
      cols: 16,
      rows: 2,
    };
    const def = getPart(target.type);
    buf.cols = Number(def?.defaults?.cols ?? 16);
    buf.rows = Number(def?.defaults?.rows ?? 2);
    while (buf.lines.length < buf.rows) buf.lines.push('');

    switch (command) {
      case 'clear':
        buf.lines = new Array(buf.rows).fill('');
        buf.row = 0;
        buf.col = 0;
        break;
      case 'home':
        buf.row = 0;
        buf.col = 0;
        break;
      case 'setCursor': {
        buf.col = Number(args[0] ?? 0);
        buf.row = Number(args[1] ?? 0);
        break;
      }
      case 'backlight':
        buf.backlight = true;
        break;
      case 'noBacklight':
        buf.backlight = false;
        break;
      case 'print': {
        const text = String(args[0] ?? '');
        this.writeInto(buf, text);
        break;
      }
      default:
        break;
    }
    this.lcds.set(target.id, buf);
  }

  private writeInto(buf: LcdBuffer, text: string): void {
    for (const ch of text) {
      if (ch === '\n') {
        buf.row = Math.min(buf.rows - 1, buf.row + 1);
        buf.col = 0;
        continue;
      }
      const line = buf.lines[buf.row] ?? '';
      const padded = line.padEnd(buf.col, ' ');
      buf.lines[buf.row] = (padded + ch).slice(0, buf.cols);
      buf.col = Math.min(buf.cols - 1, buf.col + 1);
    }
  }

  oledCommand(command: string, args: unknown[]): void {
    const target = this.firstDisplay('oled');
    if (!target) return;
    const lines = this.oleds.get(target.id) ?? [];
    switch (command) {
      case 'render': {
        // Firmware decoder path: the bus decoder recovered concrete text lines
        // from the framebuffer; replace wholesale (equivalent to clear+print).
        const recovered = Array.isArray(args[0]) ? (args[0] as unknown[]).map(String) : [];
        this.oleds.set(target.id, recovered);
        break;
      }
      case 'clearDisplay':
        this.oleds.set(target.id, []);
        break;
      case 'print': {
        const text = String(args[0] ?? '');
        if (lines.length === 0) lines.push('');
        lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + text;
        this.oleds.set(target.id, lines);
        break;
      }
      case 'println': {
        const text = String(args[0] ?? '');
        if (lines.length === 0) lines.push('');
        lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + text;
        lines.push('');
        this.oleds.set(target.id, lines);
        break;
      }
      case 'setCursor':
      case 'setTextSize':
      case 'setTextColor':
      case 'display':
      case 'begin':
        break;
      default:
        break;
    }
  }

  private findDisplay(kind: 'lcd' | 'oled', address: number): PartInstance | undefined {
    return this.doc.diagram.parts.find((inst) => {
      const def = getPart(inst.type);
      if (def?.adapter !== kind) return false;
      return Number(def.defaults?.address ?? 0) === address;
    });
  }

  private firstDisplay(kind: 'lcd' | 'oled'): PartInstance | undefined {
    return this.doc.diagram.parts.find((inst) => getPart(inst.type)?.adapter === kind);
  }

  sensorRead(kindOf: string, pin: number): number {
    if (kindOf === 'dhtTemperature' || kindOf === 'dhtHumidity') {
      const inst = this.doc.diagram.parts.find((p) => {
        const def = getPart(p.type);
        return def?.defaults?.sensor === 'dht11' || def?.defaults?.sensor === 'dht22';
      });
      if (inst) return this.inputValue(inst, kindOf);
      return this.doc.sim.inputs[kindOf] ?? (kindOf === 'dhtTemperature' ? 27 : 55);
    }
    void pin;
    return this.doc.sim.inputs[kindOf] ?? 0;
  }

  attachInterrupt(pin: number, mode: string, handler: () => void): void {
    const target = this.interruptPin(pin);
    this.interrupts.set(target, { mode, handler, last: this.levelOfPin(target) });
  }

  detachInterrupt(pin: number): void {
    this.interrupts.delete(this.interruptPin(pin));
  }

  /**
   * digitalPinToInterrupt(pin) hands us the pin itself. Older sketches pass the
   * interrupt number instead: on an Uno or Nano, INT0 is pin 2 and INT1 pin 3.
   * Pins 0 and 1 are the serial port there, so the two cannot be confused.
   */
  private interruptPin(n: number): number {
    const unoLike = Number(this.boardDef?.defaults?.analogBase ?? 14) === 14;
    return unoLike && (n === 0 || n === 1) ? n + 2 : n;
  }

  private levelOfPin(pin: number): number {
    const pullup = this.pinModes.get(pin) === INPUT_PULLUP;
    const net = this.netOfPin(pin);
    if (!net) return pullup ? 1 : 0;
    return this.readNetDigital(net, pullup);
  }

  /** Fire any interrupt whose pin has seen the edge it is waiting for. */
  pollInterrupts(): void {
    if (this.inIsr || this.interrupts.size === 0) return;
    for (const [pin, irq] of this.interrupts) {
      const now = this.levelOfPin(pin);
      if (now === irq.last) continue;
      irq.last = now;
      const fire =
        irq.mode === 'CHANGE' || (irq.mode === 'RISING' && now === 1) || (irq.mode === 'FALLING' && now === 0);
      if (!fire) continue;
      this.inIsr = true;
      try {
        irq.handler();
      } catch (err) {
        this.isrError ??= err;
      } finally {
        this.inIsr = false;
      }
    }
  }

  randomFloat(): number {
    // xorshift32, seeded, so a run is reproducible.
    let x = this.rngState || 1;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0 || 1;
    return (this.rngState - 1) / 0xffffffff;
  }

  seedRandom(seed: number): void {
    this.rngState = seed >>> 0 || 1;
  }

  analogBase(): number {
    return Number(this.boardDef?.defaults?.analogBase ?? 14);
  }

  unsupported(api: string): void {
    if (!this.unsupportedCalls.has(api)) {
      this.unsupportedCalls.add(api);
      this.notes.push(api);
    }
  }

  drainNotes(): string[] {
    const n = this.notes;
    this.notes = [];
    return n;
  }

  /* -------------------------------------------------------------- updates */

  private updateOutputs(netId: string): void {
    const voltage = this.netVoltage.get(netId) ?? 0;
    const duty = this.netDuty.get(netId) ?? 0;
    for (const inst of this.partsOnNet(netId)) {
      const def = getPart(inst.type);
      if (!def) continue;
      const pin = this.pinNameOnNet(inst, netId);
      switch (def.adapter) {
        case 'relay': {
          const activeLow = inst.attrs.activeLow ?? def.defaults?.activeLow ?? true;
          const signalHigh = voltage >= 2.5;
          break;
        }
        case 'motor': {
          this.motorSpeed.set(inst.id, voltage >= 2.5 ? duty / 255 : 0);
          break;
        }
        default:
          break;
      }
      void pin;
      void duty;
    }
  }

  /** Build the render state for every part on the canvas. */
  snapshot(): Record<string, PartState> {
    const out: Record<string, PartState> = {};
    for (const inst of this.doc.diagram.parts) {
      const def = getPart(inst.type);
      if (!def) continue;
      out[inst.id] = this.stateFor(inst, def);
    }
    return out;
  }

  private netLevel(inst: PartInstance, pinNames: string[]): { voltage: number; duty: number } {
    for (const name of pinNames) {
      const net = this.nl.nodeNet.get(`${inst.id}:${name}`);
      if (!net) continue;
      const voltage = this.netVoltageOf(net);
      const driven = this.netDuty.get(net);
      const duty = driven ?? (voltage >= 2.5 ? 255 : 0);
      return { voltage, duty };
    }
    return { voltage: 0, duty: 0 };
  }

  /**
   * The voltage on a net: whatever the sketch last drove onto it, otherwise the
   * rail it is tied to. An LED wired from 5V through a resistor is lit without
   * a line of code, exactly as on the bench.
   */
  private netVoltageOf(netId: string, seen: Set<string> = new Set([netId])): number {
    const driven = this.netVoltage.get(netId);
    if (driven !== undefined) return driven;
    const info = this.nl.nets.get(netId);
    if (info?.isPower && info.voltage !== null) return info.voltage;
    return this.contactVoltage(netId, seen) ?? 0;
  }

  /**
   * Voltage reaching a net through closed relay contacts. COM joins NO while
   * the relay is energised and NC while it is not, exactly like the module on
   * the bench, so a lamp wired COM -> 5V, NO -> resistor -> LED really switches.
   */
  private contactVoltage(netId: string, seen: Set<string>): number | null {
    for (const inst of this.partsOnNet(netId)) {
      const def = getPart(inst.type);
      if (def?.adapter !== 'relay') continue;
      for (const pin of def.pins) {
        if (this.nl.nodeNet.get(`${inst.id}:${pin.name}`) !== netId) continue;
        const m = /^(NO|NC|COM)(\d*)$/.exec(pin.name);
        if (!m) continue;
        const role = m[1];
        const channel = m[2] ?? '';
        const closed = this.relayClosed(inst, def, channel);
        const other =
          role === 'COM' ? (closed ? `NO${channel}` : `NC${channel}`) : role === 'NO' ? (closed ? `COM${channel}` : null) : closed ? null : `COM${channel}`;
        if (!other) continue;
        const otherNet = this.nl.nodeNet.get(`${inst.id}:${other}`);
        if (!otherNet || seen.has(otherNet)) continue;
        seen.add(otherNet);
        const v = this.netVoltageOf(otherNet, seen);
        if (v > 0) return v;
      }
    }
    return null;
  }

  /** Whether a relay channel is energised, i.e. COM is switched to NO. */
  private relayClosed(inst: PartInstance, def: PartDef, channel = ''): boolean {
    const activeLow = inst.attrs.activeLow ?? def.defaults?.activeLow ?? true;
    const inName = def.pins.some((p) => p.name === `IN${channel}`) ? `IN${channel}` : 'IN';
    const inNet = this.nl.nodeNet.get(`${inst.id}:${inName}`);
    const driven = inNet !== undefined && this.netVoltage.has(inNet);
    // Relay modules pull IN up on the board, so a disconnected or undriven
    // IN reads HIGH: an active-LOW relay stays off until the sketch drives it.
    const inputHigh =
      inNet !== undefined && (driven || this.nl.nets.get(inNet)?.isPower)
        ? (this.netVoltage.get(inNet) ?? this.nl.nets.get(inNet)?.voltage ?? 0) >= 2.5
        : true;
    // The coil needs a real supply on every power pin and a real ground on
    // every ground pin. Being present in the netlist is not the same thing.
    const coilPowered = def.pins.every((p) => {
      if (p.electrical !== 'power' && p.electrical !== 'ground') return true;
      const n = this.nl.nodeNet.get(`${inst.id}:${p.name}`);
      const info = n ? this.nl.nets.get(n) : undefined;
      return p.electrical === 'power' ? info?.isPower === true : info?.isGround === true;
    });
    const energised = activeLow ? !inputHigh : inputHigh;
    return coilPowered && energised;
  }

  /** True when a part's return pin really reaches ground, so current can flow. */
  private returnsToGround(inst: PartInstance, def: PartDef): boolean {
    const ground = def.pins.find((p) => p.electrical === 'ground');
    if (!ground) return true;
    const net = this.nl.nodeNet.get(`${inst.id}:${ground.name}`);
    if (!net) return false;
    const info = this.nl.nets.get(net);
    if (info?.isGround) return true;
    // A cathode driven LOW by a board pin is a legitimate current sink.
    return this.netVoltage.get(net) === 0 && this.isBoardDriven(net);
  }

  private isBoardDriven(netId: string): boolean {
    for (const [, node] of this.pinNode) {
      if (this.nl.nodeNet.get(node) === netId) return true;
    }
    return false;
  }

  private stateFor(inst: PartInstance, def: PartDef): PartState {
    switch (def.adapter) {
      case 'led': {
        const { voltage, duty } = this.netLevel(inst, ['A', '+']);
        const colour = String(inst.attrs.colour ?? def.defaults?.colour ?? '#e63946');
        // No return path, no current, no light - however high the anode is.
        const closed = this.returnsToGround(inst, def);
        const level = duty > 0 && duty < 255 ? duty / 255 : voltage >= 2.5 ? 1 : 0;
        const brightness = closed ? level : 0;
        return { kind: 'led', on: brightness > 0.02, brightness, colour };
      }
      case 'rgb-led': {
        const r = this.netLevel(inst, ['R']).duty / 255;
        const g = this.netLevel(inst, ['G']).duty / 255;
        const b = this.netLevel(inst, ['B']).duty / 255;
        return { kind: 'rgb', r, g, b };
      }
      case 'servo':
        return { kind: 'servo', angle: this.servoAngles.get(inst.id) ?? 90 };
      case 'relay': {
        const channel = def.pins.some((p) => p.name === 'IN') ? '' : '1';
        return { kind: 'relay', closed: this.relayClosed(inst, def, channel) };
      }
      case 'buzzer': {
        const freq = this.buzzerFreq.get(inst.id);
        const { voltage } = this.netLevel(inst, ['+', '1', 'SIG']);
        return {
          kind: 'buzzer',
          active: freq !== undefined || voltage >= 2.5,
          frequency: freq ?? 440,
        };
      }
      case 'motor':
        return { kind: 'motor', speed: this.motorSpeed.get(inst.id) ?? 0 };
      case 'lcd': {
        const buf = this.lcds.get(inst.id);
        return {
          kind: 'lcd',
          lines: buf?.lines ?? [],
          backlight: buf?.backlight ?? true,
          cols: Number(def.defaults?.cols ?? 16),
          rows: Number(def.defaults?.rows ?? 2),
        };
      }
      case 'oled':
        return { kind: 'oled', lines: this.oleds.get(inst.id) ?? [] };
      case 'matrix':
        return {
          kind: 'matrix',
          cells: this.powered(inst, def) ? (this.matrices.get(inst.id)?.decoder.cells ?? new Array(64).fill(false)) : new Array(64).fill(false),
        };
      case 'seven-seg': {
        let segments = 0;
        if (inst.attrs.common !== 'anode' && this.returnsToGround(inst, def)) {
          SEGMENT_PINS.forEach((pin, bit) => {
            const net = this.nl.nodeNet.get(`${inst.id}:${pin}`);
            if (net && !this.nl.nets.get(net)?.isGround && this.netVoltageOf(net) >= 2.5) segments |= 1 << bit;
          });
        }
        return { kind: 'seven-seg', segments, value: sevenSegmentValue(segments) };
      }
      case 'stepper': {
        const decoded = this.steppers.get(inst.id)?.decoder.state;
        return {
          kind: 'stepper',
          coils: decoded?.coils ?? null,
          transitions: decoded?.transitions ?? 0,
          sequence: decoded?.sequence ?? null,
          phase: decoded?.phase ?? null,
          powered: this.powered(inst, def),
        };
      }
      case 'logic-analyzer': {
        const capture = this.logicCaptures.get(inst.id);
        return { kind: 'logic-analyzer', grounded: capture?.grounded ?? this.logicGrounded(inst.id),
          levels: capture?.levelsNow ?? Array<LogicLevel>(8).fill('x'),
          edges: capture?.eventCount ?? 0, dropped: capture?.droppedCount ?? 0 };
      }
      case 'sensor-value':
      case 'potentiometer': {
        const name = this.inputNameFor(inst);
        return {
          kind: 'sensor',
          value: this.inputValue(inst),
          unit: def.controls[0]?.unit ?? '',
          label: name ?? def.name,
        };
      }
      case 'board': {
        const pins: Record<string, number> = {};
        for (const [num, node] of this.pinNode) {
          const net = this.nl.nodeNet.get(node);
          pins[String(num)] = net ? (this.netVoltage.get(net) ?? 0) : 0;
        }
        return { kind: 'board', pins };
      }
      default:
        return { kind: 'none' };
    }
  }
}
