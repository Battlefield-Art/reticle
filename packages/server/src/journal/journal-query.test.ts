import { describe, expect, it } from 'vitest';
import { EventType, type ReticleEvent } from '@reticlehq/core';
import { filterEvents, mergeEventsBySeq } from './journal-query.js';

function evt(seq: number, over: Partial<ReticleEvent> = {}): ReticleEvent {
  return { t: seq * 10, seq, type: EventType.DOM_ADDED, sessionId: 'demo', data: {}, ...over };
}

describe('mergeEventsBySeq', () => {
  it('unions journal + buffer, dedups by seq, orders by seq', () => {
    const journal = [evt(0), evt(1), evt(2)]; // includes evicted early events
    const buffer = [evt(2), evt(3)]; // overlaps at seq 2, adds the recent tail
    const merged = mergeEventsBySeq(journal, buffer);
    expect(merged.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
  });

  it('does not lose an evicted event the buffer no longer holds', () => {
    const journal = [evt(0), evt(1)];
    const buffer = [evt(1)]; // seq 0 was evicted from memory
    expect(mergeEventsBySeq(journal, buffer).map((e) => e.seq)).toEqual([0, 1]);
  });
});

describe('filterEvents', () => {
  const events = [
    evt(0, { t: 5 }),
    evt(1, { t: 20, actionId: 'a1' }),
    evt(2, { t: 40, actionId: 'a1' }),
    evt(3, { t: 60, actionId: 'a2' }),
  ];

  it('bounds by since/until inclusive on t', () => {
    expect(filterEvents(events, { since: 20, until: 40 }).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('keeps only events attributed to a given action', () => {
    expect(filterEvents(events, { actionId: 'a1' }).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('returns everything when unbounded', () => {
    expect(filterEvents(events, {})).toHaveLength(4);
  });
});
