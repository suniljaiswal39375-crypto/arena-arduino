import { describe, expect, it } from 'vitest';
import { HALF_STEP_PHASES } from '../gpio-devices';
import { SimEngine } from '../engine';
import { FirmwareEngine } from '../firmware/engine';
import { stepperCircuit, stepperGpioImage } from '../firmware/fixtures/gpio-devices';

function sketchFor(masks: number[]): string {
  const setup = [
    ...Array.from({ length: 4 }, (_, i) => `pinMode(${i + 2}, OUTPUT);`),
    ...masks.flatMap((coils) => Array.from({ length: 4 }, (_, i) =>
      `digitalWrite(${i + 2}, ${(coils >> i) & 1});`)),
  ];
  return `void setup() { ${setup.join('\n')} } void loop() {}`;
}

describe('ULN2003 plain-GPIO parity', () => {
  it('observes the same forward/wrap/reverse commanded coil phase transitions on both engines', () => {
    const { doc, partId } = stepperCircuit();
    const masks = [...HALF_STEP_PHASES, 1, 9];
    const fe = new SimEngine(doc);
    fe.load(doc, sketchFor(masks));
    fe.start();
    fe.tick(50);
    const fw = new FirmwareEngine(doc);
    fw.load(doc, stepperGpioImage(masks), 'arduino-uno');
    fw.start();
    fw.run(50);
    expect(fe.snapshot().error).toBeNull();
    expect(fw.snapshot().parts[partId]).toEqual(fe.snapshot().parts[partId]);
    expect(fw.snapshot().parts[partId]).toMatchObject({ kind: 'stepper', coils: 9, transitions: 7 });
    // No motor shaft angle, physical step rate or ULN2003 output stage is claimed.
  });

  it('the functional Stepper.h four-wire model now drives real GPIO phases instead of advancing an inert timer', () => {
    const { doc, partId } = stepperCircuit();
    const fe = new SimEngine(doc);
    fe.load(doc, `#include <Stepper.h>
Stepper motor(2048, 2, 3, 4, 5);
void setup() { motor.setSpeed(20); motor.step(6); }
void loop() {}`);
    fe.start();
    fe.tick(1000);
    expect(fe.snapshot().error).toBeNull();
    expect(fe.snapshot().parts[partId]).toMatchObject({ kind: 'stepper', sequence: 'full' });
    expect(fe.snapshot().clockUs).toBeGreaterThan(0);
  });
});
