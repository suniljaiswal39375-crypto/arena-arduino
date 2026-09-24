import { describe, expect, it } from 'vitest';
import { MISSIONS } from '@/lib/missions/missions';
import {
  BADGES,
  MASTERY_THRESHOLD,
  MIN_SUCCESSES,
  SKILLS,
  badgesFor,
  emptyProgress,
  newRecord,
  observe,
  recordFaultFixed,
  recordMission,
  skillsByDomain,
  stateOf,
} from './index';

describe('skill taxonomy', () => {
  it('has 26 skills across four domains and three tiers', () => {
    expect(SKILLS).toHaveLength(26);
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(26);
    expect(skillsByDomain()).toHaveLength(4);
    for (const skill of SKILLS) {
      expect([1, 2, 3]).toContain(skill.tier);
      expect(skill.name.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeGreaterThan(10);
    }
  });

  it('resolves every skill a mission claims to build', () => {
    const ids = new Set(SKILLS.map((s) => s.id));
    const dangling: string[] = [];
    for (const mission of MISSIONS) {
      for (const id of mission.skills) {
        if (!ids.has(id)) dangling.push(`${mission.slug}:${id}`);
      }
    }
    expect(dangling).toEqual([]);
  });
});

describe('bayesian mastery', () => {
  it('never masters a skill from a single observation', () => {
    const record = observe(newRecord('pc.ground-loop'), true);
    expect(stateOf(record)).not.toBe('mastered');
    expect(record.successes).toBe(1);
  });

  it('does not master a skill from a lucky streak of guesses alone', () => {
    let record = newRecord('pc.ground-loop');
    for (let i = 0; i < MIN_SUCCESSES - 1; i++) record = observe(record, true);
    expect(record.successes).toBe(MIN_SUCCESSES - 1);
    expect(stateOf(record)).not.toBe('mastered');
  });

  it('masters a skill after repeated varied success, and stays mastered', () => {
    let record = newRecord('pc.current-limiting-resistor');
    for (let i = 0; i < 12; i++) record = observe(record, true);
    expect(record.pKnown).toBeGreaterThanOrEqual(MASTERY_THRESHOLD);
    expect(stateOf(record)).toBe('mastered');
  });

  it('attributes one slip to carelessness, not to forgetting', () => {
    let record = newRecord('pc.current-limiting-resistor');
    for (let i = 0; i < 12; i++) record = observe(record, true);
    expect(stateOf(record)).toBe('mastered');

    // A single slip is what P_SLIP models: you knew it and fumbled it.
    record = observe(record, false);
    expect(stateOf(record)).toBe('mastered');
  });

  it('takes mastery away under sustained failure and gives it back on recovery', () => {
    let record = newRecord('pc.current-limiting-resistor');
    for (let i = 0; i < 12; i++) record = observe(record, true);
    expect(stateOf(record)).toBe('mastered');

    let slipped = 0;
    while (stateOf(record) === 'mastered' && slipped < 20) {
      record = observe(record, false);
      slipped++;
    }
    expect(slipped, 'sustained failure must eventually cost you the skill').toBeLessThan(20);
    expect(record.pKnown).toBeLessThan(MASTERY_THRESHOLD);
    expect(stateOf(record)).toBe('practising');

    for (let i = 0; i < 12; i++) record = observe(record, true);
    expect(stateOf(record)).toBe('mastered');
  });

  it('treats a failure as evidence, not as punishment', () => {
    const before = newRecord('pc.polarity');
    const after = observe(before, false);
    expect(after.attempts).toBe(1);
    expect(after.successes).toBe(0);
    expect(after.pKnown).toBeGreaterThan(0);
    expect(stateOf(after)).toBe('seen');
  });

  it('reports unknown for a skill never attempted', () => {
    expect(stateOf(undefined)).toBe('unknown');
    expect(stateOf(newRecord('ct.loops'))).toBe('unknown');
  });
});

describe('badges', () => {
  it('awards nothing on a fresh profile', () => {
    const ctx = badgesFor(emptyProgress());
    for (const badge of BADGES) {
      expect(badge.earned(ctx), `${badge.id} should not be earned instantly`).toBe(false);
    }
  });

  it('credits effort: fixing faults earns a badge', () => {
    let progress = emptyProgress();
    for (let i = 0; i < 10; i++) progress = recordFaultFixed(progress);
    const ctx = badgesFor(progress);
    const faultBadge = BADGES.find((b) => b.id === 'debugger');
    expect(faultBadge?.earned(ctx)).toBe(true);
  });

  it('credits finishing a first mission', () => {
    const progress = recordMission(emptyProgress(), ['pc.complete-circuit'], 'smart-streetlight');
    const ctx = badgesFor(progress);
    const first = BADGES.find((b) => b.id === 'first-circuit');
    expect(first?.earned(ctx)).toBe(true);
  });

  it('reports partial progress rather than a binary for locked badges', () => {
    const ctx = badgesFor(emptyProgress());
    for (const badge of BADGES) {
      const p = badge.progress(ctx);
      expect(p.need).toBeGreaterThan(0);
      expect(p.have).toBeGreaterThanOrEqual(0);
      expect(p.have).toBeLessThanOrEqual(p.need);
    }
  });

  it('has eleven badges with rationales that say why they exist', () => {
    expect(BADGES).toHaveLength(11);
    for (const badge of BADGES) {
      expect(badge.rationale.length, `${badge.id} has no rationale`).toBeGreaterThan(20);
    }
  });
});

describe('Chaos Lab evidence', () => {
  it('counts a solve towards Debugger, Master Troubleshooter and the skills involved', async () => {
    const { recordChaosSolve, emptyProgress, badgesFor, BADGES } = await import('./index');
    let p = emptyProgress();
    for (let i = 0; i < 3; i++) p = recordChaosSolve(p, ['pc.return-path']);
    expect(p.chaosSolved).toBe(3);
    expect(p.faultsFixed).toBe(3);
    expect(p.attempts).toBe(3);
    expect(p.skills['pc.return-path']?.successes).toBe(3);
    const ctx = badgesFor(p);
    expect(BADGES.find((b) => b.id === 'debugger')!.earned(ctx)).toBe(true);
    expect(BADGES.find((b) => b.id === 'master-troubleshooter')!.progress(ctx)).toEqual({ have: 3, need: 25 });
  });
});

import { completeMission } from './index';
describe('idempotent mission completion', () => {
  it('does not award evidence or attempts twice after undo/reload', () => {
    const once = completeMission(emptyProgress(), ['pc.complete-circuit'], 'blink');
    expect(once.attempts).toBe(1);
    expect(once.skills['pc.complete-circuit']?.successes).toBe(1);
    expect(completeMission(once, ['pc.complete-circuit'], 'blink')).toBe(once);
    expect(recordMission(once, ['pc.complete-circuit'], 'blink')).toBe(once);
  });
  it('records different missions independently and deduplicates skill lists', () => {
    const once = completeMission(emptyProgress(), ['pc.complete-circuit', 'pc.complete-circuit'], 'blink');
    const twice = completeMission(once, ['pc.complete-circuit'], 'traffic-light');
    expect(twice.attempts).toBe(2);
    expect(twice.skills['pc.complete-circuit']?.successes).toBe(2);
    expect(twice.completedMissions).toEqual(['blink', 'traffic-light']);
  });
});
