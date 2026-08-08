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

import { SELF_RECOVERING_MARKER } from '../session/no-session-diagnosis.js';

/** A message that already carries its own concrete next action, so nothing should be appended. */
function isSelfRecovering(message: string): boolean {
  return message.includes(SELF_RECOVERING_MARKER);
}

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
    // `recordingName`, not `name`. The hint said `name`, so an agent that followed it exactly got
    // InvalidParams — a recovery that fails is worse than none, because it spends the retry.
    'No recording by that name is in progress. Start one with ' +
    'reticle_record { action: "start", recordingName } before annotating, stopping, or saving it.',
  STALE_REF:
    'That ref is stale: refs are invalidated whenever the DOM re-renders, so any action that ' +
    'navigated, opened a modal, re-sorted a list or changed the page invalidates every ref taken ' +
    'before it. Reticle refuses here rather than clicking whatever now occupies that slot. Call ' +
    'reticle_query again for a fresh ref and retry the action — and prefer reticle_act_and_wait ' +
    '{ until } when an action changes the page, so the next ref is taken after it settles.',
  BAD_ARGUMENTS:
    "That call did not match the tool's schema — the message above names the tool and the exact " +
    "argument it wanted. Re-read that tool's parameters and retry with the missing or corrected " +
    'argument. This is an invalid call, not a Reticle defect: there is nothing to report.',
  WRONG_TARGET:
    'That action does not apply to this element — the ref resolved, the element just cannot take it ' +
    '(you cannot fill a <button>, submit outside a form, or upload to anything but <input ' +
    'type="file">). Call reticle_snapshot or reticle_query to find the control that does, or ' +
    'reticle_inspect on this ref to see what it actually is. This is an invalid call, not a Reticle ' +
    'defect: there is nothing to report.',
  NOT_EDITABLE:
    'The field is disabled or readonly, so a user could not edit it either — forcing the value would ' +
    'put the app in a state nobody can reach, which is why Reticle refuses. This is usually the app ' +
    'telling you something: drive whatever ENABLES the field (open the editor, satisfy the ' +
    'precondition) and act again. If the field should have been editable, that is a bug in the app, ' +
    'not in Reticle.',
  CONFIRM_DANGEROUS:
    'Reticle blocked a potentially destructive control (delete, remove, revoke…) on purpose. If you ' +
    'mean it, retry the same action with args.confirmDangerous set to true. This is a deliberate ' +
    'refusal, not a defect: there is nothing to report.',
  UNSUPPORTED_SURFACE:
    'That surface is not supported yet, and Reticle refuses rather than pretending — a rich-text ' +
    'editor keeps its own document model, so writing to the DOM would look right and submit the old ' +
    'content. Drive the same outcome another way (a plain input, a command, a keyboard action) or ' +
    'assert on the result instead of typing it. Known gap, already reported: no need to file it.',
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
  // Every guard in the browser's executeAction. These are Reticle-authored refusals of an invalid
  // call, and ALL of them used to fall through to the feedback ask — including the destructive-action
  // block, which carries its own retry instruction and was still telling the agent Reticle might be
  // broken. Order matters: contenteditable and disabled/readonly are `cannot <verb> …` messages too,
  // so they must be tested before the general wrong-target rule.
  { match: /contenteditable/i, hint: RECOVERY.UNSUPPORTED_SURFACE },
  { match: /cannot \w+ a (disabled|readonly) </i, hint: RECOVERY.NOT_EDITABLE },
  { match: /potentially destructive action blocked/i, hint: RECOVERY.CONFIRM_DANGEROUS },
  {
    match:
      /^cannot [\w()]+ (?:a|an|into a|on a) <|no form to submit|upload target must be|is not an HTMLElement/i,
    hint: RECOVERY.WRONG_TARGET,
  },
  // Authored by Reticle, about the caller's arguments: the message already names the valid answers.
  { match: /^unknown action '/i, hint: RECOVERY.BAD_ARGUMENTS },
  { match: /^\w+ requires a string `\w+`/i, hint: RECOVERY.BAD_ARGUMENTS },
  // A message naming a `reticle_*` tool is one WE authored about our own API — an invalid call, not
  // an unanticipated failure. Left unmatched it collected the feedback ask, which pushed agents to
  // file reports about their own bad arguments. Kept LAST so a specific rule above always wins.
  {
    match: /reticle_[a-z_]+\s*\{[^}]*\}.*\b(requires|must|expected)\b/i,
    hint: RECOVERY.BAD_ARGUMENTS,
  },
];

/**
 * The actionable next move for a known error message, or undefined when none is recognized.
 *
 * A message that already carries its own next action gets NO second one. The no-session diagnosis
 * inspects the machine and says which of three causes this actually is; pairing that with the
 * generic "ask the human to start their app" produced a result that contradicted itself — the error
 * saying a server is running and the recovery saying to go start one.
 */
export function recoveryFor(message: string): string | undefined {
  if (isSelfRecovering(message)) return undefined;
  for (const rule of RULES) {
    if (rule.match.test(message)) return rule.hint;
  }
  return undefined;
}

/**
 * A schema rejection: the call named a parameter that does not exist, or gave one the wrong type.
 *
 * Matched by the SHAPES the validators actually produce (zod's codes, and the MCP layer's wrapper),
 * because these are our own machinery talking, not the app.
 */
const ARGUMENT_REJECTION =
  /Unrecognized key|unrecognized_keys|invalid_type|Invalid arguments for tool|Unknown parameters? for|^Required |Expected \w+, received/i;

/**
 * What to say instead of asking for a bug report. The schema already stated the problem precisely;
 * this only says who can fix it and where to look.
 */
const ARGUMENT_RECOVERY =
  'That call did not match the tool\'s schema — the message above names the parameter. Nothing ran, ' +
  'so no result is affected. Call reticle_tools { names: ["<tool>"] } for its exact parameters and ' +
  'retry.';

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
  // A self-diagnosing message gets NEITHER a generic recovery nor the feedback ask. It already
  // inspected the machine and named the cause; a second, contradictory hint is noise, and inviting a
  // bug report about a condition Reticle diagnosed itself is exactly backwards.
  if (isSelfRecovering(message)) return { error: message };
  // An argument rejection is the agent's to fix, not a Reticle defect. Reported from the field: a
  // clean `unrecognized_keys: ["value"]` came back wrapped in "may be a defect in Reticle", which
  // spends the agent's turn and fills the feedback channel with reports about malformed calls.
  if (ARGUMENT_REJECTION.test(message)) return { error: message, recovery: ARGUMENT_RECOVERY };
  const recovery = recoveryFor(message);
  return recovery !== undefined
    ? { error: message, recovery }
    : { error: message, feedback: FEEDBACK_ASK };
}
