import { Verified } from '@reticlehq/core';
import { HonestyGrade, type HonestyBlock } from './honesty.js';

/**
 * The decision rule: eight trust dimensions in, one answer out.
 *
 * Everything needed to judge an action already travelled on the result — the assertion verdict, the
 * grade it proved, whether the capture was clean, whether the page settled, whether any channel
 * disagreed. What was missing was the RULE, so every agent had to invent one, and inventing it under
 * uncertainty is exactly where a confident wrong answer comes from.
 *
 * Ordering is deliberate, because the first matching clause also writes `because`, and the reader
 * should be told the most actionable fact rather than the first true one.
 */

export interface VerifiedInputs {
  /** Did the declared consequence hold? Undefined when the action declared none. */
  pass?: boolean;
  honesty: HonestyBlock;
  /** Cross-channel disagreements found in the action's window. */
  contradictions?: readonly { kind: string }[];
  /** Did a real frame flush before the wait gave up? */
  settled?: boolean;
}

export interface VerifiedVerdict {
  verified: Verified;
  /** One sentence naming the deciding evidence — never a restatement of the field. */
  because: string;
}

export function decideVerified(inputs: VerifiedInputs): VerifiedVerdict {
  const { pass, honesty, contradictions = [], settled } = inputs;

  // A failed assertion is the most actionable fact there is; it leads.
  if (pass === false) {
    return { verified: Verified.NO, because: 'the declared consequence did not hold' };
  }

  // A contradiction outranks a passing assertion, and that inversion is the whole point: the case
  // this product exists to catch is a green assertion sitting on top of a failed write. Measured on
  // the bench app — `ui-advanced-request-failed` arrived with verdict.pass true and every other
  // channel agreeing. Letting `pass` win there would report exactly the false green being detected.
  if (contradictions.length > 0) {
    const kinds = contradictions.map((c) => c.kind).join(', ');
    return {
      verified: Verified.NO,
      because: `channels disagree about this action (${kinds}) even though the assertion passed`,
    };
  }

  // Dirty capture is NOT failure. The layer could not see part of the window, so any green is a
  // statement about what it happened to observe — which is precisely the thing that must not be
  // reported as proof.
  if (!honesty.integrity.clean) {
    return {
      verified: Verified.UNKNOWN,
      because: `capture was not clean (${honesty.integrity.issues.join('; ')}), so a green here would only describe what was observed`,
    };
  }

  // A vacuous green: nothing was actually proved. Grade NONE means no signal, no request, no state
  // change and no element was pinned — the assertion could not have failed, which makes passing it
  // evidence of nothing.
  if (honesty.grade === HonestyGrade.NONE) {
    return {
      verified: Verified.UNKNOWN,
      because: 'nothing was asserted at a real grade, so passing proves nothing — assert a signal, request, or state path',
    };
  }

  // Never settled: the page may still be moving, so the observation window may have closed early.
  if (settled === false) {
    return {
      verified: Verified.UNKNOWN,
      because: 'the page never settled, so the reaction window may have closed before the app finished',
    };
  }

  // Partial coverage is a real caveat but not a blocker — it is reported in `honesty.coverage` and
  // does not by itself make a graded, clean, uncontradicted pass untrustworthy.
  return {
    verified: Verified.YES,
    because: `assertion held at ${honesty.grade} grade over a clean capture with no channel disagreeing`,
  };
}
