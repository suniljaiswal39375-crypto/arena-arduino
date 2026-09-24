; state-test.asm — deterministic ATmega328P fixture for the AVR firmware slice.
;
; This is genuine AVR assembly, hand-authored for the slice's tests. Run on real
; hardware it stores 0xAB into SRAM 0x0100/0x0101 and then idles forever; the
; host's deterministic budget guard (never the firmware) is what stops it.
;
; Assembled with avr8js's assembler into src/lib/sim/firmware/imagedata.ts.

.org 0
    rjmp start          ; RESET vector
    rjmp start          ; INT0
    rjmp start          ; INT1
    rjmp start          ; PCINT0
    rjmp start          ; PCINT1
    rjmp start          ; PCINT2
    rjmp start          ; WDT
    rjmp start          ; TIMER2 COMPA
    rjmp start          ; TIMER2 COMPB
    rjmp start          ; TIMER2 OVF
    rjmp start          ; TIMER1 CAPT
    rjmp start          ; TIMER1 COMPA
    rjmp start          ; TIMER1 COMPB
    rjmp start          ; TIMER1 OVF
    rjmp start          ; TIMER0 COMPA

start:
    ldi r16, 0xAB       ; sentinel
    sts 0x0100, r16     ; store sentinel to SRAM
    sts 0x0101, r16     ; store sentinel to SRAM (second address)
loop:
    rjmp loop           ; idle forever; the host budget guard ends the run

