/**
 * Assemble committed AVR assembly into an Intel HEX image, with the exact
 * pipeline the parity fixture uses, so a program's HEX and its assembly can
 * never drift apart. This is real machine-code generation (avr8js's assembler),
 * produced from a *fixed, committed* source list — not a C compiler and not a
 * fabricated fixture.
 */
import { assemble } from 'avr8js/dist/cjs/utils/assembler.js';

/** Assemble AVR source into an Intel HEX string (avr-objcopy-style records). */
export function assembleProgram(source: string): string {
  const asm = assemble(source);
  if (asm.errors.length) throw new Error(`assembler failed: ${asm.errors.join('; ')}`);
  const out: string[] = [];
  const pushRec = (addr: number, type: number, data: number[]): void => {
    let sum = data.length + (addr >> 8) + (addr & 0xff) + type;
    for (const b of data) sum += b;
    const chk = (0x100 - (sum & 0xff)) & 0xff;
    out.push(
      ':' +
        [data.length, (addr >> 8) & 0xff, addr & 0xff, type, ...data, chk]
          .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
          .join(''),
    );
  };
  const bytes = asm.bytes;
  const padded = new Uint8Array(Math.ceil(bytes.length / 2) * 2);
  padded.set(bytes);
  for (let a = 0; a < padded.length; a += 16) pushRec(a, 0x00, Array.from(padded.slice(a, a + 16)));
  pushRec(0, 0x01, []);
  return out.join('\n');
}
