/**
 * Pre/post snapshot diff (W3 B18). The server snapshots registered store paths + storage keys BEFORE
 * dispatching an action and again after, so the causal summary reports a DIFF, not a reading — the
 * "before" the pull path alone can never show. This is the fallback for stores/storage that don't emit
 * change events (unregistered stores, pull-only areas); the W3 STATE/STORAGE_CHANGE events cover the
 * rest. Pure: two flat snapshots (key → value) in, the changed keys with before/after out.
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
