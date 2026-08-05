import { describe, expect, it } from 'vitest';
import { FEEDBACK_ASK, RECOVERY, buildErrorPayload, recoveryFor } from './error-recovery.js';
import { TOOLS } from './tools.js';

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
