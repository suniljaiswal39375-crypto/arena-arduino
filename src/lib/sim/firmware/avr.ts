/**
 * avr8js integration: the ATmega328P (Arduino Uno/Nano) firmware slice.
 *
 * This module owns the *accurate* part of Phase 10, AVR first. A compiled
 * firmware image (Intel HEX, produced by arduino-cli + ArduinoCore-avr — see
 * `compile.ts`) is decoded here and executed one instruction at a time on the
 * same MIT-licensed AVR8 core that Wokwi ships (`avr8js`). The CPU is wrapped
 * in the ATmega328P memory map: flash, SRAM, GPIO ports B/C/D, the three
 * timers, the USART and the ADC, so `digitalWrite(13)` really flips PB5 in a
 * DDR/PORT register, `Serial.print` really drives USART0, and `delay()` really
 * counts timer0 overflows on a 16 MHz clock.
 *
 * The only boundary vs. a real chip is a documented I/O-register "shim"
 * (IO_* below): it is how this deterministic slice learns its per-step budget
 * and how to safely halt a `while (1) {}` sketch, neither of which exists on
 * silicon. Every shim address is chosen from the unmapped 0x30..0x5F range so
 * it can never collide with a real ATmega328P register. The shim is described
 * in ./README.md and is deliberately *not* presented as an AVR feature.
 */
import {
  CPU,
  AVRClock,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  AVRADC,
  AVRWatchdog,
  AVRTWI,
  AVRSPI,
  spiConfig,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
  adcConfig,
  watchdogConfig,
  twiConfig,
  avrInstruction,
  PinState,
} from 'avr8js';

/* ------------------------------------------------------------------ */
/* Board data                                                          */
/* ------------------------------------------------------------------ */

/** SparkLab part type -> ATmega variant. Only 328P boards are emulated. */
export type AvrChip = 'atmega328p' | 'atmega32u4' | 'atmega2560' | 'attiny85';

export interface AvrBoard {
  chip: AvrChip;
  fqbn: string;
  /** Clock source, in Hz. Uno/Nano run 16 MHz off a crystal. */
  clockHz: number;
  /** RAM on top of the register file, bytes. */
  sramBytes: number;
  /** Flash size, bytes. */
  flashBytes: number;
  /** External digital pin -> (port, bit) when it is a genuine GPIO line. */
  digital: Record<number, { port: 'B' | 'C' | 'D'; bit: number }>;
  /** Arduino analog channel (0..N) -> external A0.. pin name. */
  analogChannels: Record<number, number>;
}

/** Arduino pin number -> AVR port bit, ATmega328P. */
const P: Record<number, { port: 'B' | 'C' | 'D'; bit: number }> = {
  0: { port: 'D', bit: 0 },
  1: { port: 'D', bit: 1 },
  2: { port: 'D', bit: 2 },
  3: { port: 'D', bit: 3 },
  4: { port: 'D', bit: 4 },
  5: { port: 'D', bit: 5 },
  6: { port: 'D', bit: 6 },
  7: { port: 'D', bit: 7 },
  8: { port: 'B', bit: 0 },
  9: { port: 'B', bit: 1 },
  10: { port: 'B', bit: 2 },
  11: { port: 'B', bit: 3 },
  12: { port: 'B', bit: 4 },
  13: { port: 'B', bit: 5 },
  14: { port: 'C', bit: 0 }, // A0
  15: { port: 'C', bit: 1 }, // A1
  16: { port: 'C', bit: 2 }, // A2
  17: { port: 'C', bit: 3 }, // A3
  18: { port: 'C', bit: 4 }, // A4
  19: { port: 'C', bit: 5 }, // A5
};

export const AVR_BOARDS: Record<string, AvrBoard> = {
  'arduino-uno': {
    chip: 'atmega328p',
    fqbn: 'arduino:avr:uno',
    clockHz: 16e6,
    sramBytes: 2048,
    flashBytes: 32768,
    digital: P,
    analogChannels: { 0: 14, 1: 15, 2: 16, 3: 17, 4: 18, 5: 19 },
  },
  'arduino-nano': {
    chip: 'atmega328p',
    fqbn: 'arduino:avr:nano',
    clockHz: 16e6,
    sramBytes: 2048,
    flashBytes: 32768,
    digital: P,
    analogChannels: { 0: 14, 1: 15, 2: 16, 3: 17, 4: 18, 5: 19 },
  },
  // Extra 328P aliases share the exact same core; the emulator catalogue
  // exposes them with the same honest "ATmega328P core" label.
  'emu-uno': {
    chip: 'atmega328p',
    fqbn: 'arduino:avr:uno',
    clockHz: 16e6,
    sramBytes: 2048,
    flashBytes: 32768,
    digital: P,
    analogChannels: { 0: 14, 1: 15, 2: 16, 3: 17, 4: 18, 5: 19 },
  },
  'emu-nano': {
    chip: 'atmega328p',
    fqbn: 'arduino:avr:nano',
    clockHz: 16e6,
    sramBytes: 2048,
    flashBytes: 32768,
    digital: P,
    analogChannels: { 0: 14, 1: 15, 2: 16, 3: 17, 4: 18, 5: 19 },
  },
};

