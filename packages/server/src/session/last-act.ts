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

  /**
   * Record an action that ACTUALLY DISPATCHED — cursor and effect together, never one without the
   * other.
   *
   * It used to be two setters called BEFORE the ref was resolved, so a refused act (stale ref, a
   * disabled control, a paused page) left a cursor and an empty effect standing. The next observe
   * saw a cursor inside its window, asked for the effect, found `mutatedWithin: undefined` over a
   * quiet window and reported "the click was dispatched and the page settled … the target does not
   * react" — about a click nobody dispatched, blaming a control that was fine, on exactly the
   * re-query-and-retry path the stale-ref message sends the agent down.
   *
   * Marking only on the success path is what makes that unrepeatable: a failure mode added later
   * cannot forget to clean up state that was never written.
   */
  markActed(cursor: number, action: string | undefined, mutatedWithin: number | undefined): void {
    this.#cursor = cursor;
    this.#effect = { action, mutatedWithin };
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

  /** Empty when nothing has acted — callers then fall back to checks that need no action context. */
  effect(): ActEffect {
    return this.#effect ?? {};
  }
}
