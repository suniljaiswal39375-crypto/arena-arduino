import { describe, expect, it } from 'vitest';
import { SimEngine } from '../engine';
import { FirmwareEngine } from '../firmware/engine';
import {
  MATRIX_HEART, matrixCircuit, matrixGpioImage, matrixSpiImage,
} from '../firmware/fixtures/gpio-devices';

function sketchFor(hardwareSpi: boolean): string {
  const din = hardwareSpi ? 11 : 4;
  const clk = hardwareSpi ? 13 : 5;
  const cs = hardwareSpi ? 10 : 6;
  return `void send(int address, int data) {
    digitalWrite(${cs}, LOW);
    shiftOut(${din}, ${clk}, MSBFIRST, address);
    shiftOut(${din}, ${clk}, MSBFIRST, data);
    digitalWrite(${cs}, HIGH);
  }
  void setup() {
    pinMode(${din}, OUTPUT); pinMode(${clk}, OUTPUT); pinMode(${cs}, OUTPUT);
    digitalWrite(${cs}, HIGH);
    ${MATRIX_HEART.map(([reg, value]) => `send(${reg}, ${value});`).join('\n')}
  }
  void loop() {}`;
}

describe('MAX7219 matrix parity', () => {
  it.each([false, true])('matches functional shiftOut against AVR %s transport for every pixel', (hardwareSpi) => {
    const { doc, partId } = matrixCircuit('matrix-8x8-max7219', hardwareSpi);
    const fe = new SimEngine(doc);
    fe.load(doc, sketchFor(hardwareSpi));
    fe.start();
    for (let i = 0; i < 20; i++) fe.tick(30);

    const fw = new FirmwareEngine(doc);
    fw.load(doc, hardwareSpi ? matrixSpiImage(MATRIX_HEART) : matrixGpioImage(MATRIX_HEART), 'arduino-uno');
    fw.start();
    for (let i = 0; i < 20; i++) fw.run(10);

    expect(fe.snapshot().error).toBeNull();
    const state = fw.snapshot().parts[partId];
    expect(state?.kind).toBe('matrix');
    if (state?.kind === 'matrix') expect(state.cells.filter(Boolean)).toHaveLength(4 + 8 + 8 + 6 + 4 + 2);
    expect(state).toEqual(fe.snapshot().parts[partId]);
    expect(fw.snapshot().unsupported).toEqual([]);
    expect(fe.snapshot().unsupported).toEqual([]);
  });
});
