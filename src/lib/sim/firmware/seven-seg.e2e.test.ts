import { describe, expect, it } from 'vitest';
import { FirmwareEngine } from './engine';
import { sevenSegmentCircuit, sevenSegmentImage } from './fixtures/gpio-devices';

describe('seven-segment from real AVR GPIO', () => {
  it.each(['seven-segment', 'emu-7segment'])('renders the actual D2..D9 segment wires on %s', (type) => {
    const { doc, partId, boardId } = sevenSegmentCircuit(type);
    const fw = new FirmwareEngine(doc);
    fw.load(doc, sevenSegmentImage(0x5b), 'arduino-uno'); // a,b,d,e,g = 2
    fw.start();
    fw.run(30);
    expect(fw.snapshot().parts[partId]).toEqual({ kind: 'seven-seg', segments: 0x5b, value: '2' });
    expect(fw.boardDigitalDrive(boardId, 'D2')).toBe(1);
    expect(fw.boardDigitalDrive(boardId, 'D4')).toBe(0);
    expect(fw.snapshot().unsupported).toEqual([]);
  });

  it('shows raw segments for an irregular pattern, never a guessed digit', () => {
    const { doc, partId } = sevenSegmentCircuit();
    const fw = new FirmwareEngine(doc);
    fw.load(doc, sevenSegmentImage(0x5b, 0x80), 'arduino-uno');
    fw.start();
    fw.run(20);
    expect(fw.snapshot().parts[partId]).toEqual({ kind: 'seven-seg', segments: 0x80, value: '' });
  });

  it('does not light a digit without its common-cathode return', () => {
    const { doc, partId } = sevenSegmentCircuit();
    doc.diagram.connections = doc.diagram.connections.filter((w) => w.to.pin !== 'COM');
    const fw = new FirmwareEngine(doc);
    fw.load(doc, sevenSegmentImage(0x7f), 'arduino-uno');
    fw.start();
    fw.run(20);
    expect(fw.snapshot().parts[partId]).toEqual({ kind: 'seven-seg', segments: 0, value: '' });
  });
});