export function avrBoardFor(type: string): AvrBoard | null {
  return AVR_BOARDS[type] ?? null;
}

/** Which AVR port object a port letter names. */
export function portInstance(
  ports: { B: AVRIOPort; C: AVRIOPort; D: AVRIOPort },
  port: 'B' | 'C' | 'D',
): AVRIOPort {
  return ports[port];
}

/* ------------------------------------------------------------------ */
/* Intel HEX                                                            */
/* ------------------------------------------------------------------ */

export class HexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HexError';
  }
}

export interface IntelHexImage {
  bytes: Uint8Array;
  /** Total addressable flash span the image declares, in bytes. */
  addressSpace: number;
  /** Words written (non-0xFFFF 16-bit values). */
  wordsWritten: number;
}

function hexByte(hex: string, line: number, at: number): number {
  const v = Number.parseInt(hex, 16);
  if (!Number.isFinite(v)) throw new HexError(`bad hex digit on line ${line}, offset ${at}`);
  return v;
}

/**
 * Parse a strict Intel HEX file (record types 00 data, 01 EOF, 04 extended
 * linear address) into a flat byte image sized to the highest byte address the
 * file references. This is the exact payload `avr-gcc`/`objcopy` emit for the
 * 328P; the parser rejects out-of-range or malformed records rather than
 * silently truncating flash.
 */
export function parseIntelHex(source: string): IntelHexImage {
  const lines = source.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) throw new HexError('empty hex file');
  let upper = 0;
  let maxOffset = -1;
  let words = 0;
  const chunks: Array<{ offset: number; data: Uint8Array }> = [];
  let sawEof = false;

  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const text = lines[i] as string;
    if (!text.startsWith(':')) throw new HexError(`line ${line}: record must start with ':'`);
    if (text.length < 11) throw new HexError(`line ${line}: record too short`);
    if (text.length % 2 !== 1) throw new HexError(`line ${line}: odd record length`);

    let pos = 1;
    const readByte = (): number => {
      const v = hexByte(text.slice(pos, pos + 2), line, pos);
      pos += 2;
      return v;
    };
    const byteCount = readByte();
    const address = (readByte() << 8) | readByte();
    const type = readByte();
    const body: number[] = [];
    for (let b = 0; b < byteCount; b++) body.push(readByte());
    const checksum = readByte();
    if (text.length < 9 + byteCount * 2) throw new HexError(`line ${line}: truncated record body`);
    // Two's complement checksum: the low byte of the sum of every byte from
    // count through the last data byte plus the checksum byte must be 0.
    let sum = byteCount + (address >> 8) + (address & 0xff) + type;
    for (const b of body) sum += b;
    sum += checksum;
    if ((sum & 0xff) !== 0) throw new HexError(`line ${line}: checksum mismatch`);

    switch (type) {
      case 0x00: {
        const offset = upper + address;
        if (offset / 2 > 0xffff) throw new HexError(`line ${line}: address beyond 22-bit flash`);
        chunks.push({ offset, data: Uint8Array.from(body) });
        maxOffset = Math.max(maxOffset, offset + byteCount - 1);
        break;
      }
      case 0x01:
        sawEof = true;
        break;
      case 0x04: {
        if (byteCount !== 2) throw new HexError(`line ${line}: xlat record must be 2 bytes`);
        upper = ((body[0] as number) << 8 | (body[1] as number)) << 16;
        break;
      }
      default:
        throw new HexError(`line ${line}: unsupported record type 0x${type.toString(16)}`);
    }
    if (sawEof) break;
  }

  if (maxOffset < 0) throw new HexError('no data records in hex file');
  const addressSpace = Math.max(1, Math.ceil((maxOffset + 1) / 2) * 2);
  const bytes = new Uint8Array(addressSpace).fill(0xff);
  for (const chunk of chunks) bytes.set(chunk.data, chunk.offset);
  // Count non-erased words: these are the instructions that will actually run.
  const dataView = new Uint16Array(bytes.buffer, 0, addressSpace / 2) as Uint16Array & { length: number };
  for (let w = 0; w < dataView.length; w++) {
    if (dataView[w] !== 0xffff) words++;
  }
  return { bytes, addressSpace, wordsWritten: words };
}

