/**
 * Turning "no browser session connected" from a dead end into a next action.
 *
 * This is the most consequential sentence in the product. Measured over a day of telemetry: 74% of
 * sessions never call a Reticle tool, and of the ones that do, half make exactly ONE call — usually
 * `reticle_sessions` — and stop. Ten of those thirteen never touched a browser, and every recorded
 * session error is this one. The agent asks whether anything is connected, is told no, and leaves.
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

export interface NoSessionFacts {
  /** Whether ANY session has connected to this daemon since it booted. */
  everConnected: boolean;
  /** Whether this project has been through `reticle init` (a .reticle.json / projectId is present). */
  initialized: boolean;
  /** Localhost ports with something listening that looks like a dev server. */
  listening: readonly number[];
  /** The port this daemon is on — half of the mismatch the old message asked about. */
  port: number;
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
 * dial in. Measured over a day of telemetry it is the single strongest predictor of a session that
 * works: the 5 sessions that used it had a MEDIAN of 30 tool calls and produced 46% of every bug
 * found, against a median of 1 call for the 20 active sessions that did not — and not one
 * single-call bounce used one. It is also advertised on no profile except `full`, so an agent only
 * ever finds it if it already knew it existed. Naming it HERE puts it in front of the agent at the
 * one moment it is the answer, and costs nothing on the turns when it is not.
 *
 * Only offered when the app is known to carry the SDK: leasing an uninstrumented app just burns a
 * browser and comes back `ready:false`.
 */
const SELF_SERVE =
  'You do not have to wait for the human: reticle_lease {action:"acquire", url} opens a browser ' +
  'Reticle drives itself, and returns a sessionId you can use immediately (reach it with ' +
  'reticle_run {tool:"reticle_lease"} if it is not advertised directly; release it when you finish).';

export function diagnoseNoSession(facts: NoSessionFacts): string {
  const { everConnected, initialized, listening, port } = facts;
  const ports = listening.join(', ');

  if (everConnected) {
    return (
      'no browser session connected — but one WAS connected to this daemon earlier, so the wiring ' +
      'is correct. The tab was closed, navigated away, or hard-reloaded. Ask the human to reopen ' +
      `the app (or run \`reticle open\`), or reload the tab. ${SELF_SERVE} ${RETRY}`
    );
  }

  if (listening.length === 0) {
    return (
      'no browser session connected, and nothing is listening on any of the usual dev-server ports ' +
      '— so the app is almost certainly not running. This is not a Reticle wiring problem: ask the ' +
      `human to start their dev server (\`npm run dev\`), then open the app in a browser. ${RETRY}`
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
    `the app's reticle port matches ${String(port)}. ${SELF_SERVE} ${RETRY}`
  );
}
