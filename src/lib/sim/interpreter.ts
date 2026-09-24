import type { CType, DeclInfo, Expr, FuncDecl, Program, Stmt } from './ast';
import type { SimHost } from './host';
import { INPUT, INPUT_PULLUP, OUTPUT } from './host';
import { SkethError } from './tokens';

export type RuntimeValue =
  | number
  | string
  | boolean
  | null
  | undefined
  | RuntimeValue[]
  | RuntimeObject
  | RuntimeFunction;

export interface RuntimeObject {
  __kind: 'object';
  className: string;
  fields: Map<string, RuntimeValue>;
}

export interface RuntimeFunction {
  __kind: 'function';
  name: string;
  native?: (args: RuntimeValue[]) => RuntimeValue;
  decl?: FuncDecl;
  closure?: Env;
}

export class ReturnSignal {
  constructor(public value: RuntimeValue) {}
}
export class BreakSignal {}
export class ContinueSignal {}

export class RuntimeError extends Error {
  constructor(
    message: string,
    public line = 0,
    public code = 'RUNTIME',
  ) {
    super(message);
    this.name = 'SketchRuntimeError';
  }
}

export class Env {
  private vars = new Map<string, { value: RuntimeValue; type: CType }>();

  constructor(public parent?: Env) {}

  declare(name: string, value: RuntimeValue, type: CType = 'int'): void {
    this.vars.set(name, { value, type });
  }

  lookup(name: string): { value: RuntimeValue; type: CType } | undefined {
    let e: Env | undefined = this;
    while (e) {
      const v = e.vars.get(name);
      if (v) return v;
      e = e.parent;
    }
    return undefined;
  }

  get(name: string): RuntimeValue {
    const v = this.lookup(name);
    if (!v) return undefined;
    return v.value;
  }

  set(name: string, value: RuntimeValue): boolean {
    let e: Env | undefined = this;
    while (e) {
      const v = e.vars.get(name);
      if (v) {
        // Assigning to an int truncates, as in C: int cm = 7.9; stores 7.
        v.value = Array.isArray(value) ? value : coerceScalar(v.type, value);
        return true;
      }
      e = e.parent;
    }
    return false;
  }
}

/** Minimum virtual time (µs) that has to pass before we hand control back. */
const YIELD_US = 1000;
/**
 * Loop iterations between forced yields. A sketch with no delay() would
 * otherwise spin forever inside one generator step, so we pause here and let
 * the engine decide how much virtual time the work was worth.
 */
const OP_BUDGET = 100;
/** Virtual time credited for a batch of work when the sketch delayed nothing. */
const IDLE_US = 1000;

const Casts: Record<string, (v: RuntimeValue) => RuntimeValue> = {
  int: (v) => Math.trunc(toNum(v)),
  long: (v) => Math.trunc(toNum(v)),
  char: (v) => Math.trunc(toNum(v)),
  short: (v) => Math.trunc(toNum(v)),
  byte: (v) => Math.trunc(toNum(v)),
  uint8_t: (v) => Math.trunc(toNum(v)),
  float: (v) => toNum(v),
  double: (v) => toNum(v),
  bool: (v) => !!v,
  String: (v) => (v === null ? '' : typeof v === 'string' ? v : String(v)),
};

/** Coerce a value to a C scalar type. Objects, functions and unknown types pass through. */
export function coerceScalar(type: CType, v: RuntimeValue): RuntimeValue {
  if (typeof v === 'object' && v !== null) return v;
  const cast = Casts[type];
  if (cast) return cast(v);
  switch (type) {
    case 'unsigned':
    case 'unsigned int': {
      const n = Math.trunc(toNum(v));
      return ((n % 65536) + 65536) % 65536;
    }
    case 'unsigned long': {
      const n = Math.trunc(toNum(v));
      return ((n % 4294967296) + 4294967296) % 4294967296;
    }
    case 'unsigned char': {
      const n = Math.trunc(toNum(v));
      return ((n % 256) + 256) % 256;
    }
    default:
      return v;
  }
}

export function isObject(v: RuntimeValue): v is RuntimeObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && v.__kind === 'object';
}

export function isFunction(v: RuntimeValue): v is RuntimeFunction {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && v.__kind === 'function';
}

export function toNum(v: RuntimeValue): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export function toBool(v: RuntimeValue): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return !!v;
}

export function toText(v: RuntimeValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `[${v.map(toText).join(', ')}]`;
  if (typeof v === 'object') {
    if (v.__kind === 'object') return `${v.className}@${v.fields.size}`;
    if (v.__kind === 'function') return `<function ${v.name}>`;
  }
  return String(v);
}

export interface InterpreterOptions {
  /** Called after every yield so the host can publish a state snapshot. */
  onYield?: () => void;
}

/**
 * Tree-walking interpreter for the Arduino C++ subset.
 *
 * Statements are executed by generator functions so the engine can pause at a
 * statement boundary and let the host render, pace and poll for stop requests.
 */
export class Interpreter {
  env = new Env();
  private program: Program;
  private host: SimHost;
  private lastYieldUs = 0;
  private pendingYield = false;
  private ops = 0;
  private stackDepth = 0;
  private maxStackDepth = 64;
  private includes: string[];
  private onYield?: () => void;

  constructor(program: Program, host: SimHost, includes: string[] = [], opts: InterpreterOptions = {}) {
    this.program = program;
    this.host = host;
    this.includes = includes;
    this.onYield = opts.onYield;
    this.installBuiltins();
    this.declareGlobals();
  }

  /* ------------------------------------------------------------------ setup */

