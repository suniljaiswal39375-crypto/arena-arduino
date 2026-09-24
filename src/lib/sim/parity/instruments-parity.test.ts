/**
 * Differential parity for inspect-bench instruments (oscilloscope & multimeter)
 * across both simulation engines (functional interpreter and AVR firmware emulator).
 */
import { describe, expect, it } from 'vitest';
import { SimEngine } from '../engine';
import { FirmwareEngine } from '../firmware/engine';
import { blinkFixture, BLINK_SKETCH } from '../firmware/fixtures/blink';

describe('Instruments parity across engines', () => {
  it('measures identical DC rails, series resistance, and continuity on both engines', () => {
    const { doc, unoId, ledId, hex } = blinkFixture();
    const resistor = doc.diagram.parts.find((p) => p.type === 'resistor')!;

    const fe = new SimEngine(doc);
    fe.load(doc, BLINK_SKETCH);
    fe.start();
    fe.tick(100, 1);

    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();
    fw.run(100);

    const feSnap = fe.snapshot();
    const fwSnap = fw.snapshot();

    expect(feSnap.multimeter).not.toBeNull();
    expect(fwSnap.multimeter).not.toBeNull();

    // 1. Passive resistance across the LED current-limiting resistor
    const feR = fe.multimeterReading('resistance', `${resistor.id}:1`, `${resistor.id}:2`);
    const fwR = fw.multimeterReading('resistance', `${resistor.id}:1`, `${resistor.id}:2`);
    expect(feR.displayText).toBe('220.0 Ω');
    expect(fwR.displayText).toBe('220.0 Ω');
    expect(feR.valid).toBe(true);
    expect(fwR.valid).toBe(true);

    // 2. Continuity along the wire from Uno D13 to resistor pin 1
    const feCont = fe.multimeterReading('continuity', `${unoId}:D13`, `${resistor.id}:1`);
    const fwCont = fw.multimeterReading('continuity', `${unoId}:D13`, `${resistor.id}:1`);
    expect(feCont.beep).toBe(true);
    expect(fwCont.beep).toBe(true);
    expect(feCont.displayText).toContain('SHORT');
    expect(fwCont.displayText).toContain('SHORT');

    // 3. DC voltage of 5V rail relative to GND
    const feV = fe.multimeterReading('dc-v', `${unoId}:5V`, `${unoId}:GND`);
    const fwV = fw.multimeterReading('dc-v', `${unoId}:5V`, `${unoId}:GND`);
    expect(feV.value).toBe(5.0);
    expect(fwV.value).toBe(5.0);
    expect(feV.displayText).toBe('+5.000 V');
    expect(fwV.displayText).toBe('+5.000 V');

    // 4. Diode forward drop across the LED
    const feDiode = fe.multimeterReading('diode', `${ledId}:A`, `${ledId}:K`);
    const fwDiode = fw.multimeterReading('diode', `${ledId}:A`, `${ledId}:K`);
    expect(feDiode.displayText).toBe('2.000 V');
    expect(fwDiode.displayText).toBe('2.000 V');
    expect(feDiode.status).toBe('ok');
    expect(fwDiode.status).toBe('ok');
  });

  it('captures matching oscilloscope waveforms and auto-measurements for blink on both engines', () => {
    const { doc, unoId, hex } = blinkFixture();

    const fe = new SimEngine(doc);
    fe.load(doc, BLINK_SKETCH);
    fe.start();

    const fw = new FirmwareEngine(doc);
    fw.load(doc, hex, 'arduino-uno');
    fw.start();

    // Advance both engines across multiple blink cycles (each cycle is 1000 ms: 500 ms high, 500 ms low)
    for (let i = 0; i < 25; i++) {
      fe.tick(100, 1);
      fw.run(100);
    }

    const feScope = fe.snapshot().scope!;
    const fwScope = fw.snapshot().scope!;

    expect(feScope).toBeDefined();
    expect(fwScope).toBeDefined();

    expect(feScope.ch1Source).toBe(`${unoId}:D13`);
    expect(fwScope.ch1Source).toBe(`${unoId}:D13`);

    // Peak-to-peak voltage should be 5V on both
    expect(feScope.measurements.ch1.vmax).toBe(5.0);
    expect(fwScope.measurements.ch1.vmax).toBe(5.0);
    expect(feScope.measurements.ch1.vmin).toBe(0.0);
    expect(fwScope.measurements.ch1.vmin).toBe(0.0);
    expect(feScope.measurements.ch1.vpp).toBe(5.0);
    expect(fwScope.measurements.ch1.vpp).toBe(5.0);

    // Both observe 1 Hz blink frequency
    expect(feScope.measurements.ch1.frequencyHz).toBeCloseTo(1.0, 0.2);
    expect(fwScope.measurements.ch1.frequencyHz).toBeCloseTo(1.0, 0.2);
  });
});
