import { describe, expect, it } from 'vitest';
import { FEEDBACK_ASK, RECOVERY, buildErrorPayload, recoveryFor } from './error-recovery.js';
import { TOOLS } from './tools.js';
import { diagnoseNoSession } from '../session/no-session-diagnosis.js';

describe('recoveryFor — every known error carries an actionable next move', () => {
  it('maps the no-session footgun to a concrete recovery', () => {
    const hint = recoveryFor(
      'no browser session connected — is your app running with @reticlehq/browser enabled?',
    );
    expect(hint).toBe(RECOVERY.NO_SESSION);
    expect(hint).toMatch(/reticle status/);
  });

  it('maps multiple-sessions to "pass a sessionId from reticle_sessions"', () => {
    expect(recoveryFor('multiple sessions connected — pass sessionId to target one: a, b')).toBe(
      RECOVERY.MULTIPLE_SESSIONS,
    );
  });

  it('maps an unknown sessionId to "list ids and retry"', () => {
    expect(recoveryFor("no connected session with id 'ghost'")).toBe(RECOVERY.UNKNOWN_SESSION);
  });

  it('maps a throttled-tab refusal to the refocus / reticle drive escape hatch', () => {
    expect(
      recoveryFor(
        'refusing to act: tab throttled; timer/rAF/pointer gestures may silently no-op — refocus before driving',
      ),
    ).toBe(RECOVERY.THROTTLED);
  });

  it('maps a missing baseline / recording to the create-it-first hint', () => {
    expect(recoveryFor('no baseline named "home"')).toBe(RECOVERY.MISSING_BASELINE);
    expect(recoveryFor('no active recording named "ship"')).toBe(RECOVERY.MISSING_RECORDING);
    expect(recoveryFor('no compiled recording named "ship"')).toBe(RECOVERY.MISSING_RECORDING);
  });

  it('maps the pairing-token error to its config fix', () => {
    expect(
      recoveryFor('a pairing token is required when the Reticle bridge binds beyond localhost'),
    ).toBe(RECOVERY.TOKEN_REQUIRED);
  });

  it('returns undefined for an unrecognized error (never invents a hint)', () => {
    expect(recoveryFor('save failed: disk_full')).toBeUndefined();
    expect(recoveryFor('')).toBeUndefined();
  });
});

describe('buildErrorPayload — the MCP-boundary envelope', () => {
  it('adds recovery only when the error is recognized', () => {
    const known = buildErrorPayload('no browser session connected — is your app running?');
    expect(known).toEqual({
      error: 'no browser session connected — is your app running?',
      recovery: RECOVERY.NO_SESSION,
    });
    // An UNRECOGNIZED error gets no recovery hint — there is none to give — but it is also the case
    // most likely to be a defect in Reticle itself, so it carries the feedback ask instead. The two
    // are mutually exclusive on purpose: the agent always gets exactly one next move.
    const unknown = buildErrorPayload('save failed: disk_full');
    expect(unknown).toEqual({ error: 'save failed: disk_full', feedback: FEEDBACK_ASK });
    expect('recovery' in unknown).toBe(false);
  });
});

/**
 * A recovery hint is only useful if the tool it names can actually be called.
 *
 * Two hints told the agent to call `reticle_record_start` and `reticle_baseline_list`. Both had been
 * folded into action-dispatched tools by MERGE_PLANS and are no longer advertised, so the one message
 * whose whole job is "here is the way out" pointed at a door that is not there. Nothing caught it:
 * the strings are prose, and prose is not type-checked.
 */
describe('every tool a recovery hint names must still be advertised', () => {
  const advertised = new Set(TOOLS.map((tool) => tool.name));

  it.each(Object.entries(RECOVERY))('%s names only reachable tools', (_name, hint) => {
    for (const mentioned of hint.match(/reticle_[a-z_]+/g) ?? []) {
      expect(
        advertised,
        `${mentioned} is named by a recovery hint but is not advertised`,
      ).toContain(mentioned);
    }
  });
});

/**
 * The commonest event in an agent loop, and it was classified as "possibly a Reticle defect".
 *
 * `reticle_act` invalidates refs whenever the DOM re-renders — a click that navigates, a list that
 * re-sorts, a modal that opens. The browser throws `ref 'e6' no longer resolves to an element`,
 * which is Reticle working correctly: it refuses rather than clicking whatever now occupies that
 * slot, and refusing is the whole point.
 *
 * But the message was not in RULES, so it got FEEDBACK_ASK — "this error is not one Reticle
 * recognizes, which means it may be a defect in Reticle". Measured against a real `reticle mcp`
 * process: three tool calls in one sweep, every one of them told the agent to consider filing a bug
 * about the single most ordinary thing that happens after a successful click. That costs the agent a
 * turn it should have spent re-querying, and fills the maintainers' feedback with a non-bug.
 */
