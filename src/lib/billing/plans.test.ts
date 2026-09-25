import { describe, expect, it } from 'vitest';
import { FEATURE_MATRIX, PLANS, cellFor, planById } from './plans';

describe('pricing plan model', () => {
  it('ships exactly the three documented tiers, free first', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['free', 'classroom', 'school']);
  });

  it('never invents a price: free is ₹0, paid tiers are explicitly undecided', () => {
    expect(planById('free').priceInr).toBe(0);
    expect(planById('classroom').priceInr).toBeNull();
    expect(planById('school').priceInr).toBeNull();
    for (const plan of PLANS) {
      expect(plan.priceNote.length).toBeGreaterThan(0);
      expect(plan.bullets.length).toBeGreaterThan(0);
    }
  });

  it('everything that exists today is reachable without paying', () => {
    // Any feature that is not hosted-planned must show as usable on the
    // free tier (included outright, or free to self-host).
    for (const row of FEATURE_MATRIX) {
      const cell = cellFor(row, 'free');
      if (row.availability === 'local') expect(cell).toBe('included');
      else if (row.availability === 'self-host') expect(cell).toBe('self-host');
      else expect(cell).toBe('not-included');
    }
  });

  it('paid tiers include everything shipped plus only well-attributed planned items', () => {
    for (const plan of ['classroom', 'school'] as const) {
      for (const row of FEATURE_MATRIX) {
        const cell = cellFor(row, plan);
        if (row.availability !== 'hosted-planned') expect(cell).toBe('included');
        else if (row.hostedIn.includes(plan)) expect(cell).toBe('planned');
        else expect(cell).toBe('not-included');
      }
    }
  });

  it('plans only promise hosted features they actually attribute', () => {
    for (const row of FEATURE_MATRIX) {
      for (const plan of row.hostedIn) {
        expect(['classroom', 'school']).toContain(plan);
      }
      if (row.availability === 'hosted-planned') {
        expect(row.hostedIn.length).toBeGreaterThan(0);
      }
    }
    // Org-level items stay org-level.
    const org = FEATURE_MATRIX.find((r) => r.id === 'org-admin');
    expect(org?.hostedIn).toEqual(['school']);
  });
});
