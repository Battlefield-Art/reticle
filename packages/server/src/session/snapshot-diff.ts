/**
 * Pre/post snapshot diff — PURE HELPER, NOT WIRED. Read the tense carefully: this module can compute a
 * diff, but nothing in the server captures the "before" it needs.
 *
 * It was written as the fallback for stores and storage areas that emit no change events (unregistered
 * stores, pull-only areas), and its doc previously said the server "snapshots registered store paths +
 * storage keys BEFORE dispatching an action and again after". It does not. causalSummary derives diffs
 * purely from the `old`/`value` fields on emitted STATE/STORAGE_CHANGE events, so a store that emits
 * nothing produces no diff at all — the gap this module was meant to close is still open.
 *
 * Wire the capture or delete this. Do not leave a comment implying the fallback is live.
 * Pure: two flat snapshots (key → value) in, the changed keys with before/after out.
 */
export interface SnapshotChange {
  key: string;
  before?: unknown;
  after?: unknown;
}

/** Structural equality via canonical JSON — good enough for store/storage values (no functions/cycles). */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** The keys whose value changed between two snapshots, with both sides for a side-by-side. */
export function diffSnapshots(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): SnapshotChange[] {
  const changes: SnapshotChange[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!equal(before[key], after[key])) {
      changes.push({ key, before: before[key], after: after[key] });
    }
  }
  return changes;
}
