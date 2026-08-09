import { describe, expect, it } from 'vitest';
import { bugsInResult } from './bug-found.js';
import { BugAttribution, BugSource, ContradictionKind } from '@reticlehq/core';

/**
 * The outcome metric — the only number that can honestly be published or shown to an investor,
 * because it counts what Reticle did FOR users rather than what users did with it. Which makes it the
 * one number that has to be exact: an inflated "bugs found" is worse than none.
 */
describe('bugsInResult', () => {
  it('counts a contradiction as a false green when the assertion PASSED', () => {
    const bugs = bugsInResult('reticle_assert', {
      pass: true,
      verified: 'no',
      contradictions: [{ kind: 'signal-contradicted' }],
    });
    expect(bugs).toEqual([
      {
        source: 'contradiction',
        kind: 'signal-contradicted',
        falseGreen: true,
        tool: 'reticle_assert',
        attribution: BugAttribution.APP,
      },
    ]);
  });

  it('does NOT call it a false green when the assertion already failed', () => {
    const bugs = bugsInResult('reticle_assert', {
      pass: false,
      contradictions: [{ kind: 'response-ignored' }],
    });
    expect(bugs[0]?.falseGreen).toBe(false);
  });

  it('counts a plain failed assertion, named by the oracle that judged it', () => {
    const bugs = bugsInResult('reticle_assert', { pass: false, assertion: 'element.state' });
    expect(bugs).toEqual([
      { source: 'assertion', kind: 'element.state', falseGreen: false, tool: 'reticle_assert' },
    ]);
  });

  /** One defect must never be counted twice — that is exactly how a headline number stops being true. */
  it('does not double-count a failed assertion that a contradiction already explains', () => {
    const bugs = bugsInResult('reticle_assert', {
      pass: false,
      contradictions: [{ kind: 'ui-advanced-request-failed' }],
    });
    expect(bugs).toHaveLength(1);
    expect(bugs[0]?.source).toBe('contradiction');
  });

  /**
   * Crawl returns single-channel faults AND contradictions in one array. Only the second kind is a
   * false green, and collapsing them would inflate the one claim that has to be exact.
   */
  it('separates crawl contradictions from crawl single-channel faults', () => {
    const bugs = bugsInResult('reticle_crawl', {
      anomalies: [
        { kind: 'console-error' },
        { kind: 'ui-advanced-request-failed' },
        { kind: 'dead-control' },
      ],
    });
    expect(bugs).toHaveLength(3);
    expect(bugs.filter((b) => b.falseGreen).map((b) => b.kind)).toEqual([
      'ui-advanced-request-failed',
    ]);
    expect(bugs.every((b) => 'crawl' === b.source)).toBe(true);
  });

  it('counts a failed flow replay as a regression, one per failing flow', () => {
    const bugs = bugsInResult('reticle_flow_verify', {
      status: 'fail',
      failures: [{ flow: 'checkout' }, { flow: 'login' }],
    });
    expect(bugs).toHaveLength(2);
    expect(bugs[0]).toMatchObject({ source: 'replay', kind: 'flow-regression' });
  });

  it('finds nothing in a clean result — the common case must not manufacture bugs', () => {
    expect(bugsInResult('reticle_assert', { pass: true, verified: 'yes' })).toEqual([]);
    expect(bugsInResult('reticle_snapshot', { tree: 'x' })).toEqual([]);
    expect(bugsInResult('reticle_crawl', { anomalies: [] })).toEqual([]);
  });

  it('bounds a pathological result so one call cannot become a thousand events', () => {
    const anomalies = Array.from({ length: 500 }, () => ({ kind: 'console-error' }));
    expect(bugsInResult('reticle_crawl', { anomalies }).length).toBeLessThanOrEqual(25);
  });

  /** Never a selector, a URL, or anything describing the user's app — kinds only. */
  it('carries only the classified kind, never a description of the app', () => {
    const bugs = bugsInResult('reticle_crawl', {
      anomalies: [
        { kind: 'failed-request', ref: 'e7', desc: 'POST https://acme.internal/orders 500' },
      ],
    });
    expect(JSON.stringify(bugs)).not.toContain('acme.internal');
    expect(JSON.stringify(bugs)).not.toContain('e7');
  });
});

/**
 * The verdict shape the product's MAIN tool returns was invisible to the bug metric.
 *
 * `reticle_act_and_wait` does not return a top-level `pass`. Its verdict lives at `verdict.pass`
 * with the summary at `verified`. `bugsInResult` read only `result.pass`, so on the tool agents
 * actually use:
 *
 *   - a FAILED assertion produced no bug at all — `result.pass === false` was never true, so rule 3
 *     never fired;
 *   - and a contradiction found alongside a PASSING verdict was recorded with `falseGreen: false`,
 *     because `passed` was computed from the same missing field. False greens caught is the number
 *     this product exists to publish, and it was being deflated by the shape of its own envelope.
 *
 * Measured the same day: act_and_wait 14 calls, assert 0. Everything above was the common path.
 */
