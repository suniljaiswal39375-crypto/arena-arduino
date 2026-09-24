import { describe, expect, it } from 'vitest';
import { makePart, makeWire } from '@/lib/doc/factory';
import { FULL_STEP_PHASES, HALF_STEP_PHASES } from '../gpio-devices';
import { FirmwareEngine } from './engine';
import { stepperCircuit, stepperGpioImage } from './fixtures/gpio-devices';

describe('ULN2003/28BYJ-48 plain-GPIO phase decode (not shaft simulation)', () => {
  it.each(['uln2003', 'stepper-28byj48'])('observes all %s IN1..4 changes, not only the last frame', (type) => {
    const { doc, partId } = stepperCircuit(type);
    const fw = new FirmwareEngine(doc);
    fw.load(doc, stepperGpioImage([...HALF_STEP_PHASES, 1, 9]), 'arduino-uno');
    fw.start();
    fw.run(10); // every pattern is issued within a single rendered frame
    expect(fw.snapshot().parts[partId]).toEqual({
      kind: 'stepper', coils: 9, transitions: 7, sequence: 'half', phase: 7, powered: true,
    });
    expect(fw.snapshot().unsupported).toEqual([]);
  });

  it('recognizes full-step order without inferring motor position or torque', () => {
    const { doc, partId } = stepperCircuit();
    const fw = new FirmwareEngine(doc);
    fw.load(doc, stepperGpioImage(FULL_STEP_PHASES), 'arduino-uno');
    fw.start();
    fw.run(10);
    expect(fw.snapshot().parts[partId]).toMatchObject({
      kind: 'stepper', coils: 9, transitions: 3, sequence: 'full', phase: 3,
    });
  });

  it('does not invent input phases for a 28BYJ-48 connected only through an unmodelled ULN2003 OUT stage', () => {
    const { doc, boardId, partId } = stepperCircuit();
    const motor = makePart('stepper-28byj48', 500, 100);
    doc.diagram.parts.push(motor);
    for (let i = 1; i <= 4; i++) {
      doc.diagram.connections.push(makeWire({ part: partId, pin: `OUT${i}` }, { part: motor.id, pin: `IN${i}` }));
    }
    doc.diagram.connections.push(
      makeWire({ part: boardId, pin: '5V' }, { part: motor.id, pin: 'VCC' }),
      makeWire({ part: boardId, pin: 'GND' }, { part: motor.id, pin: 'GND' }),
    );
    const fw = new FirmwareEngine(doc);
    fw.load(doc, stepperGpioImage(HALF_STEP_PHASES), 'arduino-uno');
    fw.start();
    fw.run(10);
    expect(fw.snapshot().parts[motor.id]).toMatchObject({ kind: 'stepper', coils: null, transitions: 0 });
    expect(fw.snapshot().unsupported.join(' ')).toMatch(/stepper-28byj48.*driver outputs\/shaft motion/);
    expect(fw.snapshot().parts[partId]).toMatchObject({ kind: 'stepper', coils: 9, transitions: 7 });
  });

  it('an ambiguous or irregular pattern has no invented transition count', () => {
    const { doc, partId } = stepperCircuit();
    const fw = new FirmwareEngine(doc);
    fw.load(doc, stepperGpioImage([0x06, 0x09, 0x0f]), 'arduino-uno');
    fw.start();
    fw.run(10);
    expect(fw.snapshot().parts[partId]).toMatchObject({ kind: 'stepper', coils: 15, transitions: 0, phase: null });
    expect(fw.snapshot().unsupported.join(' ')).toMatch(/coil pattern 0xf is ambiguous\/unknown/);
  });
});
