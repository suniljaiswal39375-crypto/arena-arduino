/**
 * FirmwareEngine — the hardware-accurate AVR execution slice (Phase 10, AVR).
 *
 * Pipeline: ProjectDoc + compiled Intel HEX -> ATmega328P sandbox (avr8js) ->
 * instruction-by-instruction execution under a deterministic virtual clock,
 * with board pins, downstream part state and serial all rendered through the
 * *same* `Circuit` model the functional engine uses.
 *
 * Parity by construction: when a sketch toggles D13, avr8js flips PB5 and this
 * engine calls `circuit.digitalWrite(13, …)` — the identical call the
 * interpreter makes — so an LED, relay or buzzer on that net renders once, one
 * way, for both engines. The differential test in
 * `parity/blink-parity.test.ts` asserts that observable behaviour.
 *
 * One `run(realMs)` is one worker frame. The AVR slice is host-bounded: a
 * documented I/O shim (see README.md "Determinism and the shim") lets a
 * `delay()` advance virtual time without executing all of its busy-wait cycles,
 * and an instruction budget caps every frame, so a `while(1){}` can never stall
 * the thread — the same watchdog role the functional engine's op counter plays.
 */
import type { ProjectDoc } from '@/lib/doc/types';
import { getPart } from '@/lib/parts';
import { Circuit, type PartState, type SerialLine } from '../runtime';
import { INPUT, INPUT_PULLUP, OUTPUT } from '../host';
import {
  avrBoardFor,
  parseIntelHex,
  prepareAvrProgram,
  step,
  HexError,
  BRIDGE_DELAY_FLAG,
  BRIDGE_DELAY_TARGET,
  BRIDGE_MS,
  readU32,
  writeU32,
  type AvrBoard,
  type AvrSandbox,
  type IntelHexImage,
} from './avr';
import type { FirmwareStatus, FirmwareSnapshot } from './interfaces';
import { I2cLcdDecoder, Ssd1306Decoder, type I2cLcdEvent, type TwiEvent } from './peripherals';
import { timer1ServoFromRegisters, OC1A_PIN, OC1B_PIN } from './servo';

export const FW_LIMITS = {
  /** Instructions per debt-loop segment (mirrors the interpreter's OP_BUDGET yield). */
  segmentInstructions: 100,
  /** Virtual µs credited to a segment that delayed nothing (mirrors IDLE_US). */
  idleUs: 1000,
  /** Outer instruction guard for pathological firmware (mirrors tick's guard). */
  maxSegments: 20_000,
  /** Plotter window, matching the functional engine. */
  maxPlotPoints: 240,
  /** Serial log cap, matching the functional engine. */
  serialCapLines: 600,
} as const;

/** A shared adapter does not imply that *all* part protocols are decoded. */
function unmodelledAvrPart(type: string, adapter: string): boolean {
  if (adapter === 'chip') return true;
  if (adapter === 'matrix') return type !== 'matrix-8x8-max7219' && type !== 'emu-max7219';
  if (adapter === 'stepper') return type !== 'uln2003' && type !== 'stepper-28byj48';
  return false;
}

export interface FirmwareRun {
  snapshot: FirmwareSnapshot;
  err: string | null;
}

export class FirmwareEngine {
  private doc: ProjectDoc;
  private circuit: Circuit;
  private sandbox: AvrSandbox | null = null;
  private board: AvrBoard | null = null;
  private boardId = '';
  private image: IntelHexImage | null = null;
  private clock = 0;
  /** AVR cycle counter at the start of the instruction segment now executing. */
  private segmentStartCycles: number | null = null;
  private unknownLogicMask = 0;
  private running = false;
  private started = false;
  private instructions = 0;
  private partial = '';
  private unsupported = new Set<string>();
  private plot: number[][] = [];
  private plotLabels: Array<string | undefined> = [];
  private statusKind: FirmwareStatus['kind'] = 'idle';
  private statusDetail = 'no firmware loaded';
  private lastError: string | null = null;
  /** Simulated-time debt carried across frames (mirrors SimEngine.tick's). */
  private debt = 0;
  /** Board pin (arduino number) -> voltage the firmware last drove, 0/5 V. */
  private pinDrive = new Map<number, number>();
  /** Board pins the firmware has set as outputs since the last load. */
  private pinOutputs = new Set<number>();
  private lastHex = '';
  private i2cLcd = new I2cLcdDecoder();
  private pendingLcdEvents: I2cLcdEvent[] = [];
  /** Per-address SSD1306 decoders, keyed by 7-bit slave address. */
  private ssd1306 = new Map<number, Ssd1306Decoder>();
  /** Pulse width the last Timer1 servo decode produced, µs, keyed by pin. */
  private lastServoUs = new Map<number, number>();

