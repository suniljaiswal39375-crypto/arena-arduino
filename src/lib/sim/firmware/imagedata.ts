/**
 * Committed firmware fixtures for the AVR slice.
 *
 * `STATE_TEST_HEX` is a real, hand-assembled ATmega328P program (see
 * `fixtures/state-test.asm` for the source). It is deterministic and runs in
 * under a millisecond on silicon: it stores a 0xAB sentinel into SRAM 0x0100
 * and 0x0101, then idles in a `rjmp` loop — so only the host's budget guard
 * (or a real human watching hardware) ever ends it. It exercises the full
 * pipeline — Intel HEX decode, real instruction execution and SRAM stores —
 * without executing a single fake byte.
 *
 * The assembler output was verified against the avr8js core before it was
 * committed: after execution, SRAM 0x0100 and 0x0101 both hold 171 (0xAB) and
 * the program counter sits in the idle loop.
 */

/**
 * Assembled from fixtures/state-test.asm:
 *
 *     rjmp start           (reset vector address 0)
 *     ; interrupt vectors 1..14 point at start
 *     start:
 *       ldi  r16, 0xAB
 *       sts  0x0100, r16
 *       sts  0x0101, r16
 *     loop:
 *       rjmp loop
 */
export const STATE_TEST_HEX = [
  ':100000000EC00DC00CC00BC00AC009C008C007C09C',
  ':1000100006C005C004C003C002C001C000C00BEA96',
  ':0A0020000093000100930101FFCFDF',
  ':00000001FF',
].join('\n');

/** Bytes of address space the STATE_TEST image declares. */
export const STATE_TEST_BYTES = 42;

/** Sentinel value the program stores in SRAM 0x0100 / 0x0101. */
export const STATE_TEST_SENTINEL = 0xab;
