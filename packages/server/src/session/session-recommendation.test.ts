import { describe, expect, it } from 'vitest';
import { UNSCRIPTABLE_TAB_RECOMMENDATION } from '@reticlehq/core';
import { buildSessionRecommendation } from './session-recommendation.js';

describe('buildSessionRecommendation', () => {
  it('recommends reticle drive when hidden and throttled', () => {
    const rec = buildSessionRecommendation({ hidden: true, throttled: true, focused: false });
    expect(rec).toBe(UNSCRIPTABLE_TAB_RECOMMENDATION);
    expect(rec).toContain('reticle drive');
  });

  it('names the in-protocol escape hatch before the CLI one (#521)', () => {
    // An MCP-only agent has no shell: `reticle drive` is a sentence for the human, while
    // `reticle_run { tool: "reticle_lease" }` is the route the agent itself can take. The agent's
    // option leads; the CLI follows as the human's equivalent.
    const rec = UNSCRIPTABLE_TAB_RECOMMENDATION;
    expect(rec).toContain('reticle_run { tool: "reticle_lease"');
    expect(rec.indexOf('reticle_run')).toBeLessThan(rec.indexOf('reticle drive'));
  });

  it('recommends when throttled even if not hidden', () => {
    expect(buildSessionRecommendation({ hidden: false, throttled: true, focused: true })).toBe(
      UNSCRIPTABLE_TAB_RECOMMENDATION,
    );
  });

  it('recommends when hidden regardless of throttled flag', () => {
    expect(buildSessionRecommendation({ hidden: true, throttled: false, focused: false })).toBe(
      UNSCRIPTABLE_TAB_RECOMMENDATION,
    );
  });

  it('returns undefined for a healthy focused tab', () => {
    expect(
      buildSessionRecommendation({ hidden: false, throttled: false, focused: true }),
    ).toBeUndefined();
  });

  it('does not recommend for a merely-unfocused but live tab', () => {
    expect(
      buildSessionRecommendation({ hidden: false, throttled: false, focused: false }),
    ).toBeUndefined();
  });

  it('the recommendation is the named UNSCRIPTABLE_TAB_RECOMMENDATION constant', () => {
    expect(UNSCRIPTABLE_TAB_RECOMMENDATION).toContain('reticle_run { tool: "reticle_lease"');
    expect(UNSCRIPTABLE_TAB_RECOMMENDATION).toContain('reticle drive');
    expect(UNSCRIPTABLE_TAB_RECOMMENDATION).toContain('refocus');
  });
});