  constructor(doc: ProjectDoc) {
    this.doc = doc;
    this.circuit = new Circuit(doc);
  }

  /** Re-read the document after an edit. Inputs/wiring change, firmware keeps running. */
  update(doc: ProjectDoc): void {
    this.doc = doc;
    this.circuit.clock = this.clock;
    this.refreshPeripheralProbeMask(true);
    this.circuit.update(doc); // keep latched display RAM and valid phase history if wiring is unchanged
    this.pinDrive.clear();
    this.pinOutputs.clear();
    this.refreshUnsupported();
    this.syncPinModel();
  }

  /* --------------------------------------------------------------- load -- */

  /**
   * Load a compiled Intel HEX image for a board. Throws with a readable,
   * non-leaky message when the image or board is not runnable.
   */
  load(doc: ProjectDoc, hex: string, boardType: string): void {
    this.doc = doc;
    const board = avrBoardFor(boardType);
    if (!board) throw new Error(`board '${boardType}' has no AVR firmware model`);
    const image = parseIntelHex(hex);
    if (image.addressSpace > board.flashBytes) {
      throw new HexError(
        `firmware image needs ${image.addressSpace} bytes of flash; ${board.chip} has ${board.flashBytes}`,
      );
    }
    const sandbox = prepareAvrProgram(image);
    sandbox.usart.onByteTransmit = (value) => this.onUsartByte(value);
    sandbox.usart.onLineTransmit = null;
    this.i2cLcd = new I2cLcdDecoder();
    this.pendingLcdEvents = [];
    this.ssd1306.clear();
    for (const part of doc.diagram.parts) {
      const def = getPart(part.type);
      if (def?.adapter === 'oled') {
        const address = Number(def.defaults?.address ?? 60);
        if (!this.ssd1306.has(address)) this.ssd1306.set(address, new Ssd1306Decoder(address));
      }
    }
    const twi = sandbox.twi;
    twi.eventHandler = {
      // A real PCF8574 keeps ACKing every byte; complete the peripheral
      // handshake so the TWI state machine advances and TWINT rises for the
      // firmware's polling loop.
      start: () => {
        twi.completeStart();
        this.onTwi({ kind: 'start' });
      },
      stop: () => {
        twi.completeStop();
        this.onTwi({ kind: 'stop' });
      },
      connectToSlave: (addr, write) => {
        twi.completeConnect(true);
        this.onTwi({ kind: 'connect', addr, write });
      },
      writeByte: (value) => {
        twi.completeWrite(true);
        this.onTwi({ kind: 'write', value });
      },
      readByte: () => twi.completeRead(0xff),
    };
    const spi = sandbox.spi;
    spi.onByte = (value) => {
      const mode = spi.spiMode;
      const order = spi.dataOrder;
      // The byte reaches MOSI only at the end of a real SPI transfer. The
      // avr8js SPI clock event also raises SPIF so polling firmware advances.
      sandbox.cpu.addClockEvent(() => {
        if (spi.isMaster) this.circuit.hardwareSpiByte(value, mode, order);
        spi.completeTransfer(0xff); // no MISO device model is connected
      }, spi.transferCycles);
    };

    this.sandbox = sandbox;
    this.board = board;
    this.image = image;
    this.lastHex = hex;
    this.clock = 0;
    this.segmentStartCycles = null;
    this.unknownLogicMask = 0;
    this.debt = 0;
    this.partial = '';
    this.instructions = 0;
    this.unsupported = new Set();
    this.plot = [];
    this.plotLabels = [];
    this.pinDrive.clear();
    this.pinOutputs.clear();
    this.lastServoUs.clear();
    this.circuit = new Circuit(doc);
    // Port listeners observe every firmware OUT/SBI/CBI/DDR write, including
    // sub-frame CLK and coil edges. Sampling only at run()'s end would silently
    // lose all 16 MAX7219 clock edges and intermediate stepper phases.
    for (const port of ['B', 'C', 'D'] as const) {
      sandbox.ports[port].addListener(() => this.onPortChanged(port));
    }

    const boardInst = doc.diagram.parts.find((p) => getPart(p.type)?.adapter === 'board');
    this.boardId = boardInst?.id ?? '';

    this.refreshUnsupported();

    this.statusKind = 'idle';
    this.statusDetail = 'firmware compiled and staged';
    this.lastError = null;
    this.syncPinModel(); // seed the ADC/GPIO inputs before firmware's first instruction
  }

