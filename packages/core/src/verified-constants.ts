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
/**
 * The machine-readable half of the same correction.
 *
 * `network_mock` and `viewport` returned `reason: "no-visual-provider"`, so an agent gating on the
 * code — the field that exists precisely to be matched on — was gating on a false statement: neither
 * tool captures anything visual. Fixing only the human-readable recommendation would have left the
 * lie in the part machines read, which is the wrong half to leave wrong.
 *
 * Safe to introduce: nothing outside this repo matches the old code, and the visual tools keep it.
 */
export const CDP_NO_PROVIDER_REASON = 'no-cdp-provider';

export const CDP_NO_PROVIDER_RECOMMENDATION =
  'this needs a Reticle-driven browser (it is applied through CDP, which the always-on SDK cannot do) — start with `reticle drive <url>` or set RETICLE_CDP_URL';

/**
 * A region the SDK cannot see into — surfaced (never hidden) so a result's coverage reads honestly.
 * Crosses the wire in a BLIND_SPOT event's `kind`, so it lives in core (the contract), not the server.
 */
export const BlindSpotKind = {
  CLOSED_SHADOW_ROOT: 'closed-shadow-root',
  /**
   * The bridge sampled: events arrived faster than its per-second cap, so some were dropped.
   *
   * This replaces DISCONNECTING, which is the one thing an observability layer must not do when it
   * sees too much. Measured: every network request emits two messages (pending + settled), so the cap
   * binds at ~500 requests/second — reachable by a dashboard burst and continuous for a streaming app.
   * Going blind there meant the biggest, most complex apps were exactly the ones Reticle could not
   * watch, and the failure was silent.
   *
   * Reported like any other blind spot, so a verdict over a sampled window says `coverage: partial`
   * instead of implying it saw everything.
   */
  RATE_LIMITED: 'rate-limited',
  CROSS_ORIGIN_IFRAME: 'cross-origin-iframe',
  VIRTUALIZED_UNMOUNTED: 'virtualized-unmounted',
  /**
   * Something wrapped `fetch` before we did, so the request we record is not necessarily the request
   * that leaves. Wrappers chain outermost-first: anything installed EARLIER sits below us and mutates
   * after we have read `init.body`. An interceptor initialised before connect(), or a polyfill, does
   * exactly that. Unfixable from inside the page — there is no "patch last" primitive — so it is
   * declared instead, and a verdict over it reports partial coverage rather than implying we saw the wire.
   */
  WRAPPED_NETWORK: 'wrapped-network',
} as const;
export type BlindSpotKind = (typeof BlindSpotKind)[keyof typeof BlindSpotKind];