  private installBuiltins(): void {
    const def = (name: string, fn: (args: RuntimeValue[]) => RuntimeValue): void => {
      this.env.declare(name, { __kind: 'function', name, native: fn }, 'object');
    };

    this.env.declare('HIGH', 1, 'int');
    this.env.declare('LOW', 0, 'int');
    this.env.declare('INPUT', INPUT, 'int');
    this.env.declare('OUTPUT', OUTPUT, 'int');
    this.env.declare('INPUT_PULLUP', INPUT_PULLUP, 'int');
    this.env.declare('true', true, 'bool');
    this.env.declare('false', false, 'bool');
    this.env.declare('LED_BUILTIN', 13, 'int');
    this.env.declare('PI', Math.PI, 'float');
    this.env.declare('TWO_PI', Math.PI * 2, 'float');
    this.env.declare('HALF_PI', Math.PI / 2, 'float');
    this.env.declare('E', Math.E, 'float');
    this.env.declare('LN2', Math.LN2, 'float');
    this.env.declare('LOG2', Math.LOG2E, 'float');
    this.env.declare('DEG_TO_RAD', Math.PI / 180, 'float');
    this.env.declare('RAD_TO_DEG', 180 / Math.PI, 'float');
    this.env.declare('DEC', 10, 'int');
    this.env.declare('HEX', 16, 'int');
    this.env.declare('OCT', 8, 'int');
    this.env.declare('BIN', 2, 'int');
    this.env.declare('CHANGE', 'CHANGE', 'int');
    this.env.declare('RISING', 'RISING', 'int');
    this.env.declare('FALLING', 'FALLING', 'int');
    this.env.declare('LOW_', 0, 'int');
    this.env.declare('LSBFIRST', 0, 'int');
    this.env.declare('MSBFIRST', 1, 'int');
    this.env.declare('DEFAULT', 1, 'int');
    this.env.declare('EXTERNAL', 0, 'int');
    this.env.declare('INTERNAL', 3, 'int');
    this.env.declare('NOT_AN_INTERRUPT', -1, 'int');

    for (let i = 0; i < 16; i++) {
      this.env.declare(`A${i}`, this.host.analogBase() + i, 'int');
    }

    def('pinMode', (a) => {
      this.host.pinMode(Math.trunc(toNum(a[0])), Math.trunc(toNum(a[1])) as 0 | 1 | 2);
      return undefined;
    });
    def('digitalWrite', (a) => {
      this.host.digitalWrite(Math.trunc(toNum(a[0])), toNum(a[1]) !== 0 ? 1 : 0);
      return undefined;
    });
    def('digitalRead', (a) => this.host.digitalRead(Math.trunc(toNum(a[0]))));
    def('analogRead', (a) => this.host.analogRead(Math.trunc(toNum(a[0]))));
    def('analogReference', () => undefined);
    def('analogWrite', (a) => {
      this.host.analogWrite(Math.trunc(toNum(a[0])), Math.trunc(toNum(a[1])));
      return undefined;
    });
    def('millis', () => Math.trunc(this.host.nowUs() / 1000));
    def('micros', () => Math.trunc(this.host.nowUs()));
    def('delay', (a) => {
      const ms = toNum(a[0]);
      this.host.advance(Math.max(0, ms) * 1000);
      return undefined;
    });
    def('delayMicroseconds', (a) => {
      this.host.advance(Math.max(0, toNum(a[0])));
      return undefined;
    });
    def('tone', (a) => {
      this.host.tone(Math.trunc(toNum(a[0])), toNum(a[1]), toNum(a[2] ?? 0));
      return undefined;
    });
    def('noTone', (a) => {
      this.host.noTone(Math.trunc(toNum(a[0])));
      return undefined;
    });
    def('pulseIn', (a) =>
      this.host.pulseIn(
        Math.trunc(toNum(a[0])),
        toNum(a[1]) !== 0 ? 1 : 0,
        a[2] === undefined ? 1000000 : toNum(a[2]),
      ),
    );
    def('pulseInLong', (a) =>
      this.host.pulseIn(Math.trunc(toNum(a[0])), toNum(a[1]) !== 0 ? 1 : 0, toNum(a[2] ?? 1000000)),
    );

    def('map', (a) => {
      const v = toNum(a[0]);
      const il = toNum(a[1]);
      const ih = toNum(a[2]);
      const ol = toNum(a[3]);
      const oh = toNum(a[4]);
      if (ih === il) return ol;
      return Math.trunc(((v - il) * (oh - ol)) / (ih - il) + ol);
    });
    def('constrain', (a) => {
      const v = toNum(a[0]);
      return Math.min(Math.max(v, toNum(a[1])), toNum(a[2]));
    });
    def('min', (a) => Math.min(toNum(a[0]), toNum(a[1])));
    def('max', (a) => Math.max(toNum(a[0]), toNum(a[1])));
    def('abs', (a) => Math.abs(toNum(a[0])));
    def('pow', (a) => Math.pow(toNum(a[0]), toNum(a[1])));
    def('sqrt', (a) => Math.sqrt(toNum(a[0])));
    def('sq', (a) => {
      const v = toNum(a[0]);
      return v * v;
    });
    def('sin', (a) => Math.sin(toNum(a[0])));
    def('cos', (a) => Math.cos(toNum(a[0])));
    def('tan', (a) => Math.tan(toNum(a[0])));
    def('atan', (a) => Math.atan(toNum(a[0])));
    def('atan2', (a) => Math.atan2(toNum(a[0]), toNum(a[1])));
    def('radians', (a) => (toNum(a[0]) * Math.PI) / 180);
    def('degrees', (a) => (toNum(a[0]) * 180) / Math.PI);
    def('round', (a) => Math.round(toNum(a[0])));
    def('floor', (a) => Math.floor(toNum(a[0])));
    def('ceil', (a) => Math.ceil(toNum(a[0])));
    def('trunc', (a) => Math.trunc(toNum(a[0])));
    def('fmod', (a) => toNum(a[0]) % toNum(a[1]));
    def('random', (a) => {
      if (a.length === 0) return Math.trunc(this.host.randomFloat() * 0x7fffffff);
      if (a.length === 1) return Math.trunc(this.host.randomFloat() * toNum(a[0]));
      const lo = toNum(a[0]);
      const hi = toNum(a[1]);
      return Math.trunc(lo + this.host.randomFloat() * (hi - lo));
    });
    def('randomSeed', (a) => {
      this.host.seedRandom(Math.trunc(toNum(a[0])));
      return undefined;
    });
    def('lowByte', (a) => Math.trunc(toNum(a[0])) & 0xff);
    def('highByte', (a) => (Math.trunc(toNum(a[0])) >> 8) & 0xff);
    def('bitRead', (a) => (Math.trunc(toNum(a[0])) >> Math.trunc(toNum(a[1]))) & 1);
    def('bitSet', (a) => {
      const v = Math.trunc(toNum(a[0])) | (1 << Math.trunc(toNum(a[1])));
      this.assignBack(a[0], v);
      return v;
    });
    def('bitClear', (a) => {
      const v = Math.trunc(toNum(a[0])) & ~(1 << Math.trunc(toNum(a[1])));
      this.assignBack(a[0], v);
      return v;
    });
    def('bitWrite', (a) => {
      const bit = Math.trunc(toNum(a[2])) !== 0 ? 1 : 0;
      const v =
        bit === 1
          ? Math.trunc(toNum(a[0])) | (1 << Math.trunc(toNum(a[1])))
          : Math.trunc(toNum(a[0])) & ~(1 << Math.trunc(toNum(a[1])));
      this.assignBack(a[0], v);
      return v;
    });
    def('bit', (a) => 1 << Math.trunc(toNum(a[0])));
    def('digitalPinToInterrupt', (a) => Math.trunc(toNum(a[0])));
    def('attachInterrupt', (a) => {
      const pin = Math.trunc(toNum(a[0]));
      const handler = a[1];
      const mode = String(a[2] ?? 'RISING');
      if (isFunction(handler)) {
        this.host.attachInterrupt(pin, mode, () => {
          this.callFunction(handler, []);
        });
      }
      return undefined;
    });
    def('detachInterrupt', (a) => {
      this.host.detachInterrupt(Math.trunc(toNum(a[0])));
      return undefined;
    });
    def('interrupts', () => undefined);
    def('noInterrupts', () => undefined);
    def('yield', () => undefined);
    def('F', (a) => a[0] ?? '');
    def('String', (a) => (a.length === 0 ? '' : toText(a[0] ?? '')));
    def('isAlpha', (a) => {
      const s = toText(a[0]);
      return s.length > 0 && /[A-Za-z]/.test(s[0] ?? '') ? 1 : 0;
    });
    def('isDigit', (a) => {
      const s = toText(a[0]);
      return s.length > 0 && /[0-9]/.test(s[0] ?? '') ? 1 : 0;
    });
    def('strlen', (a) => toText(a[0]).length);
    def('shiftOut', () => undefined);
    def('shiftIn', () => 0);
    def('delay_yield', () => undefined);
    def('Serial_begin', () => undefined);
    def('__unsupported', (a) => {
      this.host.unsupported(toText(a[0]));
      return undefined;
    });

    // Serial object
    const serial: RuntimeObject = { __kind: 'object', className: 'HardwareSerial', fields: new Map() };
    const fmt = (v: RuntimeValue, base?: RuntimeValue): string => {
      const n = Math.trunc(toNum(v));
      switch (Math.trunc(toNum(base ?? 10))) {
        case 16:
          return n.toString(16).toUpperCase();
        case 8:
          return n.toString(8);
        case 2:
          return n.toString(2);
        default:
          return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : toText(v);
      }
    };
    serial.fields.set('begin', { __kind: 'function', name: 'begin', native: () => undefined });
    serial.fields.set('end', { __kind: 'function', name: 'end', native: () => undefined });
    serial.fields.set('flush', { __kind: 'function', name: 'flush', native: () => undefined });
    serial.fields.set('print', {
      __kind: 'function',
      name: 'print',
      native: (a) => {
        this.host.serialPrint(fmt(a[0] ?? '', a[1]));
        return a.length;
      },
    });
    serial.fields.set('println', {
      __kind: 'function',
      name: 'println',
      native: (a) => {
        this.host.serialPrint(`${a.length === 0 ? '' : fmt(a[0], a[1])}\n`);
        return 1;
      },
    });
    serial.fields.set('write', {
      __kind: 'function',
      name: 'write',
      native: (a) => {
        const v = a[0];
        this.host.serialPrint(typeof v === 'number' ? String.fromCharCode(v) : toText(v));
        return 1;
      },
    });
    serial.fields.set('available', {
      __kind: 'function',
      name: 'available',
      native: () => this.host.serialAvailable(),
    });
    serial.fields.set('read', {
      __kind: 'function',
      name: 'read',
      native: () => this.host.serialRead(),
    });
    serial.fields.set('peek', {
      __kind: 'function',
      name: 'peek',
      native: () => this.host.serialPeek(),
    });
    // Input typed into the monitor arrives whole, so "read until the timeout"
    // is simply "read what is there".
    serial.fields.set('readString', {
      __kind: 'function',
      name: 'readString',
      native: () => {
        let out = '';
        for (let c = this.host.serialRead(); c !== -1; c = this.host.serialRead()) out += String.fromCharCode(c);
        return out;
      },
    });
    serial.fields.set('readStringUntil', {
      __kind: 'function',
      name: 'readStringUntil',
      native: (a) => {
        const stop = typeof a[0] === 'string' ? a[0].charCodeAt(0) : Math.trunc(toNum(a[0]));
        let out = '';
        for (let c = this.host.serialRead(); c !== -1 && c !== stop; c = this.host.serialRead()) {
          out += String.fromCharCode(c);
        }
        return out;
      },
    });
    const parseNumber = (allowDot: boolean): number => {
      // Skip anything that cannot start a number, as Stream::parseInt does.
      for (let c = this.host.serialPeek(); c !== -1; c = this.host.serialPeek()) {
        const ch = String.fromCharCode(c);
        if (/[0-9-]/.test(ch) || (allowDot && ch === '.')) break;
        this.host.serialRead();
      }
      let text = '';
      for (let c = this.host.serialPeek(); c !== -1; c = this.host.serialPeek()) {
        const ch = String.fromCharCode(c);
        const ok = /[0-9]/.test(ch) || (ch === '-' && text === '') || (allowDot && ch === '.' && !text.includes('.'));
        if (!ok) break;
        text += ch;
        this.host.serialRead();
      }
      const n = allowDot ? Number.parseFloat(text) : Number.parseInt(text, 10);
      return Number.isFinite(n) ? n : 0;
    };
    serial.fields.set('parseInt', {
      __kind: 'function',
      name: 'parseInt',
      native: () => parseNumber(false),
    });
    serial.fields.set('parseFloat', {
      __kind: 'function',
      name: 'parseFloat',
      native: () => parseNumber(true),
    });
    serial.fields.set('setTimeout', {
      __kind: 'function',
      name: 'setTimeout',
      native: () => undefined,
    });
    this.env.declare('Serial', serial, 'object');
  }

