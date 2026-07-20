/**
 * The honesty block — one machine-readable field composing everything that qualifies a verdict's
 * trustworthiness: the assertion grade, the attribution tier, the envelope maturity, the verified-surface
 * coverage, and the capture integrity. The invariant: a green may never LOOK stronger than its honesty
 * block. Harnesses gate on it (e.g. "grade ≥ net AND integrity clean"). This is pure composition +
 * assessment — all five components already exist individually; wiring it onto results is a later step.
 */

/** Assertion grade, strongest first — the tier the verdict actually proved. */
export const HonestyGrade = {
  SIGNAL: 'signal',
  NET: 'net',
  STATE: 'state',
  PRESENCE: 'presence',
  NONE: 'none',
} as const;
export type HonestyGrade = (typeof HonestyGrade)[keyof typeof HonestyGrade];

const GRADE_RANK: Record<HonestyGrade, number> = {
  [HonestyGrade.SIGNAL]: 4,
  [HonestyGrade.NET]: 3,
  [HonestyGrade.STATE]: 2,
  [HonestyGrade.PRESENCE]: 1,
  [HonestyGrade.NONE]: 0,
};

/** Below this envelope sample count a deviation verdict is noise, not judgment. */
const MIN_ENVELOPE_SAMPLES = 3;

export interface HonestyInputs {
  grade: HonestyGrade;
  /** Present when a causal chain is presented; `window` = time-heuristic, never dataflow truth. */
  attribution?: string;
  envelopeSamples?: number;
  coveragePct?: number;
  coveragePartial?: boolean;
  truncated?: boolean;
  blindSpots?: readonly string[];
}

export interface HonestyBlock {
  grade: HonestyGrade;
  attribution?: string;
  envelope: { samples: number; sufficient: boolean };
  coverage: { pct: number; partial: boolean };
  integrity: { clean: boolean; issues: string[] };
}

export function buildHonestyBlock(inputs: HonestyInputs): HonestyBlock {
  const samples = inputs.envelopeSamples ?? 0;
  const issues: string[] = [];
  if (inputs.truncated === true) issues.push('capture truncated');
  for (const spot of inputs.blindSpots ?? []) issues.push(`blind spot: ${spot}`);
  return {
    grade: inputs.grade,
    ...(inputs.attribution === undefined ? {} : { attribution: inputs.attribution }),
    envelope: { samples, sufficient: samples >= MIN_ENVELOPE_SAMPLES },
    coverage: { pct: inputs.coveragePct ?? 0, partial: inputs.coveragePartial ?? false },
    integrity: { clean: issues.length === 0, issues },
  };
}

export interface HonestyBar {
  /** The minimum grade a green must carry to be trusted (default: any). */
  minGrade?: HonestyGrade;
  /** Require capture integrity to be clean (no truncation / blind spots). */
  requireIntegrityClean?: boolean;
}

/** Whether a verdict's honesty block clears the harness's bar. Reasons list every failed criterion. */
export function meetsHonestyBar(
  block: HonestyBlock,
  bar: HonestyBar = {},
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (bar.minGrade !== undefined && GRADE_RANK[block.grade] < GRADE_RANK[bar.minGrade]) {
    reasons.push(`grade ${block.grade} below required ${bar.minGrade}`);
  }
  if (bar.requireIntegrityClean === true && !block.integrity.clean) {
    reasons.push(`integrity not clean: ${block.integrity.issues.join('; ')}`);
  }
  return { ok: reasons.length === 0, reasons };
}
