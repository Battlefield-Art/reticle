import { describe, expect, it } from 'vitest';
import { RECOVERY, buildErrorPayload, recoveryFor } from './error-recovery.js';
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
    const unknown = buildErrorPayload('save failed: disk_full');
    expect(unknown).toEqual({ error: 'save failed: disk_full' });
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