  private assignBack(target: RuntimeValue, value: RuntimeValue): void {
    void target;
    void value;
    // Rare: bitSet/bitWrite on a temporary. Nothing persistent to update.
  }

  /* --------------------------------------------------------------- classes */

  private makeServo(): RuntimeObject {
    const o: RuntimeObject = { __kind: 'object', className: 'Servo', fields: new Map() };
    let pin = -1;
    let angle = 90;
    o.fields.set('attach', {
      __kind: 'function',
      name: 'attach',
      native: (a) => {
        pin = Math.trunc(toNum(a[0]));
        this.host.servoAttach(pin);
        return 1;
      },
    });
    o.fields.set('write', {
      __kind: 'function',
      name: 'write',
      native: (a) => {
        angle = Math.trunc(toNum(a[0]));
        const us = Math.round(544 + (angle / 180) * (2400 - 544));
        this.host.servoWrite(pin, us);
        return undefined;
      },
    });
    o.fields.set('writeMicroseconds', {
      __kind: 'function',
      name: 'writeMicroseconds',
      native: (a) => {
        this.host.servoWrite(pin, Math.trunc(toNum(a[0])));
        return undefined;
      },
    });
    o.fields.set('read', { __kind: 'function', name: 'read', native: () => angle });
    o.fields.set('attached', { __kind: 'function', name: 'attached', native: () => (pin >= 0 ? 1 : 0) });
    o.fields.set('detach', {
      __kind: 'function',
      name: 'detach',
      native: () => {
        if (pin >= 0) this.host.servoDetach(pin);
        pin = -1;
        return undefined;
      },
    });
    return o;
  }

