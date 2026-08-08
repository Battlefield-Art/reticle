/**
 * A replayed step waits for its anchor on a fixed 150ms grid, eight times over.
 *
 * Measured on next-app-router with RETICLE_TRACE: one `flow.step` span was 1079ms containing nine
 * QUERY round-trips of 1–2ms each — the whole cost is the sleeping between them, and four such steps
 * were 4.3s of that app's 7.6s. A mounting element IS a DOM mutation, and the session already
 * streams those, so waiting out a fixed tick after the thing has happened is pure latency.
 *
 * The change can only make the loop find an anchor SOONER. It never concludes absence earlier: the
 * attempt budget is untouched, so a genuinely missing anchor still costs the full settle before it
 * drifts. That asymmetry is the whole safety argument — an early "not found" would be a false drift,
 * which is the one thing this loop exists to prevent.
 */

import { describe, expect, it } from 'vitest';
import { resolveQuery } from './flow-replay.js';
import type { FlowReplaySession } from './flow-replay.js';
import type { ReticleEvent, CommandResult } from '@reticlehq/core';

/** A session whose QUERY starts empty and starts matching only after `appearAfter` calls. */
function sessionThatMountsAfter(appearAfter: number): {
  session: FlowReplaySession;
  fire: () => void;
  queries: () => number;
} {
  let queries = 0;
  const listeners = new Set<(e: ReticleEvent) => void>();
  const session: FlowReplaySession = {
    command: (): Promise<CommandResult> => {
      queries += 1;
      const refs = queries > appearAfter ? [{ ref: 'e1' }] : [];
      return Promise.resolve({
        kind: 'command_result',
        id: 'x',
        ok: true,
        result: { elements: refs },
      } as unknown as CommandResult);
    },
    eventsSince: () => [],
    onEvent: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    elapsed: () => 0,
  };
  return {
    session,
    fire: () => {
      for (const l of listeners) l({} as ReticleEvent);
    },
    queries: () => queries,
  };
}

describe('resolveQuery — a DOM event ends the wait early', () => {
  it('re-queries as soon as the page mutates, instead of finishing the tick', async () => {
    const { session, fire, queries } = sessionThatMountsAfter(1);
    let slept = 0;
    // A sleep that never resolves on its own: if the event path did not work, this test would hang
    // rather than quietly pass on the timer. The wait must be ended by the event or not at all.
    const sleep = (): Promise<void> =>
      new Promise(() => {
        slept += 1;
      });
    const pending = resolveQuery(session, { by: 'testid', value: 'x' }, sleep);
    // Let the first query settle, then mutate the page.
    await Promise.resolve();
    await Promise.resolve();
    fire();
    const result = await pending;
    expect(result.refs).toEqual(['e1']);
    expect(queries()).toBe(2);
    expect(slept, 'it did wait — it just did not wait it out').toBeGreaterThan(0);
  });

  /**
   * The safety half. With no events at all the loop must still spend its whole budget before
   * reporting an empty result, because "absent" is a verdict a flow drifts on.
   */
  it('still spends the full budget when nothing ever happens', async () => {
    const { session, queries } = sessionThatMountsAfter(Number.MAX_SAFE_INTEGER);
    const result = await resolveQuery(session, { by: 'testid', value: 'x' }, () =>
      Promise.resolve(),
    );
    expect(result.refs).toEqual([]);
    expect(queries(), 'one initial query plus the full retry budget').toBe(8);
  });
});