describe('act_and_wait verdicts count, even though the shape differs', () => {
  it('a FAILED act_and_wait verdict is a bug', () => {
    const bugs = bugsInResult('reticle_act_and_wait', {
      verified: 'no',
      verdict: { pass: false, assertion: 'element.visible' },
    });
    expect(bugs).toHaveLength(1);
    expect(bugs[0]?.source).toBe(BugSource.ASSERTION);
    expect(bugs[0]?.kind).toBe('element.visible');
    expect(bugs[0]?.falseGreen).toBe(false);
  });

  it('a contradiction on a PASSING act_and_wait is a false green', () => {
    const bugs = bugsInResult('reticle_act_and_wait', {
      verified: 'yes',
      verdict: { pass: true },
      contradictions: [{ kind: ContradictionKind.UI_ADVANCED_REQUEST_FAILED }],
    });
    expect(bugs).toHaveLength(1);
    expect(bugs[0]?.source).toBe(BugSource.CONTRADICTION);
    expect(bugs[0]?.falseGreen, 'a passing verdict with a contradiction IS the false green').toBe(
      true,
    );
  });

  it('a clean, passing act_and_wait is not a bug', () => {
    expect(
      bugsInResult('reticle_act_and_wait', { verified: 'yes', verdict: { pass: true } }),
    ).toHaveLength(0);
  });

  it('does not double-count: a contradiction explains the failure on its own', () => {
    const bugs = bugsInResult('reticle_act_and_wait', {
      verified: 'no',
      verdict: { pass: false, assertion: 'net.status' },
      contradictions: [{ kind: ContradictionKind.UI_ADVANCED_REQUEST_FAILED }],
    });
    expect(bugs).toHaveLength(1);
    expect(bugs[0]?.source).toBe(BugSource.CONTRADICTION);
  });
});

/**
 * `bug_found` counted Reticle's OWN failures as defects in the user's app.
 *
 * Measured over one sweep: all 14 events were `assertion-failed` from `reticle_verify_change` and
 * `reticle_run` — and the `reticle_run` ones were "no session connected", which is infrastructure,
 * not an app defect. The product's headline number was counting its own errors.
 *
 * A verdict earned by an assertion the app failed is a bug. A verdict that exists because Reticle
 * could not reach the app, or because the suite proved nothing, is not — and `verified: "unknown"`
 * already marks exactly that category, which the failed-assertion rule was ignoring.
 */
describe('Reticle failing is not the app failing', () => {
  it('does not count a result Reticle could not evaluate', () => {
    // `verified: unknown` is the honesty layer saying "nothing was proved either way".
    expect(
      bugsInResult('reticle_verify_change', { verified: 'unknown', pass: false }),
    ).toHaveLength(0);
  });

  it('does not count a refusal, whatever shape the tool returned it in', () => {
    expect(
      bugsInResult('reticle_run', { error: 'no browser session connected', pass: false }),
    ).toHaveLength(0);
  });

  it('still counts a genuine failed assertion', () => {
    // The fix must not silence the metric it is protecting.
    expect(
      bugsInResult('reticle_act_and_wait', { verified: 'no', verdict: { pass: false, assertion: 'route.changed' } }),
    ).toHaveLength(1);
  });
});

/**
 * The wrapper counted every defect a second time.
 *
 * `reticle_run` dispatches through `runTool` (dynamic-tools.ts), which reports the inner tool's
 * defects under the INNER tool's name — and then the outer `runTool` reports the same returned object
 * again as `reticle_run`. One sweep of 34 events was a perfect mirror image:
 *
 *   flow-regression   x8 / reticle_flow_verify   AND   x8 / reticle_run
 *   assertion-failed  x8 / reticle_verify_change AND   x8 / reticle_run
 *
 * Sixteen of the thirty-four were echoes. A headline number that doubles because of how a tool was
 * reached is not a measurement.
 */
describe('the reticle_run wrapper never reports its own bugs', () => {
  it('does not re-count a flow regression the inner tool already reported', () => {
    expect(
      bugsInResult('reticle_run', { status: 'fail', failures: [{ flow: 'checkout' }] }),
    ).toHaveLength(0);
  });

  it('does not re-count a failed assertion either', () => {
    expect(
      bugsInResult('reticle_run', { verified: 'no', verdict: { pass: false, assertion: 'route.changed' } }),
    ).toHaveLength(0);
  });

  it('the INNER tool still reports it — the defect is counted exactly once', () => {
    expect(
      bugsInResult('reticle_flow_verify', { status: 'fail', failures: [{ flow: 'checkout' }] }),
    ).toHaveLength(1);
  });
});

/**
 * A suite that failed because nothing could RUN is not a regression in the user's app.
 *
 * The replay rule looked only at `status === 'fail'`, so a project whose flow files did not resolve —
 * or whose leased context never came up — reported one "defect found" per flow. Reticle's own failure,
 * published as the customer's.
 */
