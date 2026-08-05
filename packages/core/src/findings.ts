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
  /**
   * Two reads of the same endpoint were in flight together and settled OUT OF ORDER, so the one the
   * user asked for first is the one that landed last — and the screen is showing it.
   *
   * The classic filter/search race. It needs no bug in either request: whichever query the server
   * happens to answer more slowly wins, so the UI shows data for a query the user has already
   * replaced. Every channel reports success — both requests are 200, the control shows the new
   * selection, the page settles — which is why it survives review and why `settled` cannot catch it.
   *
   * Detectable only from a request TIMELINE, which is why a screenshot or a DOM snapshot can never
   * see it: the evidence is the interleaving, and by the time anyone looks, the interleaving is gone.
   */
  STALE_RESPONSE_APPLIED: 'stale-response-applied',
  /**
   * A request returned 2xx and reported failure inside its BODY.
   *
   * The status line describes the transport, not the outcome. GraphQL returns 200 for every error it
   * has; a bulk endpoint returns 200 for the batch and puts per-item failures in the payload; a
   * gateway-normalised API returns 200 with `success: false`. Every channel above the body — status,
   * UI advance, settle — agrees with the optimistic reading, which is exactly why this survives.
   */
  PARTIAL_FAILURE_IN_OK_RESPONSE: 'partial-failure-in-ok-response',
  /**
   * A money value was sent back to the API at a different SCALE than the API stated it.
   *
   * Payment APIs speak minor units (paise, cents) as integers; a UI renders major units; writing the
   * rendered number back into the same field is a 100x error the server accepts and reports as
   * processed. Detectable only by holding the request timeline with bodies — the number sent is
   * exactly the number on the screen, so every other channel agrees it is correct.
   */
  UNIT_MISMATCH: 'unit-mismatch',
  /**
   * A write returned success and its OWN echo shows a field it was asked to set was not applied.
   *
   * Ordinary in real backends: a column missing from the UPDATE, a schema stripping unknown keys, a
   * PATCH honouring a subset, an enum falling back to a default. The status is 2xx, the body reports
   * no failure, the UI advanced, the page settled — so every channel except the payload agrees the
   * save worked, and the screen goes on showing the value the user typed rather than the value that
   * was stored. Measured on a preferences write that asked for `locale: fr` and echoed `locale: en`.
   */
  WRITE_FIELD_IGNORED: 'write-field-ignored',
  /** The UI advanced while a request was still in flight, so `settled` was reported over a live call. */
  REQUEST_NEVER_SETTLED: 'request-never-settled',
  /**
   * The SERVER faulted (5xx) and the app blamed the USER — "invalid credentials" for a broken
   * backend, "not permitted" for a crashed service. The user is told to fix something they cannot
   * fix, and the real fault is never reported. A support ticket that costs hours to trace back.
   */
  FAILURE_MISATTRIBUTED: 'failure-misattributed',
  /**
   * The action was dispatched and NOTHING happened — no DOM, no store, no route, no request, no
   * signal, no console line. The click landed on something that does not react.
   *
   * A contradiction rather than a warning because two channels disagree: the act layer reports
   * `dispatched: true, settled: true`, and every observation channel reports an empty window. The
   * settle half is the trap — a page that does nothing is quiet, and quiet is exactly what `settled`
   * tests for, so `until: { kind: 'settled' }` PASSES on a dead click and the verdict read
   * `verified: "yes", because: "no channel disagreeing"`. Measured on a real merchant dashboard by
   * clicking a `styled.div` that `reticle_query { by: 'text' }` had resolved instead of the button
   * beside it: zero events, store unchanged, green verdict.
   */
  ACTION_HAD_NO_EFFECT: 'action-had-no-effect',
  /**
   * The route changed and NOTHING was rendered for it — no content added, none removed, no request.
   * The URL says you arrived somewhere; the page is blank.
   *
   * This is the class every "did the control work" heuristic misses, because the control DID work:
   * it navigated. Measured on a real merchant dashboard with nine such links (Invoices, Route,
   * Subscriptions, QR Codes, Customers…), `reticle_crawl` drove all nine and reported
   * `deadControls: 0` — correctly, by its own definition, since a route change is activity.
   *
   * The discriminator came from executing both cases and comparing, not from reasoning: a working
   * nav emitted `domAdded: 1, network: 2`; a blank one emitted `domAdded: 0, domRemoved: 0,
   * network: 0` and left the page at an eighth the size. A real transition either fetches something
   * or renders something.
   *
   * MEASURED PRECISION, and the limit is real: 11 findings on that dashboard, 10 of them genuinely
   * blank destinations (verified by reading the DOM directly, not by asking Reticle), 1 false
   * positive. The false positive is instructive rather than fixable by tuning — a route whose view
   * is REVEALED from DOM that already existed emits `route.change` + `dom.attr` and nothing else,
   * which is byte-for-byte the window a blank destination emits. No event-only rule separates them.
   * Over-warning is the safe direction here (a false alarm costs a glance; a blank page shipped as
   * working does not), so it is reported with that ceiling stated rather than tuned into silence.
   */
  ROUTE_RENDERED_NOTHING: 'route-rendered-nothing',
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