  start(): void {
    if (!this.sandbox) {
      this.statusKind = 'error';
      this.statusDetail = 'no firmware to run';
      return;
    }
    this.running = true;
    this.started = true;
    this.statusKind = 'running';
    this.statusDetail = 'firmware executing';
  }

  stop(): void {
    this.running = false;
    this.statusKind = 'paused';
    this.statusDetail = 'firmware paused';
  }

  reset(): void {
    if (!this.lastHex) return;
    const board = this.boardPartType();
    this.load(this.doc, this.lastHex, board);
    this.start();
  }

  private boardPartType(): string {
    const board = this.doc.diagram.parts.find((p) => getPart(p.type)?.adapter === 'board');
    return board?.type ?? 'arduino-uno';
  }

  private refreshUnsupported(): void {
    this.unsupported.clear();
    for (const part of this.doc.diagram.parts) {
      const def = getPart(part.type);
      if (def && unmodelledAvrPart(part.type, def.adapter)) {
        this.unsupported.add(`${part.type} (${def.name}): no AVR decoder for this part; no output inferred`);
      }
    }
  }

  /* ------------------------------------------------------------ serial --- */

  private onUsartByte(value: number): void {
    const sandbox = this.sandbox;
    if (!sandbox?.usart.txEnable) return;
    const format = sandbox.cpu.data[0xc2] ?? 0;
    if (sandbox.usart.bitsPerChar !== 8 || (format & 0xf8) !== 0) {
      this.unsupported.add('USART0: only asynchronous 8N1 TX bytes are decoded; non-8N1 frame ignored');
      return;
    }
    if (value > 0x7f) {
      this.unsupported.add('USART0: non-ASCII/UTF-8 byte stream is not decoded; byte ignored');
      return;
    }
    if (value === 0x0a || value === 0x0d) {
      this.flushSerialLine();
      return;
    }
    this.partial += String.fromCharCode(value);
  }

  /* ------------------------------------------------------------- twi/i2c -- */

  private onTwi(event: TwiEvent): void {
    this.pendingLcdEvents.push(...this.i2cLcd.onEvent(event));
    for (const decoder of this.ssd1306.values()) decoder.onEvent(event);
  }

  /** Apply decoded I2C LCD events to the shared circuit once per frame. */
  private drainI2cLcdEvents(): void {
    for (const event of this.pendingLcdEvents) {
      this.circuit.lcdCommand(event.address, event.command, event.args);
    }
    this.pendingLcdEvents = [];
  }

  /** Apply decoded SSD1306 text (when the framebuffer changed) once per frame. */
  private drainOledEvents(): void {
    for (const decoder of this.ssd1306.values()) {
      for (const event of decoder.takeEvents()) {
        this.circuit.oledCommand(event.command, event.args);
      }
    }
  }

  /**
   * Read Timer1's real register state and, when it is in the Servo library's
   * Fast-PWM mode 14, translate the compare values into the pulse widths the
   * shared circuit's servo sees — exactly how the functional engine's
   * `Servo.write(us)` reaches the same part.
   */
  private drainServo(): void {
    const sandbox = this.sandbox;
    if (!sandbox) return;
    const { pin9Us, pin10Us } = timer1ServoFromRegisters(sandbox.cpu.data);
    this.applyServoPulse(OC1A_PIN, pin9Us);
    this.applyServoPulse(OC1B_PIN, pin10Us);
  }

