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
  /**
   * Set when the assertion could not be EVALUATED at all — an under-specified call, or nothing
   * instrumented to read. Carries the sentence naming what is missing.
   */
  inconclusive?: string;
  /** Cross-channel disagreements found in the action's window. */
  contradictions?: readonly { kind: string }[];
  /** Did a real frame flush before the wait gave up? */
  settled?: boolean;
  /**
   * A write in this window answered `202 Accepted` — the server took the request and has NOT
   * finished processing it.
   */
  outcomePending?: boolean;
  /**
   * A write in this window returned 2xx with a payload that was never recorded, so its outcome was
   * never read. See `hasUnreadWriteOutcome` — the status line describes the transport, not the result.
   */
  outcomeUnread?: boolean;
}

export interface VerifiedVerdict {
  verified: Verified;
  /** One sentence naming the deciding evidence — never a restatement of the field. */
  because: string;
}

export function decideVerified(inputs: VerifiedInputs): VerifiedVerdict {
  const { pass, honesty, contradictions = [], settled, outcomePending, outcomeUnread } = inputs;

  // Ahead of the failure clause, because a failure is only the most actionable fact when there WAS
  // one. An assertion nobody could evaluate is not a defect in the app, and calling it one was
  // putting the agent's own malformed calls into the bug count.
  if (inputs.inconclusive !== undefined) {
    return {
      verified: Verified.UNKNOWN,
      because: `the assertion could not be evaluated: ${inputs.inconclusive}`,
    };
  }

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
      because:
        'nothing was asserted at a real grade, so passing proves nothing — assert a signal, request, or state path',
    };
  }

  // A `202 Accepted` is the server saying, in the only word HTTP has for it, that the outcome does
  // not exist yet. Treating 2xx as success makes every asynchronous workflow verifiable at exactly
  // the moment nothing has been decided.
  //
  // Measured on a logistics console with server-side reconciliation: a dispatch answered 202, the row
  // optimistically rendered "dispatched", the page settled, and the verdict came back `yes` — then
  // the server REVERTED it to `held` 1.2s later. Every channel agreed, and every channel was early.
  // UNKNOWN rather than NO: nothing has failed, and saying it has would be its own false report.
  if (outcomePending === true) {
    return {
      verified: Verified.UNKNOWN,
      because:
        'a write returned 202 Accepted, so the server has not finished processing it — this window cannot contain the outcome; re-check once it reconciles',
    };
  }

  // A write answered 2xx and its payload went unread, so the one channel that could contradict the
  // screen was never opened. Reporting `yes` here means "no channel disagreed" — true only because a
  // channel was closed. Measured on a shipments console: `POST /api/bulk-hold` → 200 with three of
  // nine items failed inside the body, banner reading "9 shipments held", verdict `yes`.
  //
  // UNKNOWN, not NO: nothing is known to have failed. The remedy is in the sentence, because an
  // agent that cannot act on a caveat will learn to skip it.
  if (outcomeUnread === true) {
    return {
      verified: Verified.UNKNOWN,
      because:
        'a write returned 2xx with a response body that was never recorded, so its outcome is unread — a 200 describes the transport, not the result (a batch reports per-item failures in the body, and every GraphQL error is a 200). Enable it where your app calls connect(): `reticle.connect({ captureNetworkBodies: true })`, then re-run',
    };
  }

  // Never settled: the page may still be moving, so the observation window may have closed early.
  if (settled === false) {
    return {
      verified: Verified.UNKNOWN,
      because:
        'the page never settled, so the reaction window may have closed before the app finished',
    };
  }

  // Partial coverage is a real caveat but not a blocker — it is reported in `honesty.coverage` and
  // does not by itself make a graded, clean, uncontradicted pass untrustworthy.
  //
  // It must not be described as clean, though. This sentence said "over a clean capture" regardless,
  // so a verdict could read `verified: yes ... over a clean capture` directly beside `coverage:
  // partial` — the prose contradicting the evidence block next to it. Whichever a reader believes,
  // one of them lied, and the whole point of this layer is that the sentence can be trusted on its
  // own. Seen on a one-way IPC send: coverage said the outcome was unobservable, `because` said clean.
  return {
    verified: Verified.YES,
    because:
      honesty.coverage?.partial === true
        ? `assertion held at ${honesty.grade} grade with no channel disagreeing, but coverage was PARTIAL — see \`coverage\` for what went unobserved`
        : `assertion held at ${honesty.grade} grade over a clean capture with no channel disagreeing`,
  };
}