  private makeLcd(args: RuntimeValue[]): RuntimeObject {
    const address = Math.trunc(toNum(args[0] ?? 39));
    const o: RuntimeObject = { __kind: 'object', className: 'LiquidCrystal_I2C', fields: new Map() };
    const cmd = (command: string, extra: unknown[] = []): undefined => {
      this.host.lcdCommand(address, command, extra);
      return undefined;
    };
    const passthrough = ['init', 'begin', 'backlight', 'noBacklight', 'clear', 'home', 'display', 'noDisplay', 'cursor', 'noCursor', 'blink', 'noBlink', 'scrollDisplayLeft', 'scrollDisplayRight', 'autoscroll', 'noAutoscroll', 'leftToRight', 'rightToLeft', 'createChar', 'setBacklight'];
    for (const name of passthrough) {
      o.fields.set(name, {
        __kind: 'function',
        name,
        native: (a) => cmd(name, a as unknown[]),
      });
    }
    o.fields.set('setCursor', {
      __kind: 'function',
      name: 'setCursor',
      native: (a) => cmd('setCursor', [Math.trunc(toNum(a[0])), Math.trunc(toNum(a[1]))]),
    });
    o.fields.set('print', {
      __kind: 'function',
      name: 'print',
      native: (a) => {
        this.host.lcdCommand(address, 'print', [toText(a[0] ?? '')]);
        return 1;
      },
    });
    return o;
  }

  private makeOled(args: RuntimeValue[]): RuntimeObject {
    const o: RuntimeObject = { __kind: 'object', className: 'Adafruit_SSD1306', fields: new Map() };
    void args;
    const passthrough = ['begin', 'clearDisplay', 'display', 'invertDisplay', 'dim', 'fillScreen', 'drawPixel', 'drawLine', 'drawRect', 'fillRect', 'drawCircle', 'fillCircle', 'drawTriangle', 'setRotation', 'setTextWrap', 'cp437', 'drawBitmap', 'startscrollright', 'startscrollleft', 'stopscroll', 'setTextColor', 'setTextSize', 'setCursor'];
    for (const name of passthrough) {
      o.fields.set(name, {
        __kind: 'function',
        name,
        native: (a) => {
          this.host.oledCommand(name, a as unknown[]);
          return undefined;
        },
      });
    }
    o.fields.set('print', {
      __kind: 'function',
      name: 'print',
      native: (a) => {
        this.host.oledCommand('print', [toText(a[0] ?? '')]);
        return 1;
      },
    });
    o.fields.set('println', {
      __kind: 'function',
      name: 'println',
      native: (a) => {
        this.host.oledCommand('println', [toText(a[0] ?? '')]);
        return 1;
      },
    });
    o.fields.set('width', { __kind: 'function', name: 'width', native: () => 128 });
    o.fields.set('height', { __kind: 'function', name: 'height', native: () => 64 });
    o.fields.set('getCursorX', { __kind: 'function', name: 'getCursorX', native: () => 0 });
    return o;
  }

  private makeStepper(args: RuntimeValue[]): RuntimeObject {
    const steps = Math.trunc(toNum(args[0] ?? 200));
    const o: RuntimeObject = { __kind: 'object', className: 'Stepper', fields: new Map() };
    let speed = 60;
    o.fields.set('setSpeed', {
      __kind: 'function',
      name: 'setSpeed',
      native: (a) => {
        speed = toNum(a[0]);
        return undefined;
      },
    });
    o.fields.set('step', {
      __kind: 'function',
      name: 'step',
      native: (a) => {
        const count = Math.trunc(toNum(a[0]));
        // 60 seconds per minute, at speed rpm, for `count` of `steps` per turn.
        const usPerStep = speed > 0 ? (60000000 / (steps * speed)) : 0;
        this.host.advance(usPerStep * Math.abs(count));
        return undefined;
      },
    });
    o.fields.set('version', { __kind: 'function', name: 'version', native: () => 1 });
    return o;
  }

  private makeDht(args: RuntimeValue[]): RuntimeObject {
    const pin = Math.trunc(toNum(args[0] ?? 2));
    const type = Math.trunc(toNum(args[1] ?? 11));
    const o: RuntimeObject = { __kind: 'object', className: 'DHT', fields: new Map() };
    o.fields.set('begin', { __kind: 'function', name: 'begin', native: () => undefined });
    o.fields.set('readTemperature', {
      __kind: 'function',
      name: 'readTemperature',
      native: () =>
        type === 22
          ? this.host.sensorRead('dhtTemperature', pin)
          : Math.round(this.host.sensorRead('dhtTemperature', pin)),
    });
    o.fields.set('readHumidity', {
      __kind: 'function',
      name: 'readHumidity',
      native: () =>
        type === 22
          ? this.host.sensorRead('dhtHumidity', pin)
          : Math.round(this.host.sensorRead('dhtHumidity', pin)),
    });
    o.fields.set('computeHeatIndex', {
      __kind: 'function',
      name: 'computeHeatIndex',
      native: (a) => (toNum(a[0]) + toNum(a[1])) / 2,
    });
    return o;
  }

  private constructClass(className: string, args: RuntimeValue[]): RuntimeObject {
    switch (className) {
      case 'Servo':
        return this.makeServo();
      case 'LiquidCrystal_I2C':
        return this.makeLcd(args);
      case 'Adafruit_SSD1306':
        return this.makeOled(args);
      case 'Stepper':
        return this.makeStepper(args);
      case 'DHT':
        return this.makeDht(args);
      default: {
        // Unknown class: give it an inert instance so the sketch still runs and
        // the host can explain the limit.
        this.host.unsupported(`${className} (class)`);
        return { __kind: 'object', className, fields: new Map() };
      }
    }
  }

  /* -------------------------------------------------------------- globals */

  private declareGlobals(): void {
    for (const g of this.program.globals) {
      let value: RuntimeValue = 0;
      if (g.type === 'object' && g.className) {
        const args = (g.ctorArgs ?? []).map((e) => this.evalConst(e));
        value = this.constructClass(g.className, args);
      } else if (g.init !== undefined) {
        value = this.evalConst(g.init);
      } else if (g.isArray) {
        value = [];
      }
      this.env.declare(g.name, g.type === 'object' ? value : this.coerceDecl(g, value), g.type);
    }
    for (const f of this.program.funcs) {
      this.env.declare(
        f.name,
        { __kind: 'function', name: f.name, decl: f, closure: this.env },
        'object',
      );
    }
  }

  /** Constant-ish evaluation used for globals before setup() runs. */
  private evalConst(e: Expr): RuntimeValue {
    try {
      return this.eval(e, this.env);
    } catch {
      return 0;
    }
  }

  /**
   * Coerce a declared variable's initial value. Arrays coerce element by
   * element and pad to their declared size: `int pins[5] = {9, 10};` is five
   * ints. Coercing the whole array as a scalar turned `int pins[] = {9, 10, 11}`
   * into 0 and `String names[] = {"a", "b"}` into the single string "a,b".
   */
  private coerceDecl(d: DeclInfo, v: RuntimeValue): RuntimeValue {
    if (!d.isArray && !Array.isArray(v)) return this.coerce(d.type, v);
    const items = Array.isArray(v) ? v : [];
    const size = Math.max(items.length, d.arraySize ?? 0);
    const zero: RuntimeValue = d.type === 'String' ? '' : d.type === 'bool' ? false : 0;
    const out: RuntimeValue[] = [];
    for (let i = 0; i < size; i++) out.push(this.coerce(d.type, i < items.length ? items[i] : zero));
    return out;
  }

