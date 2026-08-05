import { EventType, PerfMetric, type ReticleEvent } from '@reticlehq/core';

/**
 * The causal summary (Tier 1) — the bounded ~50–100 token block on EVERY act, green included: what the
 * app did in the act's window, as counts + a headline, not a raw event dump. Diffs come from the
 * storage/state events; attribution from. Pure composition over the attributed event window.
 */
export interface StateDiff {
  path: string;
  from: unknown;
  to: unknown;
  /**
   * WHEN this path moved, in the session's elapsed ms.
   *
   * The whole reason a transient was invisible. A store that ends internally consistent can have been
   * inconsistent on the way there, and a from→to pair cannot express that — measured on a real
   * merchant dashboard, an account switch moved `accountId` immediately and `payments` 160 ms later,
   * so for 160 ms the header named one tenant while the rows belonged to another. Both diffs were
   * reported; nothing said they were 160 ms apart, and waiting for the page to settle is by
   * construction waiting for the evidence to disappear. The timestamp was on the event all along.
   */
  atMs: number;
}
export interface StorageDiff {
  key: string;
  from?: unknown;
  to?: unknown;
}
export interface CausalSummary {
  net: { total: number; errors: number; headline?: string };
  consoleErrors: number;
  statePathsChanged: string[];
  storageKeysChanged: string[];
  /** Before→after for each changed store path — the diffs, not just the names. Values capped. */
  stateDiffs: StateDiff[];
  /**
   * How long the store took to stop moving: last state change − first, in ms. Present only when more
   * than one path changed, because with a single change there is no interval to describe.
   *
   * A FACT, not a verdict. Many apps update progressively and that is fine; calling every stagger a
   * defect would make this a noise generator. But a non-zero value is the exact window in which the
   * UI showed a MIXTURE of old and new, and that window is where the tenant-mismatch class of bug
   * lives — so it is stated once, cheaply, and the agent decides.
   */
  stateSettleMs?: number;
  /** Before→after for each changed storage key. Values capped. */
  storageDiffs: StorageDiff[];
  route?: string;
  signals: string[];
  layoutShift?: number;
  longTasks: number;
}

function pushUnique(list: string[], value: unknown): void {
  if (typeof value === 'string' && value.length > 0 && !list.includes(value)) list.push(value);
}

/** Keep a diff value bounded so the per-act summary never bloats: primitives capped to a short string. */
const MAX_DIFF_LEN = 140;
/** Truncate to at most MAX_DIFF_LEN chars total, including the ellipsis marker. */
function truncate(text: string): string {
  return text.length > MAX_DIFF_LEN ? `${text.slice(0, MAX_DIFF_LEN - 1)}…` : text;
}
function capValue(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  // Objects/arrays: a shallow, length-capped JSON repr (never a deep dump on the hot path).
  try {
    return truncate(JSON.stringify(value));
  } catch {
    return '[unserializable]';
  }
}

/**
 * The span over which the store was still moving — and therefore possibly self-inconsistent.
 *
 * Omitted for 0 or 1 diffs (no interval) and for a spread of 0 (everything landed in one tick), so a
 * store that updates atomically pays nothing and the field's PRESENCE is what carries the meaning.
 */
function stateSettle(diffs: readonly StateDiff[]): { stateSettleMs?: number } {
  if (diffs.length < 2) return {};
  const times = diffs.map((d) => d.atMs);
  const spread = Math.max(...times) - Math.min(...times);
  return spread > 0 ? { stateSettleMs: spread } : {};
}

export function causalSummary(events: readonly ReticleEvent[]): CausalSummary {
  let netTotal = 0;
  let netErrors = 0;
  let headline: string | undefined;
  let consoleErrors = 0;
  const statePathsChanged: string[] = [];
  const storageKeysChanged: string[] = [];
  const stateDiffs: StateDiff[] = [];
  const storageDiffs: StorageDiff[] = [];
  let route: string | undefined;
  const signals: string[] = [];
  let layoutShift: number | undefined;
  let longTasks = 0;

  for (const event of events) {
    const data = event.data;
    switch (event.type) {
      case EventType.NET_REQUEST: {
        netTotal += 1;
        const status = data['status'];
        const failed = data['ok'] === false || (typeof status === 'number' && status >= 400);
        if (failed) {
          netErrors += 1;
          // Headline is the first failing request — the thing most worth the agent's eye.
          headline ??= `${String(data['method'])} ${String(data['url'])} ${String(status)}`;
        }
        break;
      }
      case EventType.CONSOLE_ERROR:
      case EventType.ERROR_UNCAUGHT:
        consoleErrors += 1;
        break;
      case EventType.STATE_CHANGE: {
        pushUnique(statePathsChanged, data['name']);
        // The subscribed-store observer emits { name, path, value, old } — `value` is the AFTER side
        // (`new` is accepted too for any producer that uses it). Presence of either makes it a real
        // before→after diff rather than a bare reading.
        const path = typeof data['path'] === 'string' ? data['path'] : data['name'];
        const hasAfter = 'value' in data || 'new' in data;
        if (typeof path === 'string' && path.length > 0 && ('old' in data || hasAfter)) {
          const after = 'value' in data ? data['value'] : data['new'];
          stateDiffs.push({
            path,
            from: capValue(data['old']),
            to: capValue(after),
            atMs: event.t,
          });
        }
        break;
      }
      case EventType.STORAGE_CHANGE: {
        pushUnique(storageKeysChanged, data['key']);
        const key = data['key'];
        if (typeof key === 'string' && key.length > 0) {
          storageDiffs.push({ key, from: capValue(data['old']), to: capValue(data['new']) });
        }
        break;
      }
      case EventType.ROUTE_CHANGE:
        if (typeof data['pathname'] === 'string') route = data['pathname'];
        break;
      case EventType.SIGNAL:
        pushUnique(signals, data['name']);
        break;
      case EventType.PERF:
        if (data['metric'] === PerfMetric.CLS && typeof data['value'] === 'number') {
          layoutShift = Math.max(layoutShift ?? 0, data['value']);
        } else if (data['metric'] === PerfMetric.LONGTASK) {
          longTasks += 1;
        }
        break;
      default:
        break;
    }
  }

  return {
    net: { total: netTotal, errors: netErrors, ...(headline === undefined ? {} : { headline }) },
    consoleErrors,
    statePathsChanged,
    storageKeysChanged,
    stateDiffs,
    ...stateSettle(stateDiffs),
    storageDiffs,
    ...(route === undefined ? {} : { route }),
    signals,
    ...(layoutShift === undefined ? {} : { layoutShift }),
    longTasks,
  };
}
