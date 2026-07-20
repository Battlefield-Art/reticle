import type { ReticleEvent } from '@reticlehq/core';

/** Filter bounds for a journal-backed event query. All optional; omitted = unbounded on that axis. */
export interface EventQueryOptions {
  /** Lower time bound (inclusive), elapsed ms — the act cursor semantics of `eventsSince`. */
  since?: number;
  /** Upper time bound (inclusive), elapsed ms — the new `until` param. */
  until?: number;
  /** Keep only events attributed to this action id — answers "what did action N cause". */
  actionId?: string;
}

/**
 * Merge the durable journal's events with the ring buffer's, de-duplicated by `seq` (unique per
 * session), ordered by `seq` (falling back to `t` for any pre-2.2 event without one). Neither source is
 * a strict superset — the journal holds everything already flushed (incl. evicted), the buffer holds the
 * most-recent tail that may not be flushed yet — so the union is the complete picture.
 */
export function mergeEventsBySeq(
  journal: readonly ReticleEvent[],
  buffer: readonly ReticleEvent[],
): ReticleEvent[] {
  const bySeq = new Map<number, ReticleEvent>();
  const noSeq: ReticleEvent[] = [];
  for (const event of [...journal, ...buffer]) {
    if (typeof event.seq === 'number') bySeq.set(event.seq, event);
    else noSeq.push(event);
  }
  return [...bySeq.values(), ...noSeq].sort((a, b) => {
    if (a.seq !== undefined && b.seq !== undefined) return a.seq - b.seq;
    return a.t - b.t;
  });
}

/** Apply since/until/actionId bounds to an event list. */
export function filterEvents(
  events: readonly ReticleEvent[],
  options: EventQueryOptions,
): ReticleEvent[] {
  return events.filter(
    (event) =>
      (options.since === undefined || event.t >= options.since) &&
      (options.until === undefined || event.t <= options.until) &&
      (options.actionId === undefined || event.actionId === options.actionId),
  );
}