  private coerce(type: CType, v: RuntimeValue): RuntimeValue {
    const cast = Casts[type];
    if (cast) return cast(v);
    switch (type) {
      case 'unsigned':
      case 'unsigned int': {
        const n = Math.trunc(toNum(v));
        return ((n % 65536) + 65536) % 65536;
      }
      case 'unsigned long': {
        const n = Math.trunc(toNum(v));
        return ((n % 4294967296) + 4294967296) % 4294967296;
      }
      case 'unsigned char': {
        const n = Math.trunc(toNum(v));
        return ((n % 256) + 256) % 256;
      }
      case 'void':
        return undefined;
      case 'object':
        return v;
      default:
        return v;
    }
  }

  /* ------------------------------------------------------------ execution */

  /** Run setup() once, then loop() forever, pausing at statement boundaries. */
  *run(): Generator<void, void, void> {
    const setup = this.program.funcs.find((f) => f.name === 'setup');
    const loop = this.program.funcs.find((f) => f.name === 'loop');

    if (setup) {
      try {
        yield* this.callDeclGenerator(setup, []);
      } catch (err) {
        throw this.wrapError(err, setup.line);
      }
    }
    if (!loop) {
      throw new RuntimeError('This sketch has no loop() function.', 0, 'NO_LOOP');
    }

    for (;;) {
      try {
        yield* this.callDeclGenerator(loop, []);
      } catch (err) {
        throw this.wrapError(err, loop.line);
      }
      this.checkInterrupts();
      this.ops++;
      if (this.shouldYield()) yield* this.doYield();
    }
  }

  private wrapError(err: unknown, line: number): Error {
    if (err instanceof ReturnSignal || err instanceof BreakSignal || err instanceof ContinueSignal) {
      return new RuntimeError('break, continue or return used outside a loop or function', line, 'CONTROL');
    }
    if (err instanceof RuntimeError) return err;
    if (err instanceof SkethError) return new RuntimeError(err.message, err.line, err.code);
    const message = err instanceof Error ? err.message : String(err);
    return new RuntimeError(message, line, 'RUNTIME');
  }

  private pendingInterrupts: Array<() => void> = [];
  private interruptHosts = new Map<number, () => void>();

  private checkInterrupts(): void {
    void this.pendingInterrupts;
    void this.interruptHosts;
  }

  private shouldYield(): boolean {
    return this.pendingYield || this.host.nowUs() - this.lastYieldUs >= YIELD_US || this.ops >= OP_BUDGET;
  }

  private *doYield(): Generator<void, void, void> {
    // A sketch that calls delay() has already advanced the clock. One that
    // loops without delaying has not, so credit it with the time its work
    // would have taken on real hardware and let millis() keep up.
    if (this.host.nowUs() === this.lastYieldUs) this.host.advance(IDLE_US);
    this.pendingYield = false;
    this.lastYieldUs = this.host.nowUs();
    this.ops = 0;
    this.onYield?.();
    yield;
  }

  private *execBlock(stmts: Stmt[], env: Env): Generator<void, void, void> {
    for (const s of stmts) {
      yield* this.exec(s, env);
      if (this.shouldYield()) yield* this.doYield();
    }
  }

  private *exec(s: Stmt, env: Env): Generator<void, void, void> {
    switch (s.k) {
      case 'block':
        yield* this.execBlock(s.body, new Env(env));
        return;

      case 'empty':
      case 'break':
      case 'continue':
        throw s.k === 'break' ? new BreakSignal() : s.k === 'continue' ? new ContinueSignal() : new Error('unreachable');

      case 'var': {
        // long cm = measure();  runs measure() suspendably, so a delay inside it
        // is real time the rest of the circuit can be seen in.
        if (s.init && !s.isArray && s.type !== 'object') {
          const call = this.userCall(s.init, env);
          if (call) {
            const v = yield* this.callDeclGenerator(call.decl, call.args);
            env.declare(s.name, this.coerceDecl(s, v ?? 0), s.type);
            return;
          }
        }
        this.declareVar(s, env);
        return;
      }

      case 'expr': {
        // beep();  and  x = readSensor();  are the two shapes of helper call a
        // student writes. Both run as generators so delay() inside a helper
        // passes time visibly, instead of the whole helper happening at once.
        const direct = this.userCall(s.expr, env);
        if (direct) {
          yield* this.callDeclGenerator(direct.decl, direct.args);
          return;
        }
        if (s.expr.k === 'assign' && s.expr.op === '=') {
          const call = this.userCall(s.expr.value, env);
          if (call) {
            const v = yield* this.callDeclGenerator(call.decl, call.args);
            this.doAssign(s.expr.target, '=', v ?? 0, env);
            return;
          }
        }
        this.eval(s.expr, env);
        return;
      }

      case 'if': {
        if (toBool(this.eval(s.cond, env))) {
          yield* this.exec(s.then, env);
        } else if (s.else) {
          yield* this.exec(s.else, env);
        }
        return;
      }

      case 'while': {
        while (toBool(this.eval(s.cond, env))) {
          try {
            yield* this.exec(s.body, new Env(env));
          } catch (err) {
            if (err instanceof BreakSignal) break;
            if (err instanceof ContinueSignal) continue;
            throw err;
          }
          this.ops++;
          if (this.shouldYield()) yield* this.doYield();
        }
        return;
      }

      case 'dowhile': {
        for (;;) {
          try {
            yield* this.exec(s.body, new Env(env));
          } catch (err) {
            if (err instanceof BreakSignal) break;
            if (!(err instanceof ContinueSignal)) throw err;
          }
          this.ops++;
          if (this.shouldYield()) yield* this.doYield();
          if (!toBool(this.eval(s.cond, env))) break;
        }
        return;
      }

      case 'for': {
        const scope = new Env(env);
        if (s.init) yield* this.exec(s.init, scope);
        for (;;) {
          if (s.cond && !toBool(this.eval(s.cond, scope))) break;
          try {
            yield* this.exec(s.body, scope);
          } catch (err) {
            if (err instanceof BreakSignal) break;
            if (!(err instanceof ContinueSignal)) throw err;
          }
          if (s.step) this.eval(s.step, scope);
          this.ops++;
          if (this.shouldYield()) yield* this.doYield();
        }
        return;
      }

      case 'switch': {
        const target = this.eval(s.expr, env);
        const scope = new Env(env);
        let matched = false;
        let running = false;
        for (const c of s.cases) {
          if (!matched && c.value !== null) {
            if (this.eval(c.value, scope) === target) {
              matched = true;
              running = true;
            }
          } else if (!matched && c.value === null) {
            continue;
          }
          if (running || (c.value === null && !matched)) {
            if (c.value === null) running = true;
            try {
              yield* this.execBlock(c.body, scope);
            } catch (err) {
              if (err instanceof BreakSignal) return;
              if (!(err instanceof ContinueSignal)) throw err;
            }
            if (this.shouldYield()) yield* this.doYield();
          }
        }
        return;
      }

      case 'return': {
        const v = s.expr ? this.eval(s.expr, env) : undefined;
        throw new ReturnSignal(v ?? null);
      }
    }
  }

