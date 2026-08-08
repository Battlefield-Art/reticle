/**
 * Which results count as a completed verification — and the two ways this was wrong.
 *
 * `flow_verify` reports `status: pass | fail | unverifiable`; `assert` reports a boolean `pass`. The
 * reader accepted `status === 'pass'` and mapped everything else to `undefined`, which produced two
 * opposite errors at once:
 *
 *   1. A FAILING suite emitted NOTHING. `verification_completed` only ever fired on a green, so the
 *      denominator was systematically biased — and a CI `verify` that went red, the single most
 *      valuable event the product can produce, was invisible. Meanwhile `bugsInResult` DID fire on
 *      `status: 'fail'`, so the data shows bugs with no verification to divide them by. That is
 *      precisely the shape of "80 daily actives and almost no verifications".
 *
 *   2. An EMPTY suite emitted `verified: "yes", passed: true`. Found by the adversarial MCP sweep:
 *      `reticle_flow_verify {}` on a project with no flows returned "all 0 flows pass" and counted
 *      itself as a passing verification. Nothing was verified.
 */

import { describe, expect, it } from 'vitest';
import { verificationOf } from './verification-of.js';
import { ReticleTool } from '../tools/tool-names.js';
import { BrowserMode, setBrowserMode, resetBrowserMode } from './browser-mode.js';

const VERIFY = ReticleTool.FLOW_VERIFY;

describe('verificationOf', () => {
  it('a PASSING suite is a verification', () => {
    expect(verificationOf(VERIFY, { status: 'pass', total: 3 }, 10)).toMatchObject({
      verified: 'yes',
      passed: true,
    });
  });

  it('a FAILING suite is a verification too — it is the most valuable one', () => {
    expect(verificationOf(VERIFY, { status: 'fail', total: 3, failed: 1 }, 10)).toMatchObject({
      verified: 'no',
      passed: false,
    });
  });

  it('an EMPTY or unverifiable suite is NOT a verification — nothing was checked', () => {
    expect(verificationOf(VERIFY, { status: 'unverifiable', total: 0 }, 0)).toBeUndefined();
  });

  it('the honesty block still leads when a tool carries one', () => {
    // act_and_wait: a green assertion that Reticle refused to call verified IS the thesis.
    expect(
      verificationOf(ReticleTool.ACT_AND_WAIT, { verified: 'no', verdict: { pass: true } }, 5),
    ).toMatchObject({ verified: 'no', falseGreenCaught: false });
    expect(verificationOf(ReticleTool.ACT_AND_WAIT, { verified: 'no', pass: true }, 5)).toMatchObject(
      { falseGreenCaught: true },
    );
  });

  it('a tool that is not a verification tool never counts', () => {
    expect(verificationOf(ReticleTool.SNAPSHOT, { status: 'pass' }, 1)).toBeUndefined();
  });

  it('a verification tool that returned no verdict never counts', () => {
    expect(verificationOf(VERIFY, { error: 'no session' }, 1)).toBeUndefined();
  });

  /**
   * A pause REFUSES the call: nothing is driven and nothing is asserted. The refusal now carries
   * `verified: 'unknown'` so the agent's read of that field is never undefined — which must not turn
   * a refusal into a row in the metric investors are shown.
   */
  it('a paused refusal is not a verification, verdict field or no', () => {
    expect(
      verificationOf(ReticleTool.ACT_AND_WAIT, { paused: true, verified: 'unknown' }, 1),
    ).toBeUndefined();
  });
});

describe('how the browser got there rides on the event', () => {
  it('defaults to attached — Reticle launched nothing, so it must not claim headless', () => {
    resetBrowserMode();
    expect(verificationOf(VERIFY, { status: 'pass' }, 1)?.browser).toBe(BrowserMode.ATTACHED);
  });

  it('reports headless and headed when Reticle DID launch the browser', () => {
    // "verifications run" was one number covering unattended CI, a human watching an agent, and the
    // SDK in somebody's own dev server. Three products, three costs, three failure modes.
    setBrowserMode(BrowserMode.HEADLESS);
    expect(verificationOf(VERIFY, { status: 'pass' }, 1)?.browser).toBe(BrowserMode.HEADLESS);
    setBrowserMode(BrowserMode.HEADED);
    expect(verificationOf(VERIFY, { status: 'fail' }, 1)?.browser).toBe(BrowserMode.HEADED);
    resetBrowserMode();
  });
});
