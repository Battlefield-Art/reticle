/**
 * What a verification can FIND — the vocabulary of faults and contradictions shared by the crawl,
 * the contradiction hunter and the tools that report them. Split out of constants.ts to keep that
 * file under the size cap.
 */

/**
 * Cross-channel contradictions: two observation channels making INCOMPATIBLE claims about the same
 * action. This is the bug class a human structurally cannot see, because a human has one channel
 * open — the screen. The agent holds DOM, store, signals, console and network in one causally
 * ordered window and can notice they disagree.
 *
 * Every kind here describes a shipped-today false green: the run is green, the screen looks right,
 * and the app is wrong. Contrast `CrawlAnomalyKind`, whose members are all SINGLE-channel facts (an
 * error was logged; a request failed) — those are findable by reading one stream.
 */
export const ContradictionKind = {
  /** The screen moved forward while a request in the same window failed — the swallowed rejection. */
  UI_ADVANCED_REQUEST_FAILED: 'ui-advanced-request-failed',
  /** The app fired its own success signal while a request in the same window failed. Strongest form:
   *  the app did not merely look right, it explicitly ASSERTED success against its own evidence. */
  SIGNAL_CONTRADICTED: 'signal-contradicted',
  /** A write succeeded on the server and nothing on the client moved — the response went nowhere. */
  RESPONSE_IGNORED: 'response-ignored',
  /** The same write fired more than once in one action — double-submit / retry storm. */
  DUPLICATE_REQUEST: 'duplicate-request',
  /** The UI advanced while a request was still in flight, so `settled` was reported over a live call. */
  REQUEST_NEVER_SETTLED: 'request-never-settled',
  /**
   * The SERVER faulted (5xx) and the app blamed the USER — "invalid credentials" for a broken
   * backend, "not permitted" for a crashed service. The user is told to fix something they cannot
   * fix, and the real fault is never reported. A support ticket that costs hours to trace back.
   */
  FAILURE_MISATTRIBUTED: 'failure-misattributed',
} as const;
export type ContradictionKind = (typeof ContradictionKind)[keyof typeof ContradictionKind];

/**
 * HTTP methods that CHANGE server state. Several contradiction rules are restricted to these on
 * purpose: a GET that fires without moving the UI is a prefetch, but a POST that does is a lost
 * write. Narrowing to writes is what keeps the rules from crying wolf on ordinary reads.
 */
export const MUTATING_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE', 'IPC'];

export const CrawlAnomalyKind = {
  CONSOLE_ERROR: 'console-error', // the click logged a console.error / uncaught error
  FAILED_REQUEST: 'failed-request', // it fired a request that returned >= 400
  DEAD_CONTROL: 'dead-control', // it dispatched but the app did NOTHING (no DOM/net/route/signal)
} as const;
export type CrawlAnomalyKind = (typeof CrawlAnomalyKind)[keyof typeof CrawlAnomalyKind];