  private declareVar(d: DeclInfo, env: Env): RuntimeValue {
    let value: RuntimeValue = 0;
    if (d.type === 'object' && d.className) {
      value = this.constructClass(
        d.className,
        (d.ctorArgs ?? []).map((e) => this.eval(e, env)),
      );
    } else if (d.init !== undefined) {
      value = this.eval(d.init, env);
    } else if (d.isArray) {
      value = [];
    }
    const coerced = d.type === 'object' ? value : this.coerceDecl(d, value);
    // Object types keep their instance; everything else is value-copied.
    env.declare(d.name, d.type === 'object' || Array.isArray(coerced) ? coerced : coerced, d.type);
    return coerced;
  }

  /** A direct call to a sketch-defined function, with its arguments evaluated. */
  private userCall(e: Expr, env: Env): { decl: FuncDecl; args: RuntimeValue[] } | null {
    if (e.k !== 'call' || e.callee.k !== 'ident') return null;
    const fn = env.get(e.callee.name);
    if (!isFunction(fn) || fn.native || !fn.decl) return null;
    return { decl: fn.decl, args: e.args.map((a) => this.eval(a, env)) };
  }

  private *callDeclGenerator(f: FuncDecl, args: RuntimeValue[]): Generator<void, RuntimeValue, void> {
    if (this.stackDepth >= this.maxStackDepth) {
      throw new RuntimeError(
        `Too much recursion calling ${f.name}(). Arduino boards have very little stack.`,
        f.line,
        'STACK',
      );
    }
    this.stackDepth++;
    const env = new Env(this.env);
    f.params.forEach((p, i) => {
      env.declare(p.name, this.coerce(p.type, args[i] ?? 0), p.type);
    });
    try {
      if (f.body.k === 'block') {
        yield* this.execBlock(f.body.body, env);
      } else {
        yield* this.exec(f.body, env);
      }
    } catch (err) {
      this.stackDepth--;
      if (err instanceof ReturnSignal) {
        return f.returnType === 'void' ? null : coerceScalar(f.returnType, err.value);
      }
      throw err;
    }
    this.stackDepth--;
    return null;
  }

  private callFunction(fn: RuntimeFunction, args: RuntimeValue[]): RuntimeValue {
    if (fn.native) return fn.native(args);
    if (!fn.decl) return null;
    if (this.stackDepth >= this.maxStackDepth) {
      throw new RuntimeError(`Too much recursion calling ${fn.name}().`, 0, 'STACK');
    }
    this.stackDepth++;
    const env = new Env(fn.closure ?? this.env);
    fn.decl.params.forEach((p, i) => {
      env.declare(p.name, this.coerce(p.type, args[i] ?? 0), p.type);
    });
    try {
      const body = fn.decl.body;
      const stmts = body.k === 'block' ? body.body : [body];
      for (const s of stmts) {
        // Nested calls cannot suspend; that is the documented limit of this engine.
        this.execSync(s, env);
      }
    } catch (err) {
      this.stackDepth--;
      if (err instanceof ReturnSignal) {
        // long half(int x) { return x / 2.0; } returns a long.
        const rt = fn.decl.returnType;
        return rt === 'void' ? null : coerceScalar(rt, err.value);
      }
      throw err;
    }
    this.stackDepth--;
    return null;
  }

  /** Run a statement without suspension, for calls made from inside expressions. */
  private execSync(s: Stmt, env: Env): void {
    switch (s.k) {
      case 'block': {
        const inner = new Env(env);
        for (const st of s.body) this.execSync(st, inner);
        return;
      }
      case 'empty':
        return;
      case 'var':
        this.declareVar(s, env);
        return;
      case 'expr':
        this.eval(s.expr, env);
        return;
      case 'if':
        if (toBool(this.eval(s.cond, env))) this.execSync(s.then, env);
        else if (s.else) this.execSync(s.else, env);
        return;
      case 'while': {
        let guard = 0;
        while (toBool(this.eval(s.cond, env))) {
          if (++guard > 1_000_000) {
            throw new RuntimeError('Loop inside a function call never finished.', 0, 'HANG');
          }
          try {
            this.execSync(s.body, new Env(env));
          } catch (err) {
            if (err instanceof BreakSignal) break;
            if (!(err instanceof ContinueSignal)) throw err;
          }
        }
        return;
      }
      case 'dowhile': {
        let guard = 0;
        for (;;) {
          if (++guard > 1_000_000) {
            throw new RuntimeError('Loop inside a function call never finished.', 0, 'HANG');
          }
          try {
            this.execSync(s.body, new Env(env));
          } catch (err) {
            if (err instanceof BreakSignal) break;
            if (!(err instanceof ContinueSignal)) throw err;
          }
          if (!toBool(this.eval(s.cond, env))) break;
        }
        return;
      }
      case 'for': {
        const scope = new Env(env);
        if (s.init) this.execSync(s.init, scope);
        let guard = 0;
        for (;;) {
          if (++guard > 1_000_000) {
            throw new RuntimeError('Loop inside a function call never finished.', 0, 'HANG');
          }
          if (s.cond && !toBool(this.eval(s.cond, scope))) break;
          try {
            this.execSync(s.body, scope);
          } catch (err) {
            if (err instanceof BreakSignal) break;
            if (!(err instanceof ContinueSignal)) throw err;
          }
          if (s.step) this.eval(s.step, scope);
        }
        return;
      }
      case 'switch': {
        const target = this.eval(s.expr, env);
        const scope = new Env(env);
        let running = false;
        for (const c of s.cases) {
          if (c.value === null) {
            if (running) {
              try {
                for (const st of c.body) this.execSync(st, scope);
              } catch (err) {
                if (err instanceof BreakSignal) return;
                if (!(err instanceof ContinueSignal)) throw err;
              }
            }
            continue;
          }
          if (this.eval(c.value, scope) === target) running = true;
          if (running) {
            try {
              for (const st of c.body) this.execSync(st, scope);
            } catch (err) {
              if (err instanceof BreakSignal) return;
              if (!(err instanceof ContinueSignal)) throw err;
            }
          }
        }
        return;
      }
      case 'return':
        throw new ReturnSignal(s.expr ? this.eval(s.expr, env) : null);
      case 'break':
        throw new BreakSignal();
      case 'continue':
        throw new ContinueSignal();
    }
  }

  /* ----------------------------------------------------------- expressions */

