/**
 * Turning "no browser session connected" from a dead end into a next action.
 *
 * This is the most consequential sentence in the product. Most sessions never call a Reticle tool at
 * all, and of the ones that do, a large share make exactly ONE call — usually `reticle_sessions` —
 * and stop. Almost none of those ever touched a browser, and this is the session error they hit. The
 * agent asks whether anything is connected, is told no, and leaves.
 *
 * The old message asked the agent to check two things it cannot see from where it stands ("is your
 * app running with the SDK enabled?", "does it point at this port?"). The daemon can actually tell
 * the three cases apart, and each has a different, concrete fix:
 *
 *   - a session was here and went away    -> the tab closed or reloaded; reopen it
 *   - something is listening, never dialled, project not wired -> run `reticle init` in THAT app
 *   - something is listening, project wired -> port mismatch or a stale build; restart the dev server
 *   - nothing is listening anywhere       -> there is no app running; start it
 *
 * Pure: everything it needs is passed in, so the probe that discovers listening ports stays out of
 * the hot resolve() path and this stays unit-testable.
 */

import { DEV_SERVER_PORTS } from '../cli/cli-port.js';

interface NoSessionFacts {
  /** Whether ANY session has connected to this daemon since it booted. */
  everConnected: boolean;
  /** Whether this project has been through `reticle init` (a .reticle.json / projectId is present). */
  initialized: boolean;
  /** Localhost ports with something listening that looks like a dev server. */
  listening: readonly number[];
  /** The port this daemon is on — half of the mismatch the old message asked about. */
  port: number;
  /**
   * This daemon has reaped at least one EXPIRED pooled lease.
   *
   * Deliberately not "the session that just vanished was that lease" — nothing knows that. It is
   * evidence, not proof, and the message below is worded accordingly.
   */
  leaseExpired?: boolean;
}

/**
 * Every branch ends with this, and `recoveryFor` keys on it to suppress the generic no-session
 * recovery: a message that already carries its own next action must not be handed a second, more
 * generic one that contradicts it.
 */
export const SELF_RECOVERING_MARKER =
  'Then call reticle_sessions again — it will appear within a second of the page loading.';
const RETRY = SELF_RECOVERING_MARKER;

/**
 * The way out that needs no human at all.
 *
 * `reticle_lease` opens a browser Reticle drives itself, instead of waiting for somebody's tab to
 * dial in. In the field it is the single strongest predictor of a session that works: sessions that
 * use it drive an order of magnitude more tool calls than those that do not, they account for a
 * disproportionate share of every bug found, and no single-call bounce has ever used one. It is also
 * advertised on no profile except `full`, so an agent only ever finds it if it already knew it
 * existed. Naming it HERE puts it in front of the agent at the one moment it is the answer, and
 * costs nothing on the turns when it is not.
 *
 * Only offered when the app is known to carry the SDK: leasing an uninstrumented app just burns a
 * browser and comes back `ready:false`.
 */
const SELF_SERVE =
  'You do not have to wait for the human: reticle_lease {action:"acquire", url} opens a browser ' +
  'Reticle drives itself, and returns a sessionId you can use immediately (reach it with ' +
  'reticle_run {tool:"reticle_lease"} if it is not advertised directly; release it when you finish).';

/**
 * The ports the scan actually covers, rendered for the message.
 *
 * Derived from DEV_SERVER_PORTS rather than re-typed: a message that lists ports the scan does not
 * check, or omits ones it does, is a new version of the same defect — a confident claim about
 * evidence that was never gathered.
 */
/**
 * The second half of the answer for a project that never went through `init`.
 *
 * Held separately because it must appear ONLY when the project is uninstrumented — telling a wired
 * project to re-run `init` sends the reader back to a step that already succeeded, which is its own
 * kind of wrong answer.
 */
const UNINSTRUMENTED =
  'Separately: this project has not been through `reticle init`, which is what installs the SDK ' +
  'and wires it into the build — so even once the dev server is up, the app will carry no SDK and ' +
  "no session will appear. Run `reticle init` in the app's directory too.";

/**
 * The one cause that produces a PERFECTLY healthy everything and still never connects.
 *
 * The SDK refuses to dial from a page that is not on localhost unless `allowNonLocalhost` is set.
 * That is deliberate — Reticle must not be reachable from a page it does not trust — but the refusal
 * happens page-side, so the daemon sees only silence, `doctor` sees only a healthy daemon, and every
 * checklist item passes. Reported from the field by an agent on a hosts-file alias (the normal setup
 * for white-label and multi-tenant apps): the whole setup was lost to a flag named in no checklist,
 * and `init`'s own fallback snippet guards on `hostname === 'localhost'`, so on such a host the
 * connect never runs and there is not even a console line to find.
 *
 * Only offered on the wired-and-listening branch: that is where a correctly installed app that
 * cannot connect actually lands.
 */
