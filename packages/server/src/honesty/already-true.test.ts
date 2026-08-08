/**
 * `verified: "yes"` for a navigation that never happened.
 *
 * Measured in the field, on a Next app-router fixture:
 *
 *   act_and_wait { ref: <"Parallel Routes" link>, until: { kind: 'text', contains: 'Parallel Routes' } }
 *   -> verdict at 478ms, verified: "yes", routeChanges: 0
 *   observe -> the real route.change landed at t=22270, ~1.8s LATER
 *
 * The predicate matched the nav link that was already on the page before the click. It was right by
 * accident, and only `honesty.grade: "presence"` and `routeChanges: 0` hinted otherwise — neither is
 * the field an agent reads first.
 *
 * Event-based predicates (net/signal/route) are already floored at the act's cursor, so a stale event
 * cannot satisfy them. `element` and `text` read the LIVE DOM, where no floor applies: a condition
 * that held BEFORE the action holds after it, and passes instantly whatever the action did.
 *
 * So the rule: if a DOM-state predicate was already true before the act, its passing afterwards is
 * not evidence about the act. That is `unknown` — the same answer a dirty capture gets, for the same
 * reason. It is deliberately not `no`: the app may well be fine, and claiming a failure would be its
 * own false report.
 */

import { describe, expect, it } from 'vitest';
import { Verified } from '@reticlehq/core';
import { decideVerified } from './verified.js';
import { buildHonestyBlock, HonestyGrade } from './honesty.js';
import { readsDomState } from './already-true.js';

const clean = buildHonestyBlock({ grade: HonestyGrade.PRESENCE, attribution: 'window' });

describe('a condition that already held proves nothing about the action', () => {
  it('is UNKNOWN, not a pass', () => {
    const d = decideVerified({ pass: true, alreadyTrue: true, honesty: clean });
    expect(d.verified).toBe(Verified.UNKNOWN);
    expect(d.because).toContain('before');
  });

  it('a genuine pass is untouched', () => {
    expect(decideVerified({ pass: true, honesty: clean }).verified).toBe(Verified.YES);
  });

  it('a FAILURE still leads — the assertion not holding is the more actionable fact', () => {
    const d = decideVerified({ pass: false, alreadyTrue: true, honesty: clean });
    expect(d.verified).toBe(Verified.NO);
  });
});

describe('which predicates need the before-check at all', () => {
  it('element and text read the live DOM, so they do', () => {
    expect(readsDomState({ kind: 'element', query: { testid: 'x' } })).toBe(true);
    expect(readsDomState({ kind: 'text', contains: 'Parallel Routes' })).toBe(true);
  });

  it('event-based kinds do not — they are already floored at the act cursor', () => {
    expect(readsDomState({ kind: 'route', pathname: '/a' })).toBe(false);
    expect(readsDomState({ kind: 'signal', name: 's' })).toBe(false);
    expect(readsDomState({ kind: 'net', urlContains: '/api' })).toBe(false);
    expect(readsDomState({ kind: 'settled' })).toBe(false);
  });

  it('state reads a store, which the action is supposed to change — and it IS floored', () => {
    expect(readsDomState({ kind: 'state', path: 'cart.total' })).toBe(false);
  });

  it('a combinator inherits it from any branch that reads the DOM', () => {
    expect(
      readsDomState({
        kind: 'allOf',
        predicates: [{ kind: 'settled' }, { kind: 'text', contains: 'Done' }],
      }),
    ).toBe(true);
    expect(readsDomState({ kind: 'not', predicate: { kind: 'text', contains: 'Error' } })).toBe(true);
    expect(
      readsDomState({ kind: 'anyOf', predicates: [{ kind: 'signal', name: 'a' }] }),
    ).toBe(false);
  });
});