  eval(e: Expr, env: Env): RuntimeValue {
    switch (e.k) {
      case 'lit':
        return e.value;

      case 'ident': {
        if (!env.lookup(e.name)) {
          // Reading an undeclared name is a sketch bug, but it should not stop
          // the whole simulation: warn once and carry on with 0.
          if (!this.warnedNames.has(e.name)) {
            this.warnedNames.add(e.name);
            this.host.unsupported(`undeclared identifier "${e.name}"`);
          }
          return 0;
        }
        return env.get(e.name);
      }

      case 'binary': {
        if (e.op === '&&') return toBool(this.eval(e.left, env)) ? toBool(this.eval(e.right, env)) : false;
        if (e.op === '||') return toBool(this.eval(e.left, env)) ? true : toBool(this.eval(e.right, env));
        let a = this.eval(e.left, env);
        let b = this.eval(e.right, env);
        // C integer division: 7 / 2 is 3 unless either side is a float.
        if (e.op === '/' && typeof a === 'number' && typeof b === 'number' && !this.isFloatExpr(e, env)) {
          return b === 0 ? 0 : Math.trunc(a / b);
        }
        // String + char appends the letter, as Arduino's String class does.
        if (e.op === '+' && typeof a === 'string' && typeof b === 'number' && this.isCharExpr(e.right, env)) {
          b = String.fromCharCode(b);
        }
        if (e.op === '+' && typeof b === 'string' && typeof a === 'number' && this.isCharExpr(e.left, env)) {
          a = String.fromCharCode(a);
        }
        return this.binary(e.op, a, b);
      }

      case 'assign': {
        let value = this.eval(e.value, env);
        // command += c;  the idiom for collecting serial input into a String.
        if (e.op === '+=' && typeof value === 'number' && this.isCharExpr(e.value, env)) {
          const current = this.assignTargetKey(e.target, env)?.get();
          if (typeof current === 'string') value = String.fromCharCode(value);
        }
        return this.doAssign(e.target, e.op, value, env);
      }

      case 'unary': {
        const v = this.eval(e.operand, env);
        switch (e.op) {
          case '!':
            return !toBool(v);
          case '-':
            return -toNum(v);
          case '+':
            return toNum(v);
          case '~':
            return ~Math.trunc(toNum(v));
          case '++':
            return this.preInc(e.operand, 1, env);
          case '--':
            return this.preInc(e.operand, -1, env);
          default:
            if (e.op.startsWith('cast:')) {
              const cast = Casts[e.op.slice(5)];
              return cast ? cast(v) : v;
            }
            return v;
        }
      }

      case 'postfix': {
        const before = this.eval(e.operand, env);
        this.preInc(e.operand, e.op === '++' ? 1 : -1, env);
        return before;
      }

      case 'call':
        return this.evalCall(e.callee, e.args, env);

      case 'member': {
        const obj = this.eval(e.object, env);
        if (isObject(obj)) {
          const v = obj.fields.get(e.name);
          return v === undefined ? 0 : v;
        }
        if (Array.isArray(obj) && e.name === 'length') return obj.length;
        if (typeof obj === 'string' && e.name === 'length') return obj.length;
        return 0;
      }

      case 'index': {
        const obj = this.eval(e.object, env);
        const idx = Math.trunc(toNum(this.eval(e.index, env)));
        if (Array.isArray(obj)) return obj[idx] ?? 0;
        if (typeof obj === 'string') return obj.charAt(idx);
        return 0;
      }

      case 'ternary':
        return toBool(this.eval(e.cond, env)) ? this.eval(e.then, env) : this.eval(e.else, env);

      case 'initlist':
        return e.items.map((i) => this.eval(i, env));
    }
  }

  private warnedNames = new Set<string>();

  private preInc(target: Expr, delta: number, env: Env): RuntimeValue {
    const current = this.eval(target, env);
    const next = toNum(current) + delta;
    this.doAssign(target, '=', next, env);
    return next;
  }

  private doAssign(target: Expr, op: string, raw: RuntimeValue, env: Env): RuntimeValue {
    const key = this.assignTargetKey(target, env);
    const current = key ? key.get() : this.eval(target, env);
    let value = raw;
    if (op !== '=') {
      value = this.binary(op.slice(0, -1), current, raw);
    }
    if (Array.isArray(value)) value = [...value];
    // Writing into an element of a typed array truncates like a variable does.
    if (target.k === 'index' && target.object.k === 'ident') {
      const t = env.lookup(target.object.name)?.type;
      if (t) value = coerceScalar(t, value);
    }
    if (key) key.set(value);
    return value;
  }

  private assignTargetKey(
    target: Expr,
    env: Env,
  ): { get: () => RuntimeValue; set: (v: RuntimeValue) => void } | null {
    if (target.k === 'ident') {
      const name = target.name;
      return {
        get: () => env.get(name),
        set: (v) => {
          if (!env.set(name, v)) env.declare(name, v);
        },
      };
    }
    if (target.k === 'index') {
      const obj = this.eval(target.object, env);
      const idx = Math.trunc(toNum(this.eval(target.index, env)));
      if (Array.isArray(obj)) {
        return {
          get: () => obj[idx] ?? 0,
          set: (v) => {
            while (obj.length <= idx) obj.push(0);
            obj[idx] = v;
          },
        };
      }
      return null;
    }
    if (target.k === 'member') {
      const obj = this.eval(target.object, env);
      if (isObject(obj)) {
        return {
          get: () => obj.fields.get(target.name) ?? 0,
          set: (v) => obj.fields.set(target.name, v),
        };
      }
    }
    return null;
  }

  /**
   * C++ equality. Two Strings compare by text; everything else compares as a
   * number. The old rule fell back to numbers for strings too, and since
   * "off" and "on" both parse to 0, every String comparison was true.
   */
  private looseEquals(a: RuntimeValue, b: RuntimeValue): boolean {
    if (typeof a === 'string' && typeof b === 'string') return a === b;
    if (typeof a === 'string' || typeof b === 'string') {
      // String == number only makes sense for a numeric String.
      return toText(a) === toText(b);
    }
    return a === b || toNum(a) === toNum(b);
  }

  private binary(op: string, a: RuntimeValue, b: RuntimeValue): RuntimeValue {
    if (op === '+' && (typeof a === 'string' || typeof b === 'string')) {
      return toText(a) + toText(b);
    }
    const x = toNum(a);
    const y = toNum(b);
    switch (op) {
      case '+':
        return x + y;
      case '-':
        return x - y;
      case '*':
        return x * y;
      case '/':
        return y === 0 ? 0 : x / y;
      case '%':
        return y === 0 ? 0 : Math.trunc(x) % Math.trunc(y);
      case '==':
        return this.looseEquals(a, b);
      case '!=':
        return !this.looseEquals(a, b);
      case '<':
        return x < y;
      case '<=':
        return x <= y;
      case '>':
        return x > y;
      case '>=':
        return x >= y;
      case '&':
        return Math.trunc(x) & Math.trunc(y);
      case '|':
        return Math.trunc(x) | Math.trunc(y);
      case '^':
        return Math.trunc(x) ^ Math.trunc(y);
      case '<<':
        return Math.trunc(x) << Math.trunc(y);
      case '>>':
        return Math.trunc(x) >> Math.trunc(y);
      default:
        return 0;
    }
  }

