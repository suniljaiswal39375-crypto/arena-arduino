import { describe, expect, it } from 'vitest';
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { SimEngine } from '../engine';
import { FirmwareEngine } from '../firmware/engine';
import { blinkFixture, BLINK_ASM } from '../firmware/fixtures/blink';
import { assembleProgram } from '../firmware/program-image';

function led(parts: Record<string, { kind: string; on?: boolean }>, id: string): boolean {
  return parts[id]?.kind === 'led' && parts[id]?.on === true;
}

describe('GPIO input/pull-up parity', () => {
  it('reads a button from the external AVR PIN register and toggles the same LED as digitalRead', () => {
    const { doc, unoId, ledId } = blinkFixture();
    const button = makePart('pushbutton', 420, 100);
    doc.diagram.parts.push(button);
    doc.diagram.connections.push(
      makeWire({ part: unoId, pin: 'D2' }, { part: button.id, pin: '1' }),
      makeWire({ part: unoId, pin: 'GND' }, { part: button.id, pin: '2' }),
    );
    const fe = new SimEngine(doc);
    fe.load(doc, `void setup() { pinMode(2, INPUT_PULLUP); pinMode(13, OUTPUT); }
      void loop() { if (digitalRead(2) == LOW) digitalWrite(13, HIGH); else digitalWrite(13, LOW); }`);
    fe.start();
    // IN reads PIND bit 2; PORTD2 enables the internal pull-up. No fake sensor
    // value is injected into the firmware: the same wired button drives PIND.
    const hex = assembleProgram([
      'rjmp reset', ...Array(14).fill('rjmp reset'), 'reset:',
      '  sbi 0x0b, 2', '  sbi 0x04, 5',
      'loop:', '  in r16, 0x09', '  sbrc r16, 2', '  rjmp released',
      '  sbi 0x05, 5', '  rjmp loop',
      'released:', '  cbi 0x05, 5', '  rjmp loop',
    ].join('\n'));
    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();

    for (const pressed of [0, 1, 0, 1]) {
      doc.sim.inputs.buttonPressed = pressed;
      fe.setDoc(doc);
      fw.update(doc);
      fe.tick(30);
      fw.run(30);
      expect(fw.boardDigitalInput(unoId, 'D2')).toBe(pressed ? 0 : 1);
      expect(led(fw.snapshot().parts, ledId)).toBe(pressed === 1);
      expect(led(fw.snapshot().parts, ledId)).toBe(led(fe.snapshot().parts, ledId));
    }
  });
});

describe('GPIO active-low relay and downstream load parity', () => {
  it('switches both coil contacts and an LED through COM/NO on real AVR PORTB0 writes', () => {
    const doc = createProject({ name: 'relay parity' });
    const uno = makePart('arduino-uno', 100, 100);
    const relay = makePart('relay-1ch', 350, 100);
    const resistor = makePart('resistor', 430, 100);
    const lamp = makePart('led', 520, 100);
    doc.diagram.parts.push(uno, relay, resistor, lamp);
    doc.diagram.connections.push(
      makeWire({ part: uno.id, pin: 'D8' }, { part: relay.id, pin: 'IN' }),
      makeWire({ part: uno.id, pin: '5V' }, { part: relay.id, pin: 'DC+' }),
      makeWire({ part: uno.id, pin: 'GND' }, { part: relay.id, pin: 'DC-' }),
      makeWire({ part: uno.id, pin: '5V' }, { part: relay.id, pin: 'COM' }),
      makeWire({ part: relay.id, pin: 'NO' }, { part: resistor.id, pin: '1' }),
      makeWire({ part: resistor.id, pin: '2' }, { part: lamp.id, pin: 'A' }),
      makeWire({ part: lamp.id, pin: 'K' }, { part: uno.id, pin: 'GND' }),
    );
    const fe = new SimEngine(doc);
    fe.load(doc, `void setup() { pinMode(8, OUTPUT); }
      void loop() { digitalWrite(8, HIGH); delay(500); digitalWrite(8, LOW); delay(500); }`);
    fe.start();
    // Reuse the *same* proven AVR delay image as blink, but on PB0 (D8)
    // instead of PB5 (D13). All instruction bytes still run through avr8js.
    const asm = BLINK_ASM.replace('ldi r16, 0x20', 'ldi r16, 0x01').replaceAll('0x05, 5', '0x05, 0');
    const fw = new FirmwareEngine(doc);
    fw.load(doc, assembleProgram(asm), 'arduino-uno');
    fw.start();
    const coilTrace: number[] = [];
    const lampTrace: number[] = [];
    for (let i = 0; i < 20; i++) {
      fe.tick(100);
      fw.run(100);
      const fPart = fe.snapshot().parts[relay.id];
      const aPart = fw.snapshot().parts[relay.id];
      expect(aPart).toEqual(fPart);
      expect(fw.snapshot().parts[lamp.id]).toEqual(fe.snapshot().parts[lamp.id]);
      coilTrace.push(aPart?.kind === 'relay' && aPart.closed ? 1 : 0);
      lampTrace.push(led(fw.snapshot().parts, lamp.id) ? 1 : 0);
    }
    expect(coilTrace.join('')).toBe('00000111110000011111');
    expect(lampTrace).toEqual(coilTrace);
  });
});
