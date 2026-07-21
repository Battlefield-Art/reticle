import { AmbientStore } from './ambient-store.js';
import type { AmbientCounts } from './ambient.js';
import type { FileSystemPort } from '../project/fs-port.js';

/**
 * Session teardown: the durable half of ending a session. Two things must happen when a tab disconnects,
 * and neither did before — the journal batches events and only writes at its flush threshold, so the tail
 * of every session (< one batch) was silently lost from disk, and the learned ambient map was never
 * persisted at all, so every session re-learned the page's churn from zero.
 *
 * Both are best-effort: a teardown failure must never surface as a session error (the tab is already gone).
 */

/** The minimal Session surface teardown needs (Session satisfies it structurally). */
export interface SessionEndTarget {
  readonly id: string;
  /** Write any batched journal events to disk. */
  flushJournal(): Promise<void>;
  /** The ambient-churn counts learned during this session. */
  ambientCounts(): AmbientCounts;
}

export interface SessionEndDeps {
  fs: FileSystemPort;
  reticleRoot: string;
  /** Journaling/persistence off (opt-out) → teardown is a no-op. */
  enabled: boolean;
}

/**
 * Build the teardown handler the bridge fires when a session is removed. Flushes the journal first (so no
 * evidence is lost), then folds this session's ambient counts into the persisted map so the NEXT session
 * starts already knowing which regions churn.
 */
export function makeSessionEnd(deps: SessionEndDeps): (session: SessionEndTarget) => Promise<void> {
  return async (session) => {
    if (!deps.enabled) return;
    try {
      await session.flushJournal();
    } catch {
      // a failed flush must not block ambient persistence, and must never throw at teardown
    }
    try {
      const store = new AmbientStore(deps.fs, deps.reticleRoot);
      const persisted = await store.load();
      // Merge by re-accumulating: the session's counts are added on top of what previous runs learned.
      const merged: AmbientCounts = { ...persisted };
      for (const [ref, count] of Object.entries(session.ambientCounts())) {
        merged[ref] = (merged[ref] ?? 0) + count;
      }
      await store.save(merged);
    } catch {
      // ambient learning is an optimization; a disk failure never breaks teardown
    }
  };
}