describe('a stale ref is a recognized, recoverable condition — not an unknown defect', () => {
  it('maps the stale-ref throw to "query again for a fresh ref"', () => {
    const hint = recoveryFor("ref 'e6' no longer resolves to an element");
    expect(hint).toBe(RECOVERY.STALE_REF);
    expect(String(hint)).toContain('reticle_query');
  });

  it('names the CAUSE, so the agent stops reusing refs across a re-render', () => {
    expect(String(RECOVERY.STALE_REF)).toMatch(/re-render|changed the page|navigat/i);
  });

  it('and it is recognized, so no feedback ask is attached', () => {
    expect(recoveryFor("ref 'e12' no longer resolves to an element")).toBeDefined();
  });
});

/**
 * Reticle's OWN argument-validation errors were being reported as unknown failures.
 *
 * `reticle_lease{action:"acquire"} requires a url` is a message this codebase authored, about its
 * own API, naming the exact tool and argument at fault. It is the opposite of an unanticipated
 * failure — and it was getting FEEDBACK_ASK: "this error is not one Reticle recognizes, which means
 * it may be a defect in Reticle rather than in your app."
 *
 * Two costs. The agent is pushed toward filing a report instead of fixing its call, and the
 * maintainers' feedback fills with reports about callers passing the wrong arguments. Measured
 * against real `reticle mcp` processes driving bench-app, atlas and next-smoke: the same error, the
 * same wrong classification, in all three.
 *
 * A message that names a `reticle_*` tool is by definition one we wrote. Treat it as recognized.
 */
describe("Reticle's own validation errors are recognized, not reported as unknown defects", () => {
  it('maps a tool argument-validation error to "check the schema and retry"', () => {
    const hint = recoveryFor('reticle_lease{action:"acquire"} requires a url');
    expect(hint).toBe(RECOVERY.BAD_ARGUMENTS);
    // Deliberately names no tool: `reticle_tools` is advertised under the default hybrid profile
    // but NOT under `full`, so pointing at it would be dead advice for exactly the callers who
    // opted into the larger surface. The failing tool's own name is already in the message.
    expect(String(hint)).toContain('not a Reticle defect');
  });

  it('recognizes the shape generally, not just that one tool', () => {
    expect(recoveryFor('reticle_flow{action:"save"} requires a flowName')).toBe(
      RECOVERY.BAD_ARGUMENTS,
    );
  });

  it('still returns undefined for a genuinely unknown failure, so real defects keep the ask', () => {
    expect(recoveryFor('Cannot read properties of undefined (reading foo)')).toBeUndefined();
    expect(recoveryFor('ECONNRESET')).toBeUndefined();
  });
});

/**
 * The whole browser-side action-validation family was classified as an unknown Reticle defect.
 *
 * Measured over real MCP against bench-app: `reticle_act { action: 'frobnicate' }` came back with
 * "unknown action 'frobnicate' — expected one of: click, dblclick, …" — a message Reticle wrote,
 * listing the valid answers — and then "This error is not one Reticle recognizes, which means it
 * may be a defect in Reticle". Same for `cannot fill a <button>`.
 *
 * These are every guard in executeAction: the wrong element for the action, a disabled or readonly
 * field, a valueless fill, an unknown action, and the destructive-action block — which is a
 * DELIBERATE refusal carrying its own retry instruction, and was still telling the agent Reticle
 * might be broken. The prior rule only caught server-authored messages that named a `reticle_*`
 * tool, so none of these matched.
 */