  /**
   * True when an expression has C type float or double. Arduino prints those
   * with two decimals even when the value is whole: a float holding 33 prints
   * "33.00", never "33". JavaScript cannot tell 33 from 33.0, so the static
   * type decides.
   */
  private isFloatExpr(e: Expr | undefined, env: Env): boolean {
    if (!e) return false;
    const floaty = (t: CType | undefined) => t === 'float' || t === 'double';
    switch (e.k) {
      case 'lit':
        return typeof e.value === 'number' && (e.isFloat === true || !Number.isInteger(e.value));
      case 'ident':
        return floaty(env.lookup(e.name)?.type);
      case 'index':
        return e.object.k === 'ident' && floaty(env.lookup(e.object.name)?.type);
      case 'unary':
        return e.op === 'cast:float' || e.op === 'cast:double' || (e.op === '-' && this.isFloatExpr(e.operand, env));
      case 'binary':
        return ['+', '-', '*', '/'].includes(e.op) && (this.isFloatExpr(e.left, env) || this.isFloatExpr(e.right, env));
      case 'ternary':
        return this.isFloatExpr(e.then, env) || this.isFloatExpr(e.else, env);
      case 'call': {
        if (e.callee.k === 'member') {
          return ['readTemperature', 'readHumidity', 'toFloat', 'toDouble', 'parseFloat'].includes(e.callee.name);
        }
        if (e.callee.k === 'ident') {
          if (['sqrt', 'pow', 'sin', 'cos', 'tan', 'atan', 'radians', 'degrees', 'fmod'].includes(e.callee.name)) return true;
          const fn = env.get(e.callee.name);
          return isFunction(fn) && floaty(fn.decl?.returnType);
        }
        return false;
      }
      default:
        return false;
    }
  }

  /** True when an expression has C type char, so printing shows a letter. */
  private isCharExpr(e: Expr | undefined, env: Env): boolean {
    if (!e) return false;
    if (e.k === 'lit') return e.isChar === true;
    if (e.k === 'ident') return env.lookup(e.name)?.type === 'char';
    if (e.k === 'index' && e.object.k === 'ident') return env.lookup(e.object.name)?.type === 'char';
    if (e.k === 'unary') return e.op === 'cast:char';
    return false;
  }

  private evalCall(callee: Expr, argExprs: Expr[], env: Env): RuntimeValue {
    const args = argExprs.map((a) => this.eval(a, env));
    // print('A') and print(c) for a char c show the letter, not its code; a
    // float prints with two decimals (or as many as the second argument asks).
    if (callee.k === 'member' && (callee.name === 'print' || callee.name === 'println')) {
      const v = args[0];
      if (typeof v === 'number' && this.isCharExpr(argExprs[0], env)) {
        args[0] = String.fromCharCode(v);
      } else if (typeof v === 'number' && this.isFloatExpr(argExprs[0], env)) {
        const decimals = args.length > 1 ? Math.max(0, Math.trunc(toNum(args[1]))) : 2;
        args[0] = v.toFixed(decimals);
        args.length = 1;
      }
    }

    if (callee.k === 'ident') {
      const fn = env.get(callee.name);
      if (isFunction(fn)) return this.callFunction(fn, args);
      if (isObject(fn)) {
        // Implicit construction: `Servo s()` is rare; treat as a no-arg construct.
        return this.constructClass(fn.className, args);
      }
      // Unknown call: an unmodelled library function. Report it once and move on.
      if (!this.warnedNames.has(`call:${callee.name}`)) {
        this.warnedNames.add(`call:${callee.name}`);
        this.host.unsupported(`${callee.name}()`);
      }
      return 0;
    }

    if (callee.k === 'member') {
      const obj = this.eval(callee.object, env);
      if (isObject(obj)) {
        const fn = obj.fields.get(callee.name);
        if (isFunction(fn)) return this.callFunction(fn, args);
        if (!this.warnedNames.has(`call:${obj.className}.${callee.name}`)) {
          this.warnedNames.add(`call:${obj.className}.${callee.name}`);
          this.host.unsupported(`${obj.className}.${callee.name}()`);
        }
        return 0;
      }
      if (typeof obj === 'string') {
        return this.stringMethod(obj, callee.name, args, callee.object, env);
      }
      if (Array.isArray(obj)) {
        return 0;
      }
      return 0;
    }

    return 0;
  }

  /**
   * Arduino's String class. Methods that change the string in place on the
   * board (trim, toUpperCase, toLowerCase, replace, remove) write the result
   * back to the variable, so `command.trim();` behaves as it does on hardware.
   */
  private stringMethod(value: string, name: string, args: RuntimeValue[], target: Expr, env: Env): RuntimeValue {
    const writeBack = (next: string): undefined => {
      this.assignTargetKey(target, env)?.set(next);
      return undefined;
    };
    const text = (v: RuntimeValue): string => (typeof v === 'number' ? String.fromCharCode(v) : toText(v));
    const int = (v: RuntimeValue | undefined, fallback: number): number =>
      v === undefined ? fallback : Math.trunc(toNum(v));

    switch (name) {
      case 'length':
        return value.length;
      case 'trim':
        return writeBack(value.trim());
      case 'toUpperCase':
        return writeBack(value.toUpperCase());
      case 'toLowerCase':
        return writeBack(value.toLowerCase());
      case 'replace':
        return writeBack(value.split(text(args[0])).join(text(args[1])));
      case 'remove': {
        const from = int(args[0], 0);
        const count = args[1] === undefined ? value.length : int(args[1], 0);
        return writeBack(value.slice(0, from) + value.slice(from + count));
      }
      case 'charAt':
      case 'operator[]': {
        const c = value.charCodeAt(int(args[0], 0));
        return Number.isNaN(c) ? 0 : c;
      }
      case 'indexOf':
        return value.indexOf(text(args[0]), int(args[1], 0));
      case 'lastIndexOf':
        return value.lastIndexOf(text(args[0]));
      case 'substring':
        return value.substring(int(args[0], 0), args[1] === undefined ? undefined : int(args[1], value.length));
      case 'startsWith':
        return value.startsWith(text(args[0]));
      case 'endsWith':
        return value.endsWith(text(args[0]));
      case 'equals':
        return value === toText(args[0]);
      case 'equalsIgnoreCase':
        return value.toLowerCase() === toText(args[0]).toLowerCase();
      case 'compareTo':
        return value < toText(args[0]) ? -1 : value > toText(args[0]) ? 1 : 0;
      case 'concat':
        return writeBack(value + text(args[0]));
      case 'toInt': {
        const n = Number.parseInt(value.trim(), 10);
        return Number.isFinite(n) ? n : 0;
      }
      case 'toFloat':
      case 'toDouble': {
        const n = Number.parseFloat(value.trim());
        return Number.isFinite(n) ? n : 0;
      }
      case 'c_str':
        return value;
      case 'isEmpty':
        return value.length === 0;
      default:
        if (!this.warnedNames.has(`call:String.${name}`)) {
          this.warnedNames.add(`call:String.${name}`);
          this.host.unsupported(`String.${name}()`);
        }
        return 0;
    }
  }
}