describe('a flow that never ran is not a regression', () => {
  it('skips rows the replay could not start', () => {
    expect(
      bugsInResult('reticle_flow_verify', {
        status: 'fail',
        failures: [{ flow: 'checkout', couldNotRun: true }],
      }),
    ).toHaveLength(0);
  });

  it('still counts the rows that genuinely failed', () => {
    // The fix must not silence the metric it protects.
    expect(
      bugsInResult('reticle_flow_verify', {
        status: 'fail',
        failures: [{ flow: 'checkout', couldNotRun: true }, { flow: 'signup' }],
      }),
    ).toHaveLength(1);
  });
});

/**
 * WHOSE fault it was — the field that makes `bugsFound` publishable at all.
 *
 * Measured over one real session: 8 `bug_found` events, ONE of them a defect in the app. Seven were
 * the agent's own bad predicates and an empty ref, every one published as a defect in the customer's
 * product. A founder steering on that number is steering on noise, and no amount of care in the
 * pitch fixes a number computed that way.
 */
describe('a defect says whose fault it was, or says nothing', () => {
  it('blames the APP for a contradiction — two of its own channels disagreeing', () => {
    const [bug] = bugsInResult('reticle_assert', {
      pass: true,
      contradictions: [{ kind: 'signal-contradicted' }],
    });
    expect(bug?.attribution).toBe(BugAttribution.APP);
  });

  it('blames the APP for a crawl anomaly — nobody wrote a predicate to get it wrong', () => {
    const [bug] = bugsInResult('reticle_crawl', { anomalies: [{ kind: 'console-error' }] });
    expect(bug?.attribution).toBe(BugAttribution.APP);
  });

  it('blames the APP for a replay regression — it used to pass', () => {
    const [bug] = bugsInResult('reticle_flow_verify', { status: 'fail', failures: [{ f: 1 }] });
    expect(bug?.attribution).toBe(BugAttribution.APP);
  });

  /**
   * The one contradiction kind Reticle can manufacture on its own.
   *
   * `request-never-settled` is raised from the ABSENCE of a settle event, so anything the observer
   * failed to see — a Next dev-overlay poll, HMR, a request that outlived the window — produces it
   * without the app doing anything wrong. Driven for real against a Next app it fired twice, both
   * from the dev overlay, and both were published as defects in the customer's app. Every other
   * contradiction is two of the app's OWN channels disagreeing, which the app owns.
   */
  it('says nothing on request-never-settled — absence of evidence names no owner', () => {
    const [bug] = bugsInResult('reticle_act_and_wait', {
      verified: 'no',
      verdict: { pass: false },
      contradictions: [{ kind: ContradictionKind.REQUEST_NEVER_SETTLED }],
    });
    expect(bug?.source).toBe(BugSource.CONTRADICTION);
    expect(bug !== undefined && 'attribution' in bug).toBe(false);
  });

  it('says nothing on request-never-settled from a CRAWL either — same kind, same evidence', () => {
    const [bug] = bugsInResult('reticle_crawl', {
      anomalies: [{ kind: ContradictionKind.REQUEST_NEVER_SETTLED }],
    });
    expect(bug?.source).toBe(BugSource.CRAWL);
    expect(bug !== undefined && 'attribution' in bug).toBe(false);
  });

  it('still blames the APP for every other contradiction kind', () => {
    for (const kind of Object.values(ContradictionKind)) {
      if (ContradictionKind.REQUEST_NEVER_SETTLED === kind) continue;
      const [bug] = bugsInResult('reticle_assert', { pass: false, contradictions: [{ kind }] });
      expect(bug?.attribution, kind).toBe(BugAttribution.APP);
    }
  });

  it('blames the REQUEST when the agent named a store path that does not exist', () => {
    // Captured verbatim in the audit: `state.path-missing` from a store name that was never there,
    // shipped as a defect found in the customer's app.
    const [bug] = bugsInResult('reticle_assert', { pass: false, assertion: 'state.path-missing' });
    expect(bug?.attribution).toBe(BugAttribution.REQUEST);
  });

  it('blames RETICLE when there was no readable store to read', () => {
    const [bug] = bugsInResult('reticle_assert', { pass: false, assertion: 'state.unreadable' });
    expect(bug?.attribution).toBe(BugAttribution.RETICLE);
  });

  /**
   * The omission is the design. `element.present` covers "the button is missing", "the API is down"
   * and "the agent mistyped a testid" identically, and `signal.absent` covers both a signal the app
   * never fired and a ref Reticle drove into nothing. Guessing an owner would swap an inflated
   * number for a confident wrong one; absent lets a dashboard exclude it instead.
   */
  it.each(['element.present', 'signal.absent', 'net.status', 'assertion-failed'])(
    'says nothing rather than guessing on %s',
    (assertion) => {
      const [bug] = bugsInResult('reticle_assert', { pass: false, assertion });
      expect(bug).toBeDefined();
      expect(bug !== undefined && 'attribution' in bug).toBe(false);
    },
  );
});