  private applyServoPulse(pin: number, us: number | null): void {
    if (us === null) return; // not a servo signal on this pin
    if (us < 500) return; // below any real servo's minimum pulse: not attached
    if (this.lastServoUs.get(pin) === us) return; // unchanged: no write churn
    this.lastServoUs.set(pin, us);
    this.circuit.servoWrite(pin, us);
  }

  private flushSerialLine(): void {
    if (!this.partial) return;
    // The USART delivered a real line terminator byte; commit the line with a
    // newline so Circuit's serial log (which lines up exactly) records it.
    this.circuit.serialPrint(`${this.partial}\n`);
    this.partial = '';
    this.harvestPlot();
  }

  /** Plot harvesting, identical rules to the functional engine's. */
  private harvestPlot(): void {
    const lines = this.circuit.serialBuffer;
    for (const line of lines) {
      const text = line.text.replace(/\r?\n$/, '');
      const tokens = text.split(/[\s,]+/).filter(Boolean);
      if (tokens.length === 0) continue;
      const nums: number[] = [];
      let pendingLabel: string | null = null;
      for (const token of tokens) {
        const n = Number(token);
        if (Number.isFinite(n)) {
          const index = nums.length;
          if (pendingLabel !== null && this.plotLabels[index] === undefined) {
            this.plotLabels[index] = pendingLabel;
          }
          nums.push(n);
          pendingLabel = null;
          continue;
        }
        if (token.endsWith(':')) pendingLabel = token.slice(0, -1);
      }
      if (nums.length === 0) continue;
      while (this.plot.length < nums.length) this.plot.push([]);
      nums.forEach((n, idx) => {
        const series = this.plot[idx];
        if (series) {
          series.push(n);
          if (series.length > FW_LIMITS.maxPlotPoints) series.shift();
        }
      });
    }
    this.circuit.serialBuffer.length = 0;
  }

  /* --------------------------------------------------------- pin model -- */

  /** Cycle position within this virtual debt-loop segment, not the UI frame. */
  private currentCycleTimeUs(): number {
    const cpu = this.sandbox?.cpu;
    return this.clock + (cpu && this.segmentStartCycles !== null
      ? (cpu.cycles - this.segmentStartCycles) / 16 : 0);
  }

  /**
   * GPIO port writes are captured; peripheral waveforms are NOT. Do not turn
   * timer PWM, SPI SCK/MOSI, USART TX or TWI SDA/SCL into a fictitious constant
   * 0/1 just because the DDR/PORT latch has that value. Observe control
   * registers after each executed instruction when a probe is present so a
   * mid-frame peripheral enable becomes X at its actual virtual time.
   */
  private refreshPeripheralProbeMask(force = false): void {
    const cpu = this.sandbox?.cpu;
    if (!cpu) return;
    const d = cpu.data;
    let mask = 0;
    if ((d[0x44] ?? 0) & 0xc0) mask |= 1 << 6;  // Timer0 OC0A
    if ((d[0x44] ?? 0) & 0x30) mask |= 1 << 5;  // Timer0 OC0B
    if ((d[0x80] ?? 0) & 0xc0) mask |= 1 << 9;  // Timer1 OC1A
    if ((d[0x80] ?? 0) & 0x30) mask |= 1 << 10; // Timer1 OC1B
    if ((d[0xb0] ?? 0) & 0xc0) mask |= 1 << 11; // Timer2 OC2A
    if ((d[0xb0] ?? 0) & 0x30) mask |= 1 << 3;  // Timer2 OC2B
    if ((d[0x4c] ?? 0) & 0x40) mask |= (1 << 11) | (1 << 13); // SPI master pins
    if ((d[0xc1] ?? 0) & 0x08) mask |= 1 << 1;  // USART0 TX
    if ((d[0xbc] ?? 0) & 0x04) mask |= (1 << 18) | (1 << 19); // TWI A4/A5
    if (mask === this.unknownLogicMask && !force) return;
    this.unknownLogicMask = mask;
    this.circuit.clock = this.currentCycleTimeUs();
    const pins = new Set<number>();
    for (let pin = 0; pin < 20; pin++) if (mask & (1 << pin)) pins.add(pin);
    this.circuit.setUnknownLogicPins(pins);
  }