/* ------------------------------------------------------------------ */
/* The clock bridge (see README.md "Determinism and the clock bridge") */
/* ------------------------------------------------------------------ */

/**
 * The AVR slice needs exactly one thing that does not exist on silicon: a way
 * for the host to supply the wall clock the sketch's `millis()` reads, so that
 * `delay(1000)` is paced by the host's virtual clock rather than by executing
 * sixteen million busy-wait instructions. That bridge is a three-cell SRAM
 * window the *widget* prelude (visible, editable C) defines, and the host
 * keeps warm:
 *
 *   0x0200 u32  host virtual millis          (host-written, millis() reads)
 *   0x0204 u8   delay flag                    (firmware writes 1 while delaying)
 *   0x0205 u32  delay target, in ms           (firmware writes)
 *
 * The prelude's `delay()` first stores the target, then raises the flag, then
 * honestly busy-waits on `millis()`. The host sees the flag, advances 0x0200 to
 * the target and credits the whole delay as simulated time, so the loop's exit
 * condition really holds while costing microseconds of host time — the exact
 * pacing the functional engine gives `delay()`. On silicon the same source is a
 * plain busy-wait over a RAM cell, so the bytes are real compiled bytes either
 * way, and the bridge is emulator-only instrumentation that is *visible in the
 * source*, never an injected instruction.
 */
export const BRIDGE_MS = 0x0200;
export const BRIDGE_DELAY_FLAG = 0x0204;
export const BRIDGE_DELAY_TARGET = 0x0205;

/** Read a little-endian u32 from the CPU's data space. */
export function readU32(data: Uint8Array, addr: number): number {
  return (
    (data[addr] as number) |
    ((data[addr + 1] as number) << 8) |
    ((data[addr + 2] as number) << 16) |
    ((data[addr + 3] as number) << 24)
  ) >>> 0;
}

/** Write a little-endian u32 to the CPU's data space. */
export function writeU32(data: Uint8Array, addr: number, value: number): void {
  data[addr] = value & 0xff;
  data[addr + 1] = (value >>> 8) & 0xff;
  data[addr + 2] = (value >>> 16) & 0xff;
  data[addr + 3] = (value >>> 24) & 0xff;
}

/* ------------------------------------------------------------------ */
/* CPU + ATmega328P peripheral assembly                                */
/* ------------------------------------------------------------------ */

export interface AvrSandbox {
  cpu: CPU;
  clock: AVRClock;
  ports: { B: AVRIOPort; C: AVRIOPort; D: AVRIOPort };
  timers: { t0: AVRTimer; t1: AVRTimer; t2: AVRTimer };
  usart: AVRUSART;
  adc: AVRADC;
  twi: AVRTWI;
  spi: AVRSPI;
  watchdog: AVRWatchdog;
  image: IntelHexImage;
}

export interface AvrProgramOptions {
  /** Reserved for the sim-fabric cost model; ignored by the 328P slice. */
  microsecondsPerStep?: number;
  totalMicroseconds?: number;
  steps?: number;
  dataBytes?: number;
}

/**
 * Decode and instantiate an ATmega328P program. Throws HexError on a bad image.
 */
