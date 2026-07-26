import { describe, it, expect } from 'vitest';
import { isSensitiveKey, scrubKnownSecrets } from './redaction.js';
import { REDACTED_VALUE } from './constants.js';

/**
 * Property / fuzz coverage for the redaction primitives — the highest-risk parse surface in the wire
 * path, because a miss leaks a credential into the journal + the agent's context, and a
 * catastrophically-backtracking regex on adversarial input hangs the bridge. These run thousands of
 * generated inputs against invariants rather than fixed examples. Deterministic: a seeded xorshift PRNG,
 * NOT Math.random (which would break reproducibility and violate the injected-clock rule) — a failure
 * always reproduces from the printed seed.
 */

/** Tiny seeded PRNG (xorshift32) — pure, reproducible; the seed is the only entropy. */
function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

const ALPHABET = 'abcABC012 ._-@=:/{}"\'\\\n\t&?#eyJ.';
function randomString(rand: () => number, maxLen: number): string {
  const len = Math.floor(rand() * maxLen);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}

describe('redaction fuzz — no crash, no hang, no leak of a known secret shape', () => {
  it('scrubKnownSecrets never throws and terminates promptly on 5,000 adversarial inputs', () => {
    const rand = prng(0x9e3779b1);
    const start = Date.now();
    for (let i = 0; i < 5000; i++) {
      const s = randomString(rand, 400);
      // Invariant 1: never throws (a regex error / infinite loop would surface here).
      expect(() => scrubKnownSecrets(s)).not.toThrow();
      expect(() => isSensitiveKey(s)).not.toThrow();
    }
    // Backstop against catastrophic backtracking. This is a BOUND on a fixed workload, not a machine
    // timing assertion — 5,000 linear scans of ≤400 chars is milliseconds; seconds means backtracking.
    expect(Date.now() - start).toBeLessThan(4000);
  });

  it('a JWT is redacted no matter what benign text surrounds it', () => {
    const rand = prng(0x1234abcd);
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQabcdefgh';
    for (let i = 0; i < 500; i++) {
      const pre = randomString(rand, 60).replace(/eyJ/g, 'x'); // avoid injecting a second token
      const post = randomString(rand, 60).replace(/eyJ/g, 'x');
      const out = scrubKnownSecrets(`${pre}${jwt}${post}`);
      expect(out).not.toContain(jwt); // the secret itself must be gone
      expect(out).toContain(REDACTED_VALUE);
    }
  });

  it('an adversarial run of the redaction alphabet cannot make the regex quadratic', () => {
    // The class the input-scan cap in network-body guards against: a long run of `[A-Za-z0-9_.-]`
    // followed by no delimiter. Here we prove the core scrub itself stays linear.
    for (const n of [1000, 4000, 8000]) {
      const s = 'a'.repeat(n);
      const t0 = Date.now();
      scrubKnownSecrets(s);
      // Each size should complete in well under the previous-size ceiling scaled linearly; a generous
      // absolute cap catches an exponential blowup without asserting a specific duration.
      expect(Date.now() - t0).toBeLessThan(200);
    }
  });
});
