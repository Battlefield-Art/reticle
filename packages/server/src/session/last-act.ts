/**
 * What the most recent action was, kept so a LATER tool call can judge the window it opened.
 *
 * Reticle's act and observe tools are separate calls by design — act returns a cursor immediately and
 * the agent decides when to look. That split means the tool doing the judging holds none of the facts
 * the tool doing the acting measured, and every honesty check that needs both has to bridge the gap
 * somewhere. This is that somewhere.
 *
 *  - **cursor** — the evaluation floor for wait_for/assert, so a signal buffered BEFORE the act can
 *    never fake a later pass.
 *  - **source** — where the acted control is written, for failures that have no element left to point
 *    at because the action unmounted it.
 *  - **action + mutatedWithin** — what was done and how much changed inside the target. Without these
 *    the "this click did nothing" check is unreachable on the ordinary act-then-observe flow: an
 *    empty-window test is a statement about the PAGE, and no real app has a quiet page.
 */
interface ActEffect {
  action?: string | undefined;
  /** DOM mutations inside the acted element's own subtree. Undefined means nobody measured. */
  mutatedWithin?: number | undefined;
}

export class LastAct {
  #cursor: number | undefined;
  #source: string | undefined;
  #effect: ActEffect | undefined;

  markCursor(cursor: number): void {
    this.#cursor = cursor;
  }

  cursor(): number | undefined {
    return this.#cursor;
  }

  markSource(source: string | undefined): void {
    this.#source = source;
  }

  source(): string | undefined {
    return this.#source;
  }

  markEffect(action: string | undefined, mutatedWithin: number | undefined): void {
    this.#effect = { action, mutatedWithin };
  }

  /** Empty when nothing has acted — callers then fall back to checks that need no action context. */
  effect(): ActEffect {
    return this.#effect ?? {};
  }
}
