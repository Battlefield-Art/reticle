import { EventType, type ReticleEvent } from '@reticlehq/core';
import { ambientKeyOf, type AmbientCounts } from '../journal/ambient.js';

/**
 * The two things a session learns by watching its own event stream, as opposed to storing.
 *
 * Both are LEVELS derived from a stream, and both have to outlive the ring buffer — which is what
 * separates them from the buffer's job and earns them their own unit:
 *
 *   ambient    — which regions of the page move on their own (chat, tickers, live counters). Used by
 *                the settle oracle to ignore background motion, so an action isn't held open forever
 *                by churn it did not cause.
 *   blindSpots — how much of the page the SDK cannot observe (cross-origin frames, closed shadow
 *                roots). The SDK reports these only when the count CHANGES, so a page that mounts
 *                two frames at load announces them once and is silent forever after. Anything that
 *                infers coverage from a window of events therefore sees nothing and concludes the
 *                page was fully observed — a positive claim to have seen what we cannot see. Holding
 *                the level here makes coverage something to ask rather than infer.
 */
export class ObservedState {
  #ambient: AmbientCounts = {};
  readonly #blindSpots: Record<string, number> = {};

  /** Fold one already-attributed event into the learned state. */
  observe(event: ReticleEvent): void {
    // Only UNATTRIBUTED events count as ambient: an event caused by an action is the action's work,
    // and learning it as background would teach the settle oracle to ignore real effects.
    if (event.actionId === undefined) {
      const key = ambientKeyOf(event);
      if (key !== undefined) this.#ambient[key] = (this.#ambient[key] ?? 0) + 1;
    }
    if (event.type === EventType.BLIND_SPOT) {
      const kind = event.data['kind'];
      const count = event.data['count'];
      if (typeof kind === 'string' && typeof count === 'number') this.#blindSpots[kind] = count;
    }
  }

  /** Learned ambient-churn counts (the settle oracle's hook). */
  ambientCounts(): AmbientCounts {
    return this.#ambient;
  }

  /**
   * Seed from the persisted per-app map so the picture sharpens across sessions.
   * In-session counts win: they describe this page as it is now.
   */
  seedAmbient(counts: AmbientCounts): void {
    this.#ambient = { ...counts, ...this.#ambient };
  }

  /** Latest reported count per blind-spot kind, for the whole session. */
  blindSpots(): Readonly<Record<string, number>> {
    return this.#blindSpots;
  }
}
