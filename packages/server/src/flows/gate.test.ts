import { describe, expect, it } from 'vitest';
import { gateDecision } from './gate.js';

describe('gateDecision', () => {
  it('passes when every affected flow has a passing artifact', () => {
    const result = gateDecision({ affected: ['checkout', 'login'], passing: ['checkout', 'login', 'search'] });
    expect(result.pass).toBe(true);
    expect(result.uncovered).toEqual([]);
  });

  it('blocks on an affected flow with no passing artifact', () => {
    const result = gateDecision({ affected: ['checkout', 'billing'], passing: ['checkout'] });
    expect(result.pass).toBe(false);
    expect(result.uncovered).toEqual(['billing']);
  });

  it('quarantines a flaky flow instead of blocking on it', () => {
    const result = gateDecision({ affected: ['checkout'], passing: [], flaky: ['checkout'] });
    expect(result.pass).toBe(true);
    expect(result.uncovered).toEqual([]);
    expect(result.quarantined).toEqual(['checkout']);
  });

  it('still blocks a non-flaky uncovered flow even when another is quarantined', () => {
    const result = gateDecision({ affected: ['checkout', 'billing'], passing: [], flaky: ['checkout'] });
    expect(result.pass).toBe(false);
    expect(result.uncovered).toEqual(['billing']);
    expect(result.quarantined).toEqual(['checkout']);
  });
});
