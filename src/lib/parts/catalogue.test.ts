import { describe, expect, it } from 'vitest';
import { ALL_PARTS, EMULATOR_CATALOGUE, getPart } from '@/lib/parts';
import { fromWokwiDiagram, toWokwiDiagram, wokwiTypeFor } from '@/lib/interop/wokwi';
import { templateDoc } from '@/lib/templates';

/**
 * The emulator catalogue grew part by part; these tests pin the shape so a
 * new entry cannot silently collide with or shadow an existing one.
 */
describe('emulator catalogue', () => {
  it('has unique part ids, and no two emulator parts share a Wokwi type', () => {
    // Several SparkLab parts legitimately share one Wokwi type (the servo
    // family all becomes wokwi-servo); the sparklabType attribute restores
    // the exact type on import. But two *emulator* parts mapping to the same
    // type would be an ambiguous picker entry.
    const ids = new Set<string>();
    for (const def of ALL_PARTS) {
      expect(ids.has(def.id), `duplicate part id ${def.id}`).toBe(false);
      ids.add(def.id);
    }
    const wokwiTypes = new Set<string>();
    for (const def of EMULATOR_CATALOGUE) {
      const wokwi = def.wokwi;
      expect(wokwi, def.id).toBeTruthy();
      if (!wokwi) throw new Error(`emulator part ${def.id} has no wokwi type`);
      expect(wokwiTypes.has(wokwi), `duplicate wokwi type ${wokwi} on ${def.id}`).toBe(false);
      wokwiTypes.add(wokwi);
    }
  });

  it('maps every emulator part to a Wokwi type, so nothing in it is skipped on export', () => {
    for (const def of EMULATOR_CATALOGUE) {
      expect(wokwiTypeFor(def.id), def.id).not.toBeNull();
    }
  });

  it('ships the spec §9.B additions with their verified Wokwi ids', () => {
    const expected: Record<string, string> = {
      'emu-pushbutton-6mm': 'wokwi-pushbutton-6mm',
      'emu-74hc595': 'wokwi-74hc595',
      'emu-74hc165': 'wokwi-74hc165',
      'emu-nlsf595': 'wokwi-nlsf595',
      'emu-biaxial-stepper': 'wokwi-biaxial-stepper',
      'emu-ws2812-ring': 'wokwi-led-ring',
      'emu-ws2812-strip': 'wokwi-led-strip',
      'emu-franzininho-wifi': 'board-franzininho-wifi',
    };
    for (const [id, wokwi] of Object.entries(expected)) {
      const def = getPart(id);
      expect(def, id).toBeDefined();
      expect(wokwiTypeFor(id), id).toBe(wokwi);
    }
    // The parts the engine does not decode say so honestly instead of claiming EXACT.
    for (const id of ['emu-74hc595', 'emu-74hc165', 'emu-nlsf595', 'emu-biaxial-stepper']) {
      expect(getPart(id)!.fidelity.tier, id).toBe('visual');
    }
  });

  it('round-trips a newly added part through a Wokwi export and import', () => {
    const doc = templateDoc('uno-blink')!;
    doc.diagram.parts.push({ id: 'sr', type: 'emu-74hc595', x: 0, y: 0, rotate: 0, attrs: {} });
    const { diagram, skipped } = toWokwiDiagram(doc);
    expect(skipped.find((s) => s.id === 'sr')).toBeUndefined();
    const part = diagram.parts.find((p) => p.id === 'sr')!;
    expect(part.type).toBe('wokwi-74hc595');
    const back = fromWokwiDiagram(diagram).doc;
    expect(back.diagram.parts.find((p) => p.id === 'sr')?.type).toBe('emu-74hc595');
  });
});
