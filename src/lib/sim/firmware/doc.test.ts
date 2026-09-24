/**
 * Tests for the firmware document/view seam: which board a doc targets, the
 * sketch + libraries view the compile service receives, and library parsing.
 */
import { describe, expect, it } from 'vitest';
import { createProject, makePart } from '@/lib/doc/factory';
import {
  boardTypeOf,
  firmwareDoc,
  parseLibraries,
  DEFAULT_EMPTY_SKETCH,
} from './doc';
import { loadFirmware, sketchMetaFirmware } from './loaders';
import { assembleHex } from './fixtures/blink';

describe('boardTypeOf', () => {
  it('finds the single board instance in the diagram', () => {
    const doc = createProject({ name: 'x' });
    const uno = makePart('arduino-uno', 100, 100);
    doc.diagram.parts.push(uno);
    expect(boardTypeOf(doc)).toBe('arduino-uno');
  });

  it('falls back to doc.board when no board instance is on the canvas', () => {
    const doc = createProject({ name: 'x', board: 'arduino-nano' });
    expect(boardTypeOf(doc)).toBe('arduino-nano');
  });
});

describe('firmwareDoc', () => {
  it('reads sketch.ino and libraries.txt', () => {
    const doc = createProject({ name: 'x' });
    doc.files['sketch.ino'] = 'void setup() {}\nvoid loop() {}\n';
    doc.files['libraries.txt'] = 'Servo@1.2.1\n\n# comment\nWire\n';
    const view = firmwareDoc(doc);
    expect(view.sketch).toBe(doc.files['sketch.ino']);
    expect(view.libraries).toEqual(['Servo@1.2.1', 'Wire']);
  });

  it('defaults an empty sketch rather than crashing', () => {
    const doc = createProject({ name: 'x' });
    doc.files['sketch.ino'] = '';
    const view = firmwareDoc(doc);
    expect(view.sketch).toBe(DEFAULT_EMPTY_SKETCH);
  });
});

describe('parseLibraries', () => {
  it('parses names and pinned versions, ignores blanks and comments', () => {
    expect(parseLibraries('Servo\nDHT sensor library@1.4.2\n// note\n# hash\n')).toEqual([
      'Servo',
      'DHT sensor library@1.4.2',
    ]);
  });
});

describe('loadFirmware + sketchMetaFirmware', () => {
  it('validates a compiled hex into a runnable program', async () => {
    const prog = await loadFirmware(assembleHex('start: rjmp start'), 'arduino-uno');
    expect(prog.words).toBeGreaterThan(0);
    expect(prog.sketchHash).toBeNull();
    expect(prog.boardType).toBe('arduino-uno');
  });

  it('rejects a malformed image with a bounded error', async () => {
    await expect(loadFirmware('not hex', 'arduino-uno')).rejects.toThrow();
  });

  it('reports #include intent and a parse failure honestly', () => {
    const ok = sketchMetaFirmware({
      boardType: 'arduino-uno',
      sketch: '#include <Servo.h>\nvoid setup() {}\nvoid loop() {}\n',
      libraries: [],
    });
    expect(ok.ok).toBe(true);
    expect(ok.includes).toContain('Servo.h');

    const bad = sketchMetaFirmware({
      boardType: 'arduino-uno',
      sketch: 'void setup( { broken',
      libraries: [],
    });
    expect(bad.ok).toBe(false);
    expect(bad.err).not.toBeNull();
  });
});
