import { describe, expect, it } from 'vitest';
import { SimEngine } from '../engine';
import { FirmwareEngine } from '../firmware/engine';
import { sevenSegmentCircuit, sevenSegmentImage } from '../firmware/fixtures/gpio-devices';

function sketchFor(mask: number): string {
  const pins = Array.from({ length: 8 }, (_, i) => `pinMode(${i + 2}, OUTPUT);`).join('\n');
  const drive = Array.from({ length: 8 }, (_, i) => `digitalWrite(${i + 2}, ${(mask >> i) & 1});`).join('\n');
  return `void setup() { ${pins}\n${drive} } void loop() {}`;
}

describe('seven-segment GPIO parity', () => {
  it.each([0x5b, 0x7f, 0x02, 0x80])('renders exactly the same physical segment mask 0x%s on both engines', (mask) => {
    const { doc, partId } = sevenSegmentCircuit();
    const functional = new SimEngine(doc);
    functional.load(doc, sketchFor(mask));
    functional.start();
    functional.tick(30);
    const firmware = new FirmwareEngine(doc);
    firmware.load(doc, sevenSegmentImage(mask), 'arduino-uno');
    firmware.start();
    firmware.run(30);
    expect(functional.snapshot().error).toBeNull();
    expect(firmware.snapshot().parts[partId]).toEqual(functional.snapshot().parts[partId]);
  });
});