  /**
   * Set the Circuit's pin model from the *authoritative* AVR register state.
   * DDR/PORT decide INPUT / INPUT_PULLUP / OUTPUT; the driven level comes
   * straight from the GPIO port bit.
   */
  private onPortChanged(port: 'B' | 'C' | 'D'): void {
    const sandbox = this.sandbox;
    const board = this.board;
    if (!sandbox || !board) return;
    const updates: Array<{ pin: number; mode: 0 | 1 | 2; level: 0 | 1 }> = [];
    for (const [pinName, mapping] of Object.entries(board.digital)) {
      if (mapping.port !== port) continue;
      const state = sandbox.ports[port].pinState(mapping.bit);
      updates.push({
        pin: Number(pinName),
        mode: state === 0 || state === 1 ? OUTPUT : state === 3 ? INPUT_PULLUP : INPUT,
        level: state === 1 ? 1 : 0,
      });
    }
    // The port listener runs inside avrInstruction, not at a rendered frame.
    // Stamp its *whole port* atomically at the AVR cycle that issued the write.
    // One 16 MHz cycle is 62.5 ns; Circuit exports nearest-nanosecond VCD.
    this.circuit.clock = this.currentCycleTimeUs();
    this.refreshPeripheralProbeMask();
    this.circuit.applyAvrPins(updates);
    // INPUT_PULLUP can be enabled mid-frame. Refresh the external PIN levels
    // before the *next* instruction reads them, not only at worker boundaries.
    this.feedExternalPins();
  }

  private syncPinModel(): void {
    const sandbox = this.sandbox;
    const board = this.board;
    if (!sandbox || !board) return;
    const updates: Array<{ pin: number; mode: 0 | 1 | 2; level: 0 | 1 }> = [];
    for (const pinNum of Object.keys(board.digital).map(Number)) {
      const mapping = board.digital[pinNum];
      if (!mapping) continue;
      const state = sandbox.ports[mapping.port].pinState(mapping.bit);
      if (state === 0 || state === 1) {
        this.pinOutputs.add(pinNum);
        this.pinDrive.set(pinNum, state === 1 ? 5 : 0);
      } else {
        this.pinOutputs.delete(pinNum);
        this.pinDrive.delete(pinNum);
      }
      updates.push({
        pin: pinNum,
        mode: state === 0 || state === 1 ? OUTPUT : state === 3 ? INPUT_PULLUP : INPUT,
        level: state === 1 ? 1 : 0,
      });
    }
    this.circuit.clock = this.clock;
    this.refreshPeripheralProbeMask(true);
    this.circuit.applyAvrPins(updates);

    // ADC: give the AVR the circuit's analogue answer for each channel, in
    // volts (5 V reference), so analogRead() returns the same value as the
    // functional engine for the same sensor/rail.
    for (const channelStr of Object.keys(board.analogChannels)) {
      const channel = Number(channelStr);
      const pinNum = board.analogChannels[channel];
      if (pinNum === undefined) continue;
      const raw = this.circuit.analogRead(pinNum);
      sandbox.adc.channelValues[channel] = ((Math.max(0, Math.min(1023, raw)) / 1024) * 5) as never;
    }
  }

  /** Feed external logical levels into the AVR PIN registers. */
  private feedExternalPins(): void {
    const sandbox = this.sandbox;
    const board = this.board;
    if (!sandbox || !board) return;
    for (const pinNum of Object.keys(board.digital).map(Number)) {
      const mapping = board.digital[pinNum];
      if (!mapping) continue;
      const level = this.circuit.digitalRead(pinNum) !== 0;
      sandbox.ports[mapping.port].setPin(mapping.bit, level);
    }
  }

  /* ------------------------------------------------------------- frame -- */

