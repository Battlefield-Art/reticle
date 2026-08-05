import { describe, expect, it } from 'vitest';
import { bugsInResult } from './bug-found.js';

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
    expect(bugs.every((b) => b.source === 'crawl')).toBe(true);
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
