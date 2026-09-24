import { describe, expect, it } from 'vitest';
import { MISSIONS, type Mission } from './missions';
import { referenceDoc } from './reference';
import { checkMission, missionProgress, missionBom } from './validate';
import { runERC } from '@/lib/erc/diagnostics';
import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import { getPart } from '@/lib/parts';
import type { ProjectDoc } from '@/lib/doc/types';

function allNotes(mission: Mission): Set<string> {
  const notes = new Set<string>();
  for (const step of mission.steps) {
    if (step.validate.type === 'manualConfirm') notes.add(step.validate.note);
  }
  return notes;
}

describe('mission catalogue', () => {
  it('has 16 missions in a coherent order', () => {
    expect(MISSIONS).toHaveLength(16);
    expect(new Set(MISSIONS.map((m) => m.slug)).size).toBe(16);
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(16);
  });

  it('references only parts that exist in the catalogue', () => {
    for (const mission of MISSIONS) {
      for (const { type } of missionBom(mission)) {
        expect(getPart(type), `${mission.slug} uses unknown part ${type}`).toBeDefined();
      }
      for (const p of mission.placement) {
        expect(getPart(p.type), `${mission.slug} places unknown part ${p.type}`).toBeDefined();
      }
    }
  });

  it('places every component in its BOM', () => {
    for (const mission of MISSIONS) {
      const placed = new Set(mission.placement.map((p) => p.type));
      for (const type of mission.components) {
        expect(placed.has(type), `${mission.slug} lists ${type} but never places it`).toBe(true);
      }
    }
  });

  it('only prerequires earlier missions', () => {
    const index = new Map(MISSIONS.map((m, i) => [m.slug, i]));
    for (const mission of MISSIONS) {
      for (const pre of mission.prerequisites) {
        expect(index.has(pre), `${mission.slug} prerequires unknown mission ${pre}`).toBe(true);
        expect(
          (index.get(pre) ?? 99) < (index.get(mission.slug) ?? 0),
          `${mission.slug} prerequires a later mission ${pre}`,
        ).toBe(true);
      }
    }
  });

  it('anchors every skill it claims to the taxonomy', () => {
    for (const mission of MISSIONS) {
      expect(mission.skills.length, `${mission.slug} claims no skills`).toBeGreaterThan(0);
      expect(mission.learningObjectives.length).toBeGreaterThan(0);
      expect(mission.steps.length).toBeGreaterThan(3);
    }
  });
});

describe('reference solutions', () => {
  it.each(MISSIONS.map((m) => [m.slug, m] as [string, Mission]))(
    '%s: following every instruction completes the mission',
    (_slug, mission) => {
      const doc = referenceDoc(mission);
      const results = checkMission(mission, doc, allNotes(mission));
      const failures = results
        .filter((r) => r.status !== 'done')
        .map((r) => `${r.id}: ${r.instruction}`);
      expect(failures).toEqual([]);
      expect(missionProgress(results).complete).toBe(true);
    },
  );

  it.each(MISSIONS.map((m) => [m.slug, m] as [string, Mission]))(
    '%s: the reference circuit has no blocking electrical fault',
    (_slug, mission) => {
      const doc = referenceDoc(mission);
      const errors = runERC(doc)
        .filter((d) => d.severity === 'error')
        .map((d) => `${d.code}: ${d.explanation}`);
      expect(errors).toEqual([]);
    },
  );

  it.each(MISSIONS.map((m) => [m.slug, m] as [string, Mission]))(
    '%s: the starter sketch is not already the answer',
    (_slug, mission) => {
      expect(mission.starterCode.trim()).not.toEqual(mission.referenceSketch.trim());
      const doc = referenceDoc(mission);
      doc.files['sketch.ino'] = mission.starterCode;
      const progress = missionProgress(checkMission(mission, doc, allNotes(mission)));
      expect(progress.complete, 'the starter sketch alone should not complete the mission').toBe(
        false,
      );
    },
  );
});
