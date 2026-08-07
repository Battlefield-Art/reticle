import { describe, expect, it } from 'vitest';
import { describeVersionSkew } from './version-skew.js';

/**
 * A 2.2.1 SDK against a 2.4.0 daemon agrees on `protocolVersion`, connects fine, and then disagrees
 * about tool behaviour — which surfaced to a user as a bare `-32000` with nothing on either side
 * naming a version. It took a stale pnpm metadata cache to produce, was invisible to everyone, and
 * the only reason we know the shape of it is that someone hit it and reported the symptom.
 *
 * The point of this is that skew SAYS SO. Silence is the failure mode being fixed.
 */
describe('describeVersionSkew', () => {
  it('says nothing when the versions match — no noise on the happy path', () => {
    expect(describeVersionSkew('2.4.1', '2.4.1')).toBeUndefined();
  });

  it('says nothing when the SDK version is unknown, rather than claiming a match', () => {
    // A hand-wired connect (Astro, a manual entry) has no build plugin to supply it. "Unknown" must
    // never be reported as "in sync" — that is the same silence, wearing a green hat.
    expect(describeVersionSkew(undefined, '2.4.1')).toBeUndefined();
    expect(describeVersionSkew('', '2.4.1')).toBeUndefined();
  });

  it('names BOTH versions and the fix when they differ', () => {
    const msg = describeVersionSkew('2.2.1', '2.4.0') ?? '';
    expect(msg).toContain('2.2.1');
    expect(msg).toContain('2.4.0');
    expect(msg.toLowerCase()).toMatch(/install|upgrade|update/);
  });

  it('flags a patch-level difference too — skew is skew', () => {
    expect(describeVersionSkew('2.4.0', '2.4.1')).toBeDefined();
  });
});