describe('browser-side action guards are recognized refusals, not unknown defects', () => {
  // Without this, every expectation below reads `expect(undefined).toBe(undefined)` while the
  // constant is missing — a suite that passes with the bug fully present. Assert the hints EXIST
  // before asserting anything maps to them.
  it('the hints these map to are real strings', () => {
    for (const key of [
      'WRONG_TARGET',
      'NOT_EDITABLE',
      'CONFIRM_DANGEROUS',
      'UNSUPPORTED_SURFACE',
    ] as const) {
      expect(typeof RECOVERY[key], key).toBe('string');
    }
  });

  it('an unknown action is a bad call — the message already lists the valid ones', () => {
    expect(
      recoveryFor("unknown action 'frobnicate' — expected one of: click, dblclick, hover"),
    ).toBe(RECOVERY.BAD_ARGUMENTS);
  });

  it('a missing value/text is a bad call', () => {
    expect(
      recoveryFor('fill requires a string `value` — pass it nested, as args: { value: … }'),
    ).toBe(RECOVERY.BAD_ARGUMENTS);
    expect(
      recoveryFor('type requires a string `text` — pass it nested, as args: { text: … }'),
    ).toBe(RECOVERY.BAD_ARGUMENTS);
  });

  it('the wrong element for the action points at re-querying, not at a bug report', () => {
    for (const msg of [
      'cannot fill a <button>',
      'cannot type into a <div>',
      'cannot clear a <span>',
      'cannot select on a <input>',
      'cannot (un)check a <div>',
      'no form to submit',
      'upload target must be a <input type="file">',
      "ref 'e12' is not an HTMLElement",
    ]) {
      expect(recoveryFor(msg), msg).toBe(RECOVERY.WRONG_TARGET);
    }
  });

  it('a disabled or readonly field is the app refusing, not Reticle failing', () => {
    expect(recoveryFor('cannot fill a disabled <input> — a user could not edit it')).toBe(
      RECOVERY.NOT_EDITABLE,
    );
    expect(recoveryFor('cannot type a readonly <textarea> — a user could not edit it')).toBe(
      RECOVERY.NOT_EDITABLE,
    );
  });

  it('the destructive-action block carries its own retry, and must never read as a defect', () => {
    expect(
      recoveryFor('potentially destructive action blocked; retry with args.confirmDangerous=true'),
    ).toBe(RECOVERY.CONFIRM_DANGEROUS);
  });

  it('an unsupported surface is named as unsupported, not as a possible bug', () => {
    expect(
      recoveryFor(
        'cannot fill a contenteditable element — rich-text editors keep their own document model',
      ),
    ).toBe(RECOVERY.UNSUPPORTED_SURFACE);
  });
});

/**
 * The no-session diagnosis inspects the machine and says which of three causes this actually is.
 * Pairing it with the generic hint produced a result that contradicted itself — the error saying a
 * server IS listening, the recovery saying to go start one — and suppressing only the recovery then
 * dropped it into the feedback ask, telling the agent that a condition Reticle had just diagnosed
 * might be a defect in Reticle. A message that recovers itself gets nothing appended.
 */
describe('a self-diagnosing message is left alone', () => {
  const diagnosis = diagnoseNoSession({
    everConnected: false,
    initialized: true,
    listening: [5173],
    port: 4400,
  });

  it('gets no second, generic recovery', () => {
    expect(recoveryFor(diagnosis)).toBeUndefined();
  });

  it('and is NOT reported as a possible Reticle defect', () => {
    const payload = buildErrorPayload(diagnosis);
    expect(payload.recovery).toBeUndefined();
    expect(payload.feedback).toBeUndefined();
    expect(payload.error).toBe(diagnosis);
  });

  it('while the plain static message still gets its hint', () => {
    expect(recoveryFor('no browser session connected. Two things to check')).toBe(
      RECOVERY.NO_SESSION,
    );
  });
});

/**
 * A schema rejection is the agent's argument to fix, not evidence of a Reticle defect.
 *
 * Reported from the field: a clean `unrecognized_keys: ["value"]` rejection came back wrapped in
 * "This error is not one Reticle recognizes, which means it may be a defect in Reticle". Nothing
 * misbehaved — the call named a parameter that does not exist, and the schema said so precisely.
 * Inviting a bug report there spends the agent's turn and fills the feedback channel with reports
 * about calls that were simply wrong, which is the fastest way to make real reports unfindable.
 */
describe('argument rejections are not Reticle defects', () => {
  it.each([
    ['an unknown key', 'Unrecognized key(s) in object: \'value\''],
    ['a zod code', 'invalid_type: expected string, received number at path ["by"]'],
    ['the MCP wrapper', 'Invalid arguments for tool reticle_query: Expected string, received number'],
    ['a missing required arg', 'Required at path ["action"]'],
  ])('%s gets a recovery, never the defect ask', (_label, message) => {
    const payload = buildErrorPayload(message);
    expect(payload.feedback, message).toBeUndefined();
    expect(payload.recovery, message).toBeDefined();
  });

  it('a genuinely unrecognized failure still asks for feedback', () => {
    // The ask must keep working, or this fix trades one silence for another.
    const payload = buildErrorPayload('ECONNRESET while flushing the observer queue');
    expect(payload.feedback).toBeDefined();
  });
});
