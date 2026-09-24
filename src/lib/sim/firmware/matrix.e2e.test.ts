import { describe, expect, it } from 'vitest';
import { FirmwareEngine } from './engine';
import {
  MATRIX_HEART, matrixCircuit, matrixGpioImage, matrixSpiImage,
} from './fixtures/gpio-devices';

function rows(cells: boolean[]): number[] {
  return Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, col) => cells[row * 8 + col] ? 0x80 >> col : 0).reduce((a, b) => a | b, 0));
}

function runMatrix(hardwareSpi = false, type = 'matrix-8x8-max7219') {
  const { doc, partId } = matrixCircuit(type, hardwareSpi);
  const fw = new FirmwareEngine(doc);
  fw.load(doc, hardwareSpi ? matrixSpiImage(MATRIX_HEART) : matrixGpioImage(MATRIX_HEART), 'arduino-uno');
  fw.start();
  for (let i = 0; i < 30; i++) fw.run(5);
  return { fw, doc, partId };
}

describe('MAX7219 dot matrix from real AVR bus', () => {
  it.each(['matrix-8x8-max7219', 'emu-max7219'])('bit-bangs %s DIN/CLK/CS and renders row registers, not a guessed bitmap', (type) => {
    const { fw, partId } = runMatrix(false, type);
    const state = fw.snapshot().parts[partId];
    expect(state?.kind).toBe('matrix');
    if (state?.kind !== 'matrix') return;
    expect(rows(state.cells)).toEqual([0x66, 0xff, 0xff, 0x7e, 0x3c, 0x18, 0, 0]);
    expect(fw.snapshot().unsupported).toEqual([]);
  });

  it('decodes real SPDR hardware-SPI bytes and SPIF polling, with no simulated CLK GPIO edges', () => {
    const { fw, partId } = runMatrix(true);
    const state = fw.snapshot().parts[partId];
    expect(state?.kind).toBe('matrix');
    if (state?.kind !== 'matrix') return;
    expect(rows(state.cells)).toEqual([0x66, 0xff, 0xff, 0x7e, 0x3c, 0x18, 0, 0]);
    expect(fw.snapshot().unsupported).toEqual([]);
  });

  it('stays blank before initialization and when VCC is disconnected', () => {
    const { doc, partId } = matrixCircuit();
    const fw = new FirmwareEngine(doc);
    fw.load(doc, matrixGpioImage([[1, 0xff]]), 'arduino-uno');
    fw.start();
    fw.run(20);
    const before = fw.snapshot().parts[partId];
    expect(before?.kind === 'matrix' && before.cells.some(Boolean)).toBe(false);

    const powered = runMatrix();
    const wires = powered.doc.diagram.connections;
    powered.doc.diagram.connections = wires.filter((w) => w.to.pin !== 'VCC');
    powered.fw.update(powered.doc);
    const after = powered.fw.snapshot().parts[powered.partId];
    expect(after?.kind === 'matrix' && after.cells.some(Boolean)).toBe(false);
    powered.doc.diagram.connections = wires;
    powered.fw.update(powered.doc);
    const repowered = powered.fw.snapshot().parts[powered.partId];
    expect(repowered?.kind === 'matrix' && repowered.cells.some(Boolean)).toBe(false); // RAM reset on power cycle
  });

  it('does not fabricate pixels from disconnected CLK, and reports the undecodable bus', () => {
    const { doc, partId } = matrixCircuit();
    doc.diagram.connections = doc.diagram.connections.filter((w) => w.to.pin !== 'CLK');
    const fw = new FirmwareEngine(doc);
    fw.load(doc, matrixGpioImage(MATRIX_HEART), 'arduino-uno');
    fw.start();
    fw.run(20);
    const state = fw.snapshot().parts[partId];
    expect(state?.kind === 'matrix' && state.cells.some(Boolean)).toBe(false);
    expect(fw.snapshot().unsupported.join(' ')).toMatch(/CLK.*distinct board GPIO/);
  });
});
