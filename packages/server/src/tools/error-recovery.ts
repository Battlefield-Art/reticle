/**
 * Actionable error recovery. Every tool error the agent hits should answer "what do I do next?", not
 * just "what went wrong". This pure mapping turns a known error message into a concrete recovery hint
 * the agent (or the human, via the agent) can act on — so the first 5 minutes never dead-end on a
 * cryptic "no session connected". Spliced onto the error envelope at the MCP boundary (mcp.ts).
 *
 * Conservative by design: an unrecognized error returns `undefined` (no invented advice). Matching is
 * on stable, human-authored substrings of the thrown messages (see session-manager.ts, the flow/
 * baseline stores). No clock, no IO — unit-testable in isolation.
 */

/** The recovery hints, named so they are not free strings and can be asserted in tests. */
export const RECOVERY = {
  NO_SESSION:
    'No app is connected to Reticle. Ask the human to start their app in dev with @reticlehq/browser ' +
    'enabled, then run `reticle status` to confirm a session appears. If the app is running but no ' +
    'session shows, the SDK is not reaching the bridge — check the dev server is up and using the ' +
    'configured Reticle port.',
  MULTIPLE_SESSIONS:
    'Several tabs are connected. Call reticle_sessions to list them, then pass an explicit sessionId to ' +
    'target the one you mean.',
  UNKNOWN_SESSION:
    'That sessionId is not connected. Call reticle_sessions for the current ids and retry with a valid one.',
  THROTTLED:
    'The target tab is backgrounded/throttled, so actions may silently no-op. Ask the human to bring ' +
    'the tab to the front, or run `reticle drive <url>` for a guaranteed scriptable context.',
  MISSING_BASELINE:
    'That baseline does not exist yet. Call reticle_baseline { action: "list" } to see saved names, or ' +
    'reticle_baseline { action: "save", name } to capture one before diffing against it.',
  MISSING_RECORDING:
    'No recording by that name is in progress. Start one with reticle_record { action: "start", name } ' +
    'before annotating, stopping, or saving it.',
  STALE_REF:
    'That ref is stale: refs are invalidated whenever the DOM re-renders, so any action that ' +
    'navigated, opened a modal, re-sorted a list or changed the page invalidates every ref taken ' +
    'before it. Reticle refuses here rather than clicking whatever now occupies that slot. Call ' +
    'reticle_query again for a fresh ref and retry the action — and prefer reticle_act_and_wait ' +
    '{ until } when an action changes the page, so the next ref is taken after it settles.',
  TOKEN_REQUIRED:
    'The bridge binds beyond localhost and requires a pairing token. Set the same token in the SDK ' +
    'init (@reticlehq/core) and the Reticle server config, then reconnect.',
} as const;

/** Ordered match rules; the first hit wins. Substrings track the thrown messages they recover. */
const RULES: readonly { readonly match: RegExp; readonly hint: string }[] = [
  { match: /no browser session connected/i, hint: RECOVERY.NO_SESSION },
  { match: /multiple sessions connected/i, hint: RECOVERY.MULTIPLE_SESSIONS },
  { match: /no connected session with id/i, hint: RECOVERY.UNKNOWN_SESSION },
  { match: /throttled|backgrounded/i, hint: RECOVERY.THROTTLED },
  { match: /no baseline named/i, hint: RECOVERY.MISSING_BASELINE },
  { match: /no (?:active|compiled) recording named/i, hint: RECOVERY.MISSING_RECORDING },
  { match: /pairing token is required/i, hint: RECOVERY.TOKEN_REQUIRED },
  // The commonest post-action condition there is. Unmatched, it fell through to FEEDBACK_ASK and
  // told the agent a successful click's aftermath might be a bug in Reticle.
  { match: /no longer resolves to an element/i, hint: RECOVERY.STALE_REF },
];

/** The actionable next move for a known error message, or undefined when none is recognized. */
export function recoveryFor(message: string): string | undefined {
  for (const rule of RULES) {
    if (rule.match.test(message)) return rule.hint;
  }
  return undefined;
}

/**
 * The ask attached to errors we do NOT recognize. An unrecognized error is, by definition, the case
 * where Reticle failed in a way nobody anticipated — the single highest-value moment to hear from the
 * agent, and until now the moment where the agent worked around us in silence and we learned nothing.
 *
 * Deliberately NOT attached when a recovery hint matched: there the agent has a concrete next move,
 * and diverting it into filing a report about a failure we already understand costs a turn and tells
 * us nothing new.
 */
export const FEEDBACK_ASK =
  'This error is not one Reticle recognizes, which means it may be a defect in Reticle rather than in ' +
  'the app. If you believe Reticle misbehaved, call reticle_feedback with a root-cause analysis and ' +
  'the call trace before moving on — that report is the only way this gets fixed.';

/** The error envelope sent to the agent: the message, plus a recovery hint when one is known. */
interface ErrorPayload {
  error: string;
  recovery?: string;
  feedback?: string;
}

/**
 * Build the tool-error payload spliced at the MCP boundary. `recovery` is added when the error is
 * known; the feedback ask is added when it is NOT — the two are mutually exclusive by design, so the
 * agent always gets exactly one next move.
 */
export function buildErrorPayload(message: string): ErrorPayload {
  const recovery = recoveryFor(message);
  return recovery !== undefined
    ? { error: message, recovery }
    : { error: message, feedback: FEEDBACK_ASK };
}