  /**
   * Advance the virtual clock and execute one bounded instruction frame.
   *
   * This is a faithful port of `SimEngine.tick`'s debt loop with the generator
   * replaced by instruction execution and `delay()` replaced by the firmware's
   * clock-bridge busy-wait. One debt-loop iteration executes firmware until it
   * next calls `delay()` (or one op-budget segment elapses) and then charges
   * the simulated time that work represents:
   *
   *   - a hit `delay(ms)` advances the clock `ms*1000` µs in one step — the
   *     exact credit the interpreter gives `host.advance(ms * 1000)`;
   *   - work that delayed nothing gets the idle credit a tight `loop()` would
   *     consume on hardware (1000 µs per segment, mirroring IDLE_US), plus the
   *     real instruction work at 16 MHz (`cpu.cycles / 16` µs).
   *
   * The observable result is parity by construction: a blink with `delay(500)`
   * samples 5-on / 5-off at a 100 ms tick on both engines.
   */
  run(realMsElapsed: number, speed = 1): FirmwareRun {
    if (!this.sandbox || !this.running) {
      return { snapshot: this.snapshot(), err: this.lastError };
    }

    const cpu = this.sandbox.cpu;
    this.feedExternalPins();

    // Wall-time debt in simulated µs, carried across frames so a delay() can
    // push it negative and pace the next statement over several ticks — the
    // exact behaviour that produces the interpreter's 5-on / 5-off blink.
    this.debt += Math.max(0, realMsElapsed) * 1000 * speed;

    let segments = 0;
    while (this.debt > 0 && segments++ < FW_LIMITS.maxSegments) {
      const before = this.clock;

      if (cpu.data[BRIDGE_DELAY_FLAG] !== 0) {
        // A delay() is mid-flight: complete it by crediting its full span to
        // the clock and advancing the firmware's millis() to the target.
        const target = readU32(cpu.data, BRIDGE_DELAY_TARGET);
        const now = readU32(cpu.data, BRIDGE_MS);
        if (target > now) {
          this.clock += Math.round((target - now) * 1000); // ms -> µs
          writeU32(cpu.data, BRIDGE_MS, target);
        }
        cpu.data[BRIDGE_DELAY_FLAG] = 0; // the while-condition now exits
      } else {
        // Execute until the firmware raises the delay flag (or the segment
        // budget elapses), exactly like the interpreter yielding at delay().
        const cyclesBefore = cpu.cycles;
        this.segmentStartCycles = cyclesBefore;
        try {
          this.instructions += this.executeUntilDelay(cpu);
        } finally {
          this.segmentStartCycles = null;
        }
        // Keep fractional microseconds: rounding a whole segment would erase
        // the cycle timing of sub-frame GPIO edges in the logic analyzer.
        this.clock += (cpu.cycles - cyclesBefore) / 16;
      }

      const consumed = this.clock - before;
      if (consumed <= 0) {
        // A segment that delayed nothing: idle credit so millis() keeps up.
        this.clock += FW_LIMITS.idleUs;
      }
      this.debt -= Math.max(1, this.clock - before);
    }

    // Time the firmware did not consume still passes (functional advanceIdle).
    if (this.debt > 0) {
      this.clock += this.debt;
      this.debt = 0;
    }

    this.syncPinModel();
    this.drainI2cLcdEvents();
    this.drainOledEvents();
    this.drainServo();
    return { snapshot: this.snapshot(), err: null };
  }

  /**
   * Run firmware until `delay()` raises the bridge flag or the segment budget
   * elapses, returning the number of instructions executed. On the delay-hit
   * path the bridge's millis()/target cells are already set to a valid pair
   * (target-first), so the next loop iteration can complete the delay.
   */
  private executeUntilDelay(cpu: AvrSandbox['cpu']): number {
    let ran = 0;
    for (let k = 0; k < FW_LIMITS.segmentInstructions; k++) {
      if (cpu.data[BRIDGE_DELAY_FLAG] !== 0) break;
      step(this.sandbox as AvrSandbox);
      ran++;
      if (this.circuit.hasLogicAnalyzers) this.refreshPeripheralProbeMask();
    }
    return ran;
  }

  /* ----------------------------------------------------------- snapshot -- */