const NON_LOCALHOST_GATE =
  'One more cause that leaves every other check healthy: if the app is served on anything other ' +
  'than localhost (a hosts-file alias, a LAN IP, a tunnel), the SDK refuses to connect unless it ' +
  'is given `allowNonLocalhost: true` — the refusal is page-side, so nothing here can see it. ' +
  "Check the browser console for that message and pass the flag in the app's reticle.connect().";

const SCANNED_PORTS = [...DEV_SERVER_PORTS].join(', ');

export function diagnoseNoSession(facts: NoSessionFacts): string {
  const { everConnected, initialized, listening, port } = facts;
  const ports = listening.join(', ');

  if (everConnected) {
    // A reaped lease first, because it is the one cause we have POSITIVE evidence for. Reported
    // from the field (#157): an aged-out lease produced "the tab was closed … ask the human to
    // reopen the app", which is wrong on every clause — there is no human tab, and the recovery it
    // names is unavailable to the caller while the one that works goes unmentioned. The reporter
    // went looking for a port mismatch. Hedged rather than swapped: a human tab may ALSO have
    // closed, and this does not know which session went.
    if (true === facts.leaseExpired) {
      return (
        'no browser session connected — but one WAS connected to this daemon earlier, so the wiring ' +
        'is correct. This daemon has expired at least one pooled lease, so the likeliest cause is ' +
        'that a lease you were using aged out; a lease is a headless context, not a human tab, and ' +
        'it takes its cookies with it (so an authenticated app needs signing in again). Re-acquire ' +
        'with reticle_lease {action:"acquire", url} and carry on. If you were driving a human tab ' +
        `instead, it went away — reopen it or run \`reticle open\`. ${RETRY}`
      );
    }
    return (
      'no browser session connected — but one WAS connected to this daemon earlier, so the wiring ' +
      'is correct. The tab was closed, navigated away, or hard-reloaded. Ask the human to reopen ' +
      `the app (or run \`reticle open\`), or reload the tab. ${SELF_SERVE} ${RETRY}`
    );
  }

  if (0 === listening.length) {
    return (
      'no browser session connected, and nothing is listening on the ports Reticle scans ' +
      `(${SCANNED_PORTS}). The likeliest cause by far is that the dev server is not running: ask ` +
      'the human to start it (`npm run dev`), then open the app in a browser. ' +
      // The caveat is here rather than omitted because the scan is NARROW, and the old sentence
      // spent its confidence as though an empty result from eleven ports were proof of absence.
      // Reported from a scripted drive of 2.5.0: this branch asserted the app was not running while
      // it served 200 on :7699. A dev server on any other port — 4173 from `vite preview`, 1420
      // from Tauri, 5175 from a second Vite, anything passed to --port — is invisible to it.
      'That scan is narrow, so it is not proof: a server on any other port is invisible to it. If ' +
      // Deliberately NOT offering reticle_lease here, and a test pins that: a lease opens a URL, and
      // if nothing is listening there is nothing at any URL to open. Asking for the real one is the
      // only move that can recover the :7699 case.
      'the app IS running, ask the human for its URL rather than assuming it is down. ' +
      // BOTH facts at once when the project was never wired. This branch fires before the
      // `!initialized` one, so an uninstrumented project used to be told only "start your dev
      // server" — the reader starts it, calls again, and is told ONLY THEN that no app carries the
      // SDK. Two round trips to learn two things the daemon knew on the first call, and this is the
      // largest cohort in the funnel (#171): users who attached an agent and never instrumented an
      // app. They have a daemon (they registered the MCP server) and no SDK anywhere.
      `${initialized ? '' : UNINSTRUMENTED} ${RETRY}`
    );
  }

  if (!initialized) {
    return (
      `no browser session connected, but something IS listening on port ${ports} — so a server is ` +
      'up and has never dialled this daemon. This project has not been through `reticle init`, ' +
      'which is what installs the SDK and wires it into the build, so the likeliest cause is that ' +
      "the app carries no Reticle SDK. Ask the human to run `reticle init` in the app's directory " +
      `and restart the dev server. ${RETRY}`
    );
  }

  return (
    `no browser session connected, but something IS listening on port ${ports} and this project is ` +
    `wired for Reticle — so the app is either serving a build made before the wiring landed, or ` +
    `dialling a different daemon than this one (this daemon is on ${String(port)}). Ask the human ` +
    'to restart the dev server and hard-reload the page; if it still does not appear, check that ' +
    `the app's reticle port matches ${String(port)}. ${NON_LOCALHOST_GATE} ${SELF_SERVE} ${RETRY}`
  );
}
