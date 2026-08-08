/**
 * Server-side snapshot delta — return only what CHANGED since the agent's last look.
 *
 * Why (grounded): screenshot/Playwright-MCP agents accrue 60–80K tokens of stale accessibility-tree
 * data over a session and start hallucinating selectors that no longer exist. The agent-facing cost
 * is the MCP result it reads (not the internal WS payload), so computing the delta here — and
 * returning only added/removed lines — directly cuts the tokens the model spends AND removes the
 * stale full-tree that drives hallucination. Reuses the same normalize+diff the baseline layer uses,
 * so "what changed" means the same thing everywhere.
 *
 * Pure decision (`snapshotDelta`) + a small route-invalidated cache (`SnapshotCache`). A route change
 * invalidates the prior snapshot (a diff across pages would be meaningless), so the next snapshot
 * returns full — never a misleading cross-page delta.
 */

import { normalizeLines, diffLines } from '../project/baselines.js';

export const SnapshotDeltaMode = {
  FULL: 'full',
  DELTA: 'delta',
  UNCHANGED: 'unchanged',
} as const;
export type SnapshotDeltaMode = (typeof SnapshotDeltaMode)[keyof typeof SnapshotDeltaMode];

export interface SnapshotDelta {
  added: string[];
  removed: string[];
  addedCount: number;
  removedCount: number;
}

export type DeltaDecision =
  | { mode: typeof SnapshotDeltaMode.FULL }
  | { mode: typeof SnapshotDeltaMode.UNCHANGED }
  | { mode: typeof SnapshotDeltaMode.DELTA; delta: SnapshotDelta };

/** Pure: decide full vs delta vs unchanged given the previous tree (same route) and the next tree. */
export function snapshotDelta(prevTree: string | undefined, nextTree: string): DeltaDecision {
  if (prevTree === undefined) return { mode: SnapshotDeltaMode.FULL };
  const { added, removed } = diffLines(normalizeLines(prevTree), normalizeLines(nextTree));
  if (0 === added.length && 0 === removed.length) return { mode: SnapshotDeltaMode.UNCHANGED };
  return {
    mode: SnapshotDeltaMode.DELTA,
    delta: { added, removed, addedCount: added.length, removedCount: removed.length },
  };
}

const DEFAULT_MAX_ENTRIES = 50;

/** Per-(session,scope,mode) last-snapshot cache. Route-aware: a route change invalidates the entry. */
export class SnapshotCache {
  readonly #map = new Map<string, { route: string; tree: string }>();
  readonly #max: number;

  constructor(max: number = DEFAULT_MAX_ENTRIES) {
    this.#max = max;
  }

  /** Last tree for this key IF the route still matches; undefined when absent or route changed. */
  recall(key: string, route: string): string | undefined {
    const entry = this.#map.get(key);
    if (entry === undefined || entry.route !== route) return undefined;
    // LRU touch: re-insert so a HOT key isn't evicted while colder, more-recently-added keys survive
    // (Map preserves insertion order; delete+set moves it to the most-recently-used end).
    this.#map.delete(key);
    this.#map.set(key, entry);
    return entry.tree;
  }

  remember(key: string, route: string, tree: string): void {
    // Re-insert to move the key to the most-recently-used end (a plain set keeps its old position).
    this.#map.delete(key);
    if (this.#map.size >= this.#max) {
      const oldest = this.#map.keys().next().value;
      if (oldest !== undefined) this.#map.delete(oldest);
    }
    this.#map.set(key, { route, tree });
  }
}

/**
 * Joins the cache-key parts. NUL because `scope` is a caller-supplied selector that may contain any
 * printable character — a printable separator could be forged into a colliding key. Written as an
 * ESCAPE, never as a literal NUL byte: a raw one makes this file read as binary to grep/diff tooling,
 * which silently hid every symbol in it from repo-wide searches.
 */
const CACHE_KEY_SEPARATOR = '\u0000';

export function snapshotCacheKey(sessionId: string, scope: string, mode: string): string {
  return `${sessionId}${CACHE_KEY_SEPARATOR}${scope}${CACHE_KEY_SEPARATOR}${mode}`;
}

/** Said out loud when a diff was computed over a capped tree, so "unchanged" cannot mean "nothing happened". */
export const CAPPED_DIFF_NOTE =
  'this diff covers only the first N nodes of the page (the snapshot hit its cap), so "unchanged" means "unchanged in the part that was captured" — narrow with `scope` to see the rest';

export interface SnapshotDeltaOpts {
  sessionId: string;
  scope: string;
  mode: string;
  diff: boolean;
}

/**
 * Shape a raw snapshot result for the agent: when `diff` is requested and a same-route prior
 * snapshot exists, return only the delta (or `unchanged`) instead of the full tree. Always updates
 * the cache. Non-object/errorless results pass through. The cache is the only state; the decision is
 * the pure `snapshotDelta`.
 */
export function applySnapshotDelta(
  raw: unknown,
  opts: SnapshotDeltaOpts,
  cache: SnapshotCache,
): unknown {
  if (typeof raw !== 'object' || null === raw) return raw;
  const r = raw as Record<string, unknown>;
  // Only shape genuine snapshots (have a string tree). An error envelope passes through untouched.
  if (typeof r['tree'] !== 'string') return raw;
  const tree = r['tree'];
  const status =
    'object' === typeof r['status'] && r['status'] !== null
      ? (r['status'] as Record<string, unknown>)
      : {};
  const route = 'string' === typeof status['route'] ? status['route'] : '';
  const key = snapshotCacheKey(opts.sessionId, opts.scope, opts.mode);

  if (!opts.diff) {
    cache.remember(key, route, tree);
    return raw;
  }

  const prev = cache.recall(key, route);
  cache.remember(key, route, tree);
  const decision = snapshotDelta(prev, tree);
  if (decision.mode === SnapshotDeltaMode.FULL) return raw;
  // The walk stops at a node cap and returns a DOCUMENT-ORDER PREFIX, so two capped snapshots of a
  // large page are identical whenever the change happened past the cap — and "unchanged" is then a
  // statement about the cap, not about the page. Carried through on both branches: a delta computed
  // over a prefix is real but not exhaustive either.
  const capped = true === r['truncated'] ? { truncated: true, note: CAPPED_DIFF_NOTE } : {};
  if (decision.mode === SnapshotDeltaMode.UNCHANGED) {
    return { mode: SnapshotDeltaMode.UNCHANGED, status: r['status'], ...capped };
  }
  return { mode: SnapshotDeltaMode.DELTA, delta: decision.delta, status: r['status'], ...capped };
}
