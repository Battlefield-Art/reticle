/**
 * Blind-spot register — the never-silent statement of what the layer CANNOT see. Closed shadow roots,
 * cross-origin iframes, and virtualized-unmounted rows are documented limits; a result that touched one
 * says so (`coverage: partial — 2 cross-origin frames unobserved`) instead of implying it saw everything.
 * Pure formatting over the counted blind spots the observers report.
 */

export const BlindSpotKind = {
  CLOSED_SHADOW_ROOT: 'closed-shadow-root',
  CROSS_ORIGIN_IFRAME: 'cross-origin-iframe',
  VIRTUALIZED_UNMOUNTED: 'virtualized-unmounted',
} as const;
export type BlindSpotKind = (typeof BlindSpotKind)[keyof typeof BlindSpotKind];

export interface BlindSpot {
  kind: BlindSpotKind;
  count: number;
}

export interface CoverageStatement {
  coverage: 'full' | 'partial';
  /** Present only when partial — the human/agent-legible list of what went unobserved. */
  note?: string;
  spots: BlindSpot[];
}

const LABEL: Record<BlindSpotKind, (n: number) => string> = {
  [BlindSpotKind.CLOSED_SHADOW_ROOT]: (n) => `${String(n)} closed shadow root${n === 1 ? '' : 's'}`,
  [BlindSpotKind.CROSS_ORIGIN_IFRAME]: (n) => `${String(n)} cross-origin frame${n === 1 ? '' : 's'}`,
  [BlindSpotKind.VIRTUALIZED_UNMOUNTED]: (n) =>
    `${String(n)} virtualized unmounted row${n === 1 ? '' : 's'}`,
};

/** Compose the coverage statement. `full` (no note) when nothing was unobserved. */
export function buildCoverageStatement(spots: readonly BlindSpot[]): CoverageStatement {
  const present = spots.filter((s) => s.count > 0);
  if (present.length === 0) return { coverage: 'full', spots: [] };
  const note = `partial — ${present.map((s) => `${LABEL[s.kind](s.count)} unobserved`).join(', ')}`;
  return { coverage: 'partial', note, spots: present };
}
