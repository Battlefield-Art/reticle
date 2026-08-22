import { describe, expect, it } from 'vitest';
import { IntentState, NO_EDITS_OBSERVED, type Intent } from '@reticlehq/core';
import { isChangeUndeclared } from './undeclared-change.js';

const anIntent = (id: string): Intent => ({
  id,
  statement: 'clicking Send check-in makes the badge read "checked in"',
  state: IntentState.DECLARED,
  declaredAt: 1,
});

const none = (): Promise<readonly Intent[]> => Promise.resolve([]);
const one = (): Promise<readonly Intent[]> => Promise.resolve([anIntent('checkin')]);

describe('isChangeUndeclared', () => {
  it('fires when a code change landed since the last verdict and nothing is open in the ledger', async () => {
    expect(await isChangeUndeclared({ current: 3, atLastVerdict: 2 }, none)).toBe(true);
  });

  it('fires on the first verdict of a session that has seen an edit', async () => {
    expect(await isChangeUndeclared({ current: 1, atLastVerdict: undefined }, none)).toBe(true);
  });

  /**
   * The agent has said what the change was for. Silence is the correct response to a declaration —
   * anything else is a nag, and a nag is how an agent learns to stop reading findings.
   */
  it('is silent when the ledger holds an undischarged intent', async () => {
    expect(await isChangeUndeclared({ current: 3, atLastVerdict: 2 }, one)).toBe(false);
  });

  /**
   * ABSENCE OF EVIDENCE, NOT EVIDENCE OF ABSENCE. Outside Vite there is no channel that could report
   * an edit at all, so the epoch means "no edits OBSERVED" — never "no edits happened". A finding
   * built on an absence Reticle cannot see is a fabrication.
   */
  it('is silent when no edit epoch was ever observed', async () => {
    expect(await isChangeUndeclared({ current: undefined, atLastVerdict: undefined }, none)).toBe(
      false,
    );
    expect(
      await isChangeUndeclared({ current: NO_EDITS_OBSERVED, atLastVerdict: undefined }, none),
    ).toBe(false);
  });

  /**
   * One nudge per change, not per verdict. The agent that re-verifies five times after one edit has
   * been told once; telling it five times is the surface degrading into a linter.
   */
  it('is silent when the epoch has not moved since the last verdict', async () => {
    expect(await isChangeUndeclared({ current: 3, atLastVerdict: 3 }, none)).toBe(false);
  });

  it('does not read the ledger at all when no change landed', async () => {
    let reads = 0;
    const counted = (): Promise<readonly Intent[]> => {
      reads += 1;
      return Promise.resolve([]);
    };
    await isChangeUndeclared({ current: 3, atLastVerdict: 3 }, counted);
    expect(reads).toBe(0);
  });
});
