/**
 * What to do when a ref goes stale in the MIDDLE of a sequence.
 *
 * Refs are invalidated by a re-render, and `reticle_act_sequence` exists precisely because the
 * caller cannot re-snapshot between steps. So `fill -> fill -> submit` fails on step two the moment
 * step one causes React to re-render — and the SAME refs then work when the caller retries the whole
 * sequence by hand, which is the tell: this is a race with the render, not a dead element. Losing
 * the sequence to it makes the tool unusable for the exact shape it was built for.
 *
 * The fix is one retry, after the app has been given the grace period it already gets elsewhere, and
 * ONLY for staleness. A genuinely gone element fails again immediately, and a step that failed for
 * any other reason is never retried — a tool that quietly re-runs actions would turn one click into
 * two, which is worse than the failure it was papering over.
 */
import { waitForReaction } from './react-grace.js';

/** Matches the daemon's own wording, which error-recovery.ts also keys its STALE_REF hint off. */
const STALE_REF = /no longer resolves to an element/i;

export const isStaleRefError = (error: string | undefined): boolean =>
  error !== undefined && STALE_REF.test(error);

/** The shape a step attempt returns. Structural so this file needs nothing from the tool layer. */
export interface StepOutcome {
  ok: boolean;
  // `| undefined` explicitly: the daemon's command result declares these as optional-and-undefined,
  // and under exactOptionalPropertyTypes a bare `?` is a narrower type it does not satisfy.
  error?: string | undefined;
  result?: unknown;
}

/** Just enough of a session for the grace period. Same structural contract react-grace.ts uses. */
type ReactionSource = Parameters<typeof waitForReaction>[0];

const realSleep = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Run one step, and retry it once if — and only if — its ref went stale under a re-render.
 *
 * `attempt` is called at most twice with identical arguments, so it must be the same idempotent
 * dispatch the caller would have made itself.
 */
export async function runStepWithStaleRetry(
  attempt: () => Promise<StepOutcome>,
  session: ReactionSource,
  since: number,
  budgetMs: number,
  opts: { sleep(ms: number): Promise<void> } = realSleep,
): Promise<StepOutcome> {
  const first = await attempt();
  if (first.ok || !isStaleRefError(first.error)) return first;
  await waitForReaction(session, since, budgetMs, opts);
  return attempt();
}
