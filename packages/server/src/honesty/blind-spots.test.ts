import { describe, expect, it } from 'vitest';
import { BlindSpotKind, buildCoverageStatement } from './blind-spots.js';

describe('buildCoverageStatement', () => {
  it('reports full coverage when nothing went unobserved', () => {
    expect(buildCoverageStatement([])).toEqual({ coverage: 'full', spots: [] });
    expect(buildCoverageStatement([{ kind: BlindSpotKind.CROSS_ORIGIN_IFRAME, count: 0 }]).coverage).toBe('full');
  });

  it('reports partial coverage with a legible note listing what was unobserved', () => {
    const statement = buildCoverageStatement([
      { kind: BlindSpotKind.CROSS_ORIGIN_IFRAME, count: 2 },
      { kind: BlindSpotKind.CLOSED_SHADOW_ROOT, count: 1 },
    ]);
    expect(statement.coverage).toBe('partial');
    expect(statement.note).toBe('partial — 2 cross-origin frames unobserved, 1 closed shadow root unobserved');
  });

  it('drops zero-count spots from the note', () => {
    const statement = buildCoverageStatement([
      { kind: BlindSpotKind.CROSS_ORIGIN_IFRAME, count: 0 },
      { kind: BlindSpotKind.VIRTUALIZED_UNMOUNTED, count: 5 },
    ]);
    expect(statement.spots).toHaveLength(1);
    expect(statement.note).toContain('5 virtualized unmounted rows');
  });
});
