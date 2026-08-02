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
  /** What THIS session observed. Never contains seeded history — see seedAmbient. */
  readonly #ownAmbient: AmbientCounts = {};
  /** What previous sessions learned, kept separate so it is never re-persisted as if newly seen. */
  #seededAmbient: AmbientCounts = {};
  readonly #blindSpots: Record<string, number> = {};

  /** Fold one already-attributed event into the learned state. */
  observe(event: ReticleEvent): void {
    // Only UNATTRIBUTED events count as ambient: an event caused by an action is the action's work,
    // and learning it as background would teach the settle oracle to ignore real effects.
    if (event.actionId === undefined) {
      const key = ambientKeyOf(event);
      if (key !== undefined) this.#ownAmbient[key] = (this.#ownAmbient[key] ?? 0) + 1;
    }
    if (event.type === EventType.BLIND_SPOT) {
      const kind = event.data['kind'];
      const count = event.data['count'];
      if (typeof kind === 'string' && typeof count === 'number') this.#blindSpots[kind] = count;
    }
  }

  /**
   * Learned ambient-churn counts — seeded history PLUS this session — for the settle oracle, which
   * wants the sharpest available picture of what moves on its own.
   */
  ambientCounts(): AmbientCounts {
    const merged: AmbientCounts = { ...this.#seededAmbient };
    for (const [key, count] of Object.entries(this.#ownAmbient)) {
      merged[key] = (merged[key] ?? 0) + count;
    }
    return merged;
  }

  /**
   * ONLY what this session observed — the correct input to persistence.
   *
   * Teardown accumulates by adding the session's counts onto the file it loaded. When the session's
   * counts still contained the seeded ones, that addition wrote `2 x persisted + own` every run, so
   * the map doubled per session: the file committed in this repo had reached ~9.1e23 (about 2^80,
   * i.e. ~80 sessions of doubling). Keeping the seed separate makes the accumulation what it always
   * claimed to be — history plus what is new.
   */
  ownAmbientCounts(): AmbientCounts {
    return this.#ownAmbient;
  }

  /**
   * Seed from the persisted per-app map so the picture sharpens across sessions.
   * In-session counts win: they describe this page as it is now.
   */
  seedAmbient(counts: AmbientCounts): void {
    this.#seededAmbient = { ...counts };
  }

  /** Latest reported count per blind-spot kind, for the whole session. */
  /**
   * Refs the agent has driven, for the exercised/untouched split `reticle_coverage` reports.
   *
   * Kept here beside the blind-spot counts because both are per-session observed facts that must
   * SURVIVE buffer eviction. Deriving "what did I touch" from the event buffer instead would mean an
   * action fifty steps ago silently stops counting, so "untouched" would quietly come to mean
   * "recently untouched" — a number that reads as thorough while drifting toward the opposite.
   */
  readonly #actedRefs = new Set<string>();

  /** Record a driven ref. Idempotent. */
  recordActedRef(ref: string): void {
    if (ref.length > 0) this.#actedRefs.add(ref);
  }

  /** Every ref driven so far this session. */
  actedRefs(): ReadonlySet<string> {
    return this.#actedRefs;
  }

  blindSpots(): Readonly<Record<string, number>> {
    return this.#blindSpots;
  }
}
