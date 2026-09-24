/**
 * Static analysis of how a sketch uses its pins, for the electrical rule check.
 *
 * The ERC needs to know which pins a sketch drives and which it reads before
 * anything runs: a pin wired straight to 5 V is harmless as an input and a dead
 * short as an output. This is deliberately a light pass over the text rather
 * than the full parser, so it still gives answers for a sketch that does not
 * compile yet - which is exactly when a student is most likely to be wiring.
 */

export interface SketchPinUse {
  /** Pins set with pinMode(pin, OUTPUT), or written with digitalWrite/analogWrite. */
  outputs: Set<number>;
  /** Pins set with pinMode(pin, INPUT_PULLUP). */
  pullups: Set<number>;
  /** Pins read with digitalRead, analogRead or pulseIn. */
  reads: Set<number>;
}

/** Board pin name ("D13", "A0", "GP25", "13") to the number a sketch uses. */
export function boardPinNumber(pinName: string, analogBase = 14): number | null {
  const d = /^D(\d+)$/i.exec(pinName);
  if (d?.[1]) return Number(d[1]);
  const a = /^A(\d+)$/i.exec(pinName);
  if (a?.[1]) return analogBase + Number(a[1]);
  const gp = /^GP(\d+)$/i.exec(pinName);
  if (gp?.[1]) return Number(gp[1]);
  if (/^\d+$/.test(pinName)) return Number(pinName);
  return null;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** Resolve simple constant names: #define X 13, const int X = A0, byte X = 7. */
function constants(source: string, analogBase: number): Map<string, number> {
  const out = new Map<string, number>();
  const literal = (text: string): number | null => {
    const t = text.trim();
    if (/^\d+$/.test(t)) return Number(t);
    const a = /^A(\d+)$/.exec(t);
    if (a?.[1]) return analogBase + Number(a[1]);
    if (t === 'LED_BUILTIN') return 13;
    return out.get(t) ?? null;
  };

  for (const m of source.matchAll(/^[ \t]*#define[ \t]+([A-Za-z_]\w*)[ \t]+([A-Za-z_0-9]+)/gm)) {
    const v = literal(m[2] ?? '');
    if (m[1] && v !== null) out.set(m[1], v);
  }
  const decl =
    /(?:const\s+|static\s+|volatile\s+|constexpr\s+)*(?:unsigned\s+)?(?:int|byte|uint8_t|short|long|char|pin_size_t)\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_0-9]+)\s*;/g;
  for (const m of source.matchAll(decl)) {
    const v = literal(m[2] ?? '');
    if (m[1] && v !== null) out.set(m[1], v);
  }
  return out;
}

export function sketchPinUse(source: string, analogBase = 14): SketchPinUse {
  const text = stripComments(source);
  const names = constants(text, analogBase);
  const resolve = (expr: string): number | null => {
    const t = expr.trim();
    if (/^\d+$/.test(t)) return Number(t);
    const a = /^A(\d+)$/.exec(t);
    if (a?.[1]) return analogBase + Number(a[1]);
    if (t === 'LED_BUILTIN') return 13;
    return names.get(t) ?? null;
  };

  const outputs = new Set<number>();
  const pullups = new Set<number>();
  const reads = new Set<number>();

  for (const m of text.matchAll(/pinMode\s*\(\s*([^,()]+?)\s*,\s*(OUTPUT|INPUT_PULLUP|INPUT)\s*\)/g)) {
    const pin = resolve(m[1] ?? '');
    if (pin === null) continue;
    if (m[2] === 'OUTPUT') outputs.add(pin);
    if (m[2] === 'INPUT_PULLUP') pullups.add(pin);
  }
  for (const m of text.matchAll(/(?:digitalWrite|analogWrite|tone)\s*\(\s*([^,()]+?)\s*,/g)) {
    const pin = resolve(m[1] ?? '');
    if (pin !== null) outputs.add(pin);
  }
  for (const m of text.matchAll(/(?:digitalRead|analogRead)\s*\(\s*([^,()]+?)\s*\)/g)) {
    const pin = resolve(m[1] ?? '');
    if (pin !== null) reads.add(pin);
  }
  for (const m of text.matchAll(/pulseIn(?:Long)?\s*\(\s*([^,()]+?)\s*,/g)) {
    const pin = resolve(m[1] ?? '');
    if (pin !== null) reads.add(pin);
  }
  for (const m of text.matchAll(/\.attach\s*\(\s*([^,()]+?)\s*[,)]/g)) {
    // Servo.attach(pin) drives that pin as an output.
    const pin = resolve(m[1] ?? '');
    if (pin !== null) outputs.add(pin);
  }
  return { outputs, pullups, reads };
}
