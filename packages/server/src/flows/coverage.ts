/**
 * Verified-surface coverage — the buddy channel's honest answer to "is EVERYTHING working?". A green on
 * three flows says nothing about the twelve testids never exercised. This measures the declared surface
 * (contract testids/signals/flows) actually touched by passing verification, so "everything" is honest
 * about what everything means. Pure set math; the deviation report + gate carry the number.
 */

export interface DeclaredSurface {
  testids: readonly string[];
  signals: readonly string[];
  flows: readonly string[];
}

export interface CoverageDimension {
  total: number;
  covered: number;
  /** Percent covered, rounded; 100 when nothing is declared (vacuously complete). */
  pct: number;
  /** Declared-but-never-exercised members — what "everything" is silently missing. */
  uncovered: string[];
}

export interface Coverage {
  testids: CoverageDimension;
  signals: CoverageDimension;
  flows: CoverageDimension;
  /** Overall percent across all three dimensions combined. */
  overallPct: number;
}

function dimension(declared: readonly string[], exercised: ReadonlySet<string>): CoverageDimension {
  const uncovered = declared.filter((d) => !exercised.has(d));
  const covered = declared.length - uncovered.length;
  const pct = 0 === declared.length ? 100 : Math.round((covered / declared.length) * 100);
  return { total: declared.length, covered, pct, uncovered };
}

export function computeCoverage(declared: DeclaredSurface, exercised: DeclaredSurface): Coverage {
  const testids = dimension(declared.testids, new Set(exercised.testids));
  const signals = dimension(declared.signals, new Set(exercised.signals));
  const flows = dimension(declared.flows, new Set(exercised.flows));
  const total = testids.total + signals.total + flows.total;
  const covered = testids.covered + signals.covered + flows.covered;
  const overallPct = 0 === total ? 100 : Math.round((covered / total) * 100);
  return { testids, signals, flows, overallPct };
}