export function prepareAvrProgram(image: IntelHexImage, _options?: AvrProgramOptions): AvrSandbox {
  if (image.addressSpace > 32768) {
    throw new HexError(`firmware image needs ${image.addressSpace} bytes of flash; ATmega328P has 32768`);
  }
  if (image.bytes.length % 2 !== 0) throw new HexError('firmware image is not word-aligned');

  const cpu = new CPU(new Uint16Array(image.bytes.length / 2));
  cpu.progMem.set(new Uint16Array(image.bytes.buffer));
  const clock = new AVRClock(cpu, 16e6);
  const ports = {
    B: new AVRIOPort(cpu, portBConfig),
    C: new AVRIOPort(cpu, portCConfig),
    D: new AVRIOPort(cpu, portDConfig),
  };
  const timers = {
    t0: new AVRTimer(cpu, timer0Config),
    t1: new AVRTimer(cpu, timer1Config),
    t2: new AVRTimer(cpu, timer2Config),
  };
  const usart = new AVRUSART(cpu, usart0Config, 16e6);
  const adc = new AVRADC(cpu, adcConfig);
  for (let ch = 0; ch < adcConfig.numChannels; ch++) (adc.channelValues as unknown[])[ch] = 0;
  const twi = new AVRTWI(cpu, twiConfig, 16e6);
  const spi = new AVRSPI(cpu, spiConfig, 16e6);
  const watchdog = new AVRWatchdog(cpu, watchdogConfig, clock);

  // Free-running, so the host's execution count is the single source of truth
  // for virtual time; cpu.addClockEvent would otherwise require per-step churn
  // and drift with interrupts. CLKPR divide-by-1 keeps cpu.cycles == the number
  // of 16 MHz clock ticks executed.
  cpu.data[0x60] = 0; // CLKPR
  watchdog.resetWatchdog();

  return { cpu, clock, ports, timers, usart, adc, twi, spi, watchdog, image };
}

/** Advance the sandbox by exactly one instruction + one peripheral tick. */
export function step(sandbox: AvrSandbox): void {
  avrInstruction(sandbox.cpu);
  sandbox.cpu.tick();
}

/** External logical level (0/1) for a port+bit, as the PIN register sees it. */
export function pinLevelOf(ports: { B: AVRIOPort; C: AVRIOPort; D: AVRIOPort }, port: 'B' | 'C' | 'D', bit: number): number {
  const p = portInstance(ports, port);
  const state = p.pinState(bit);
  return state === PinState.High || state === PinState.InputPullUp ? 1 : 0;
}

/** Voltage an AVR analog channel should read for a raw 0..1023 result, 5 V ref. */
export function voltageForRaw(raw: number): number {
  return (Math.max(0, Math.min(1023, raw)) / 1024) * 5;
}

/* ------------------------------------------------------------------ */
/* Widget prelude (visible, editable C that the compile service builds) */
/* ------------------------------------------------------------------ */

/**
 * Nanopin customer 328P parameters shared by loader and generator: 16 MHz
 * crystal, 32 kB flash, 2048 B SRAM.
 */
export const CPU_328P = { cpuHz: 16_000_000, flashBytes: 32768, sramBytes: 2048 } as const;

/**
 * The compiled-firmware source always starts with this prelude. It is text the
 * user can read, edit and delete — the honest articulation of the clock bridge
 * in the sketch's own language. `delay()` busy-waits on `millis()` exactly as
 * the Arduino core does; the bridge short-circuits the *host* cost of that
 * wait, never the firmware's semantics. The three cells are pinned to a fixed
 * SRAM window (0x0200) the host owns — a standard embedded technique for
 * reserving host-communication memory, compiled by the real toolchain like any
 * other sketch. On silicon, nothing else writes that window, so the same bytes
 * simply busy-wait.
 */
export const AVRToolchainWidget = {
  cpuHz: CPU_328P.cpuHz,
  code: `\
// ---- SparkLab AVR clock bridge (visible, editable; delete freely) ----
// The host owns SRAM 0x0200..0x0209: millis() clocks from 0x0200, and delay()
// sets a flag/target the host fast-forwards. Real compiled AVR: on a bare 328P
// these are ordinary memory-mapped reads/writes and the delay busy-waits.
#define SPARKLAB_MS       ((volatile unsigned long *)(0x0200))
#define SPARKLAB_DELAYING ((volatile unsigned char *)(0x0204))
#define SPARKLAB_UNTIL    ((volatile unsigned long *)(0x0205))

unsigned long millis(void) {
  return *SPARKLAB_MS;
}

void delay(unsigned long ms) {
  *SPARKLAB_UNTIL = *SPARKLAB_MS + ms;
  *SPARKLAB_DELAYING = 1;
  while (*SPARKLAB_MS < *SPARKLAB_UNTIL) {
    // Host fast-forwards *SPARKLAB_MS while this flag is set.
  }
  *SPARKLAB_DELAYING = 0;
}
`,
} as const;

/**
 * The compiled-sketch generation: the prelude plus the user's sketch. Only
 * `sketch.ino` is ever compiled, exactly as the document model specifies.
 */
export function widgetSource(userSketch: string): string {
  return AVRToolchainWidget.code + userSketch;
}
