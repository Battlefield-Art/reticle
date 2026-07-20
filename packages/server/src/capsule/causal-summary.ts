import { EventType, PerfMetric, type ReticleEvent } from '@reticlehq/core';

/**
 * The causal summary (W5 Tier 1) — the bounded ~50–100 token block on EVERY act, green included: what the
 * app did in the act's window, as counts + a headline, not a raw event dump. Diffs come from the W3
 * storage/state events; attribution from W2. Pure composition over the attributed event window.
 */
export interface CausalSummary {
  net: { total: number; errors: number; headline?: string };
  consoleErrors: number;
  statePathsChanged: string[];
  storageKeysChanged: string[];
  route?: string;
  signals: string[];
  layoutShift?: number;
  longTasks: number;
}

function pushUnique(list: string[], value: unknown): void {
  if (typeof value === 'string' && value.length > 0 && !list.includes(value)) list.push(value);
}

export function causalSummary(events: readonly ReticleEvent[]): CausalSummary {
  let netTotal = 0;
  let netErrors = 0;
  let headline: string | undefined;
  let consoleErrors = 0;
  const statePathsChanged: string[] = [];
  const storageKeysChanged: string[] = [];
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
      case EventType.STATE_CHANGE:
        pushUnique(statePathsChanged, data['name']);
        break;
      case EventType.STORAGE_CHANGE:
        pushUnique(storageKeysChanged, data['key']);
        break;
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
    ...(route === undefined ? {} : { route }),
    signals,
    ...(layoutShift === undefined ? {} : { layoutShift }),
    longTasks,
  };
}
