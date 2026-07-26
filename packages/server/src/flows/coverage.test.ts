import { describe, expect, it } from 'vitest';
import { computeCoverage } from './coverage.js';

describe('computeCoverage', () => {
  it('measures covered vs declared per dimension and names the gaps', () => {
    const declared = { testids: ['a', 'b', 'c', 'd'], signals: ['s1', 's2'], flows: ['checkout'] };
    const exercised = { testids: ['a', 'b'], signals: ['s1'], flows: ['checkout'] };
    const cov = computeCoverage(declared, exercised);
    expect(cov.testids).toEqual({ total: 4, covered: 2, pct: 50, uncovered: ['c', 'd'] });
    expect(cov.signals.pct).toBe(50);
    expect(cov.flows.pct).toBe(100);
    // overall = 4 covered / 7 declared ≈ 57
    expect(cov.overallPct).toBe(57);
  });

  it('is vacuously 100% when nothing is declared', () => {
    const cov = computeCoverage(
      { testids: [], signals: [], flows: [] },
      { testids: [], signals: [], flows: [] },
    );
    expect(cov.overallPct).toBe(100);
    expect(cov.testids.pct).toBe(100);
  });

  it('ignores exercised members that were never declared', () => {
    const cov = computeCoverage(
      { testids: ['a'], signals: [], flows: [] },
      { testids: ['a', 'ghost'], signals: [], flows: [] },
    );
    expect(cov.testids).toEqual({ total: 1, covered: 1, pct: 100, uncovered: [] });
  });
});
