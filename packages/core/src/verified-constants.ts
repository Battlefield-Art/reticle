/**
 * The ONE field an agent reads to decide whether a change is verified.
 *
 * An action result carries eight trust dimensions — dispatched, settled, ok, grade, attribution,
 * coverage, integrity, and the assertion verdict — and until now no rule for combining them. Driving
 * this surface produced `settled:false, settleReason:"timeout"` on a fill, and there was no way to
 * tell whether that was a bug or noise; the honest answer was "I could not tell", and the honest
 * answer was unavailable. Eight judgment calls per action is eight chances to guess wrong.
 *
 * UNKNOWN is load-bearing and must never collapse into NO. "The capture was truncated so I could not
 * see" and "the app is broken" lead an agent to opposite next moves: one says look again with better
 * coverage, the other says go fix something. Merging them manufactures both false alarms and false
 * confidence, which is the entire failure class this project exists to remove.
 */
export const Verified = {
  /** Proved: the assertion held, at a real grade, over a clean capture, with no channel disagreeing. */
  YES: 'yes',
  /** Disproved: the assertion failed, or the channels contradict each other. Go look. */
  NO: 'no',
  /** Not determinable from this evidence — vacuous grade, dirty capture, or never settled. */
  UNKNOWN: 'unknown',
} as const;
export type Verified = (typeof Verified)[keyof typeof Verified];

/**
 * Actionable companion to NO_PROVIDER for the tools that genuinely intercept or capture through CDP
 * — network mocking and viewport control — which is NOT "visual capture".
 *
 * They used to return VISUAL_NO_PROVIDER_RECOMMENDATION verbatim, so asking to stub a request was
 * answered with "visual capture needs a driven browser". An agent reading that concludes it asked
 * the wrong KIND of question and goes looking for a screenshot tool, when the requirement is simply
 * a driven browser.
 */
export const CDP_NO_PROVIDER_RECOMMENDATION =
  'this needs a Reticle-driven browser (it is applied through CDP, which the always-on SDK cannot do) — start with `reticle drive <url>` or set RETICLE_CDP_URL';
