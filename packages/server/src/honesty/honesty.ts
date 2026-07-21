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

/** Coverage when the SDK reported no blind spots during the window — it saw everything it can see. */
const FULL_COVERAGE_PCT = 100;

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
  /** Present only when an envelope was actually sampled — never a fabricated zero. */
  envelope?: { samples: number; sufficient: boolean };
  /** `pct` is present only when it was measured (or provably full); `partial` is always known. */
  coverage: { pct?: number; partial: boolean };
  integrity: { clean: boolean; issues: string[] };
}

export function buildHonestyBlock(inputs: HonestyInputs): HonestyBlock {
  const issues: string[] = [];
  if (inputs.truncated === true) issues.push('capture truncated');
  for (const spot of inputs.blindSpots ?? []) issues.push(`blind spot: ${spot}`);

  // Report only what was measured. `envelope` used to be emitted unconditionally with samples=0, so
  // every act carried `sufficient: false` — and the tool description tells the agent to gate on this
  // block, meaning an agent that obeyed rejected 100% of green verdicts on a value that never changed.
  // A field that always reads "insufficient" is worse than an absent one: it looks like a finding.
  const samples = inputs.envelopeSamples;
  const partial = inputs.coveragePartial ?? false;
  // Nothing blind reported ⇒ the SDK saw everything it is able to see. When coverage IS partial we know
  // that much but not the fraction, so the percentage is omitted rather than invented.
  const pct = inputs.coveragePct ?? (partial ? undefined : FULL_COVERAGE_PCT);

  return {
    grade: inputs.grade,
    ...(inputs.attribution === undefined ? {} : { attribution: inputs.attribution }),
    ...(samples === undefined
      ? {}
      : { envelope: { samples, sufficient: samples >= MIN_ENVELOPE_SAMPLES } }),
    coverage: { ...(pct === undefined ? {} : { pct }), partial },
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
