/**
 * The invitation must be about what just happened, or it is wallpaper.
 *
 * Feedback produced ~11 of 2.6.0's fixes from 14 reports. The standing handshake instruction is
 * what got those 14; this closes the gap it leaves — the agent mid-problem who is not thinking
 * about feedback tooling. A fixed string repeated forty times is invisible by call five.
 */
import { describe, expect, it } from 'vitest';
import { FrictionKind, frictionOf, inviteFor } from './feedback-invite.js';

const NONE = { unknownTool: false, verifiedUnknown: false, repeatRun: 0, errored: false };

describe('frictionOf', () => {
  it('says nothing when nothing went wrong — the common case must stay silent', () => {
    expect(frictionOf(NONE)).toBeUndefined();
  });

  it('an unknown tool outranks everything — it names a capability we do not have', () => {
    expect(frictionOf({ ...NONE, unknownTool: true, errored: true, repeatRun: 9 })).toBe(
      FrictionKind.UNKNOWN_TOOL,
    );
  });

  it('an unknown verdict outranks a plain error — it is our defect, not the app being broken', () => {
    expect(frictionOf({ ...NONE, verifiedUnknown: true, errored: true })).toBe(
      FrictionKind.UNKNOWN_VERDICT,
    );
  });

  it('does not call two repeats a loop — a deliberate retry is not being stuck', () => {
    expect(frictionOf({ ...NONE, repeatRun: 2 })).toBeUndefined();
  });

  it('calls three in a row a loop, matching the verdict nudge threshold', () => {
    expect(frictionOf({ ...NONE, repeatRun: 3 })).toBe(FrictionKind.REPEATING);
  });

  it('falls back to the refusal line for an ordinary error', () => {
    expect(frictionOf({ ...NONE, errored: true })).toBe(FrictionKind.REFUSED);
  });
});

describe('the lines themselves', () => {
  it.each(Object.values(FrictionKind))('%s names the tool an agent must call', (kind) => {
    expect(inviteFor(kind)).toContain('reticle_feedback');
  });

  it.each(Object.values(FrictionKind))('%s stays short — this is paid per result', (kind) => {
    // ~12 tokens. The surface is ~4,546 tok/turn; an invitation that grows into a paragraph is a
    // tax on every call for a message read once.
    expect(inviteFor(kind).length).toBeLessThanOrEqual(200);
  });

  it('gives every kind a DIFFERENT line — sameness is what gets tuned out', () => {
    const lines = Object.values(FrictionKind).map(inviteFor);
    expect(new Set(lines).size).toBe(lines.length);
  });
});