  snapshot(): FirmwareSnapshot {
    const parts: Record<string, PartState> = {};
    if (this.started) {
      const rendered = this.circuit.snapshot();
      for (const [id, state] of Object.entries(rendered)) parts[id] = state;
      this.overlayBoardDrive(parts);
    }
    return {
      running: this.running,
      clockUs: this.clock,
      parts,
      serial: [...this.circuit.serialLog],
      plot: this.plot.map((s) => [...s]),
      plotLabels: [...this.plotLabels],
      logicAnalyzers: this.circuit.logicTraces(),
      status: this.status(),
      unsupported: [...new Set([...this.unsupported, ...this.circuit.unsupportedCalls, ...this.circuit.deviceLimitations()])],
    };
  }

  /** Board-pin voltages must reflect firmware drive (DDR/PORT), not the
   *  Circuit's own board view, which can lag one write behind. */
  private overlayBoardDrive(parts: Record<string, PartState>): void {
    const sandbox = this.sandbox;
    const board = this.board;
    if (!sandbox || !board) return;
    const pins: Record<string, number> = {};
    for (const pinNum of Object.keys(board.digital).map(Number)) {
      const mapping = board.digital[pinNum];
      if (!mapping) continue;
      const state = sandbox.ports[mapping.port].pinState(mapping.bit);
      if (this.pinOutputs.has(pinNum)) {
        pins[String(pinNum)] = state === 1 ? 5 : 0;
      } else {
        const raw = this.circuit.analogRead(pinNum);
        pins[String(pinNum)] = Math.max(0, Math.min(5, (raw / 1024) * 5));
      }
    }
    const id = this.boardId;
    if (id) parts[id] = { kind: 'board', pins };
  }

  private status(): FirmwareStatus {
    return {
      kind: this.statusKind,
      detail: this.statusDetail,
      // Simulated seconds elapsed, derived from the virtual clock (µs).
      simSeconds: this.clock / 1_000_000,
      instructions: this.instructions,
      lastError: this.lastError,
    };
  }

  /* -------------------------------------------------------------- probe -- */

  /** Digital level the firmware drives on a board pin, or -1 when it reads it. */
  boardDigitalDrive(boardId: string, pinName: string): number {
    void boardId;
    const board = this.board;
    if (!board) return -1;
    const num = this.pinNumber(pinName);
    if (board.digital[num] === undefined) return -1;
    if (!this.pinOutputs.has(num)) return -1;
    return this.pinDrive.get(num) === 5 ? 1 : 0;
  }

  boardDigitalInput(boardId: string, pinName: string): number {
    void boardId;
    const num = this.pinNumber(pinName);
    if (this.board?.digital[num] === undefined) return 0;
    return this.circuit.digitalRead(num);
  }

  private pinNumber(pinName: string): number {
    const d = /^D(\d+)$/.exec(pinName);
    if (d?.[1]) return Number(d[1]);
    const a = /^A(\d+)$/.exec(pinName);
    if (a?.[1]) return Number(a[1]) + 14;
    const n = /^\d+$/.exec(pinName);
    if (n?.[0]) return Number(n[0]);
    return -1;
  }

  /* -------------------------------------------------------------- misc -- */

  /** Serial transcript, mirroring SimEngine's shape for CLI/scenario readers. */
  serialTranscript(): { total: number; lines: SerialLine[]; partial: string } {
    return {
      total: this.circuit.serialTotal,
      lines: [...this.circuit.serialLog],
      partial: this.circuit.pendingText,
    };
  }

  /** Digital level the firmware drives on any board's pin, for assertions. */
  boardPinLevel(boardId: string, pinName: string): number {
    const drive = this.boardDigitalDrive(boardId, pinName);
    if (drive !== -1) return drive;
    return this.boardDigitalInput(boardId, pinName);
  }

  pushSerialInput(text: string): void {
    // USART Rx is not wired in slice 0; route through the shared model so the
    // round-trip API stays identical to the functional engine.
    this.circuit.pushSerialInput(text);
  }

  currentClockUs(): number {
    return this.clock;
  }

  get parsedImage(): IntelHexImage | null {
    return this.image;
  }
}
