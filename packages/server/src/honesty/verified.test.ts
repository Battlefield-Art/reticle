import { describe, expect, it } from 'vitest';
import { Verified } from '@reticlehq/core';
import { decideVerified } from './verified.js';
import { HonestyGrade, type HonestyBlock } from './honesty.js';

const clean = (grade: HonestyGrade = HonestyGrade.SIGNAL): HonestyBlock => ({
  grade,
  coverage: { partial: false },
  integrity: { clean: true, issues: [] },
});

const dirty = (...issues: string[]): HonestyBlock => ({
  grade: HonestyGrade.SIGNAL,
  coverage: { partial: false },
  integrity: { clean: false, issues },
});

describe('decideVerified — one answer from eight dimensions', () => {
  it('says YES for a graded, clean, settled, uncontradicted pass', () => {
    const v = decideVerified({ pass: true, honesty: clean(), settled: true });
    expect(v.verified).toBe(Verified.YES);
    expect(v.because).toContain('signal');
  });

  it('says NO when the declared consequence did not hold', () => {
    expect(decideVerified({ pass: false, honesty: clean(), settled: true }).verified).toBe(
      Verified.NO,
    );
  });
});

/**
 * The case the product exists for. Measured on the bench app: `ui-advanced-request-failed` arrived
 * with verdict.pass true and every other channel agreeing the action was fine. If `pass` outranked
 * the contradiction, the single field an agent reads would report the very false green being
 * detected — so this inversion is the most important assertion in the file.
 */
describe('a contradiction outranks a passing assertion', () => {
  it('says NO when channels disagree even though the assertion passed', () => {
    const v = decideVerified({
      pass: true,
      honesty: clean(),
      settled: true,
      contradictions: [{ kind: 'ui-advanced-request-failed' }],
    });
    expect(v.verified).toBe(Verified.NO);
    expect(v.because).toContain('ui-advanced-request-failed');
  });

  it('names every disagreeing channel, so the agent knows where to look', () => {
    const v = decideVerified({
      pass: true,
      honesty: clean(),
      settled: true,
      contradictions: [{ kind: 'duplicate-request' }, { kind: 'response-ignored' }],
    });
    expect(v.because).toContain('duplicate-request');
    expect(v.because).toContain('response-ignored');
  });
});

/**
 * UNKNOWN must never collapse into NO. "I could not see" and "it is broken" send an agent in
 * opposite directions — look again with better coverage, versus go change code. Merging them
 * manufactures false alarms in one direction and false confidence in the other.
 */
describe('UNKNOWN is a distinct answer, never folded into NO', () => {
  it('is UNKNOWN — not NO — when the capture was not clean', () => {
    const v = decideVerified({ pass: true, honesty: dirty('capture truncated'), settled: true });
    expect(v.verified).toBe(Verified.UNKNOWN);
    expect(v.verified).not.toBe(Verified.NO);
    expect(v.because).toContain('capture truncated');
  });

  it('is UNKNOWN when nothing was asserted at a real grade (a vacuous green)', () => {
    const v = decideVerified({
      pass: true,
      honesty: clean(HonestyGrade.NONE),
      settled: true,
    });
    expect(v.verified).toBe(Verified.UNKNOWN);
    expect(v.because).toMatch(/proves nothing/);
  });

  it('is UNKNOWN when the page never settled', () => {
    const v = decideVerified({ pass: true, honesty: clean(), settled: false });
    expect(v.verified).toBe(Verified.UNKNOWN);
    expect(v.because).toMatch(/never settled/);
  });

  /** The exact signal that stumped a real drive: settled:false with no other fault. */
  it('resolves the settle-timeout ambiguity that previously had no answer', () => {
    expect(decideVerified({ pass: true, honesty: clean(), settled: false }).verified).toBe(
      Verified.UNKNOWN,
    );
  });
});

describe('precedence between competing faults', () => {
  it('reports the failed assertion first, as the most actionable fact', () => {
    const v = decideVerified({
      pass: false,
      honesty: dirty('capture truncated'),
      contradictions: [{ kind: 'duplicate-request' }],
      settled: false,
    });
    expect(v.verified).toBe(Verified.NO);
    expect(v.because).toContain('did not hold');
  });

  it('prefers a contradiction over a dirty capture: evidence AGAINST beats absence of evidence', () => {
    const v = decideVerified({
      pass: true,
      honesty: dirty('capture truncated'),
      contradictions: [{ kind: 'signal-contradicted' }],
      settled: true,
    });
    expect(v.verified).toBe(Verified.NO);
  });

  /** Partial coverage is a caveat carried in `honesty.coverage`, not grounds to withhold a verdict. */
  it('still says YES under partial coverage when nothing else is wrong', () => {
    const v = decideVerified({
      pass: true,
      honesty: { ...clean(), coverage: { partial: true } },
      settled: true,
    });
    expect(v.verified).toBe(Verified.YES);
  });

  it('treats an action that declared no consequence as ungraded, not as a pass', () => {
    const v = decideVerified({ honesty: clean(HonestyGrade.NONE), settled: true });
    expect(v.verified).toBe(Verified.UNKNOWN);
  });
});
