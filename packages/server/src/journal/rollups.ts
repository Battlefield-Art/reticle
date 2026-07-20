import { EventType, type ReticleEvent } from '@reticlehq/core';

/**
 * A route-segment rollup: what happened between two ROUTE_CHANGE events. Aggregated, not raw — the
 * unit the deviation report (B16) compares against an expected envelope. Computed by folding the
 * journal's events; per the plan's risk note this runs lazily on query rather than threading a
 * stateful accumulator through the hot write path.
 */
export interface SegmentRollup {
  /** The route (pathname) this segment is on, from its opening ROUTE_CHANGE. Absent for the first. */
  route?: string;
  /** Elapsed-ms of the first and last event in the segment. */
  from: number;
  to: number;
  /** Wall span of the segment (to - from). */
  durationMs: number;
  /** Distinct attributed actions observed in the segment. */
  actions: number;
  /** Network request totals and error count (status >= 400 or ok === false). */
  net: { total: number; errors: number };
  /** console.error + uncaught errors/rejections. */
  consoleErrors: number;
  /** Unique state-change paths touched, in first-seen order. */
  statePathsChanged: string[];
}

interface SegmentAcc {
  route?: string;
  from: number;
  to: number;
  actionIds: Set<string>;
  netTotal: number;
  netErrors: number;
  consoleErrors: number;
  statePaths: string[];
}

function finalize(acc: SegmentAcc): SegmentRollup {
  return {
    ...(acc.route === undefined ? {} : { route: acc.route }),
    from: acc.from,
    to: acc.to,
    durationMs: acc.to - acc.from,
    actions: acc.actionIds.size,
    net: { total: acc.netTotal, errors: acc.netErrors },
    consoleErrors: acc.consoleErrors,
    statePathsChanged: acc.statePaths,
  };
}

function isNetError(event: ReticleEvent): boolean {
  const status = event.data['status'];
  return event.data['ok'] === false || (typeof status === 'number' && status >= 400);
}

/**
 * Fold an ordered event list into route segments split at each ROUTE_CHANGE. Pure: no clock, no IO —
 * the events carry their own `t`. The events must be in journal order (seq/t ascending).
 */
export function computeSegments(events: readonly ReticleEvent[]): SegmentRollup[] {
  const segments: SegmentRollup[] = [];
  let acc: SegmentAcc | undefined;

  const open = (route: string | undefined, t: number): SegmentAcc => ({
    ...(route === undefined ? {} : { route }),
    from: t,
    to: t,
    actionIds: new Set<string>(),
    netTotal: 0,
    netErrors: 0,
    consoleErrors: 0,
    statePaths: [],
  });

  for (const event of events) {
    if (event.type === EventType.ROUTE_CHANGE) {
      if (acc !== undefined) segments.push(finalize(acc));
      const pathname = event.data['pathname'];
      acc = open(typeof pathname === 'string' ? pathname : undefined, event.t);
      continue;
    }
    if (acc === undefined) acc = open(undefined, event.t);
    acc.to = event.t;
    if (typeof event.actionId === 'string') acc.actionIds.add(event.actionId);
    if (event.type === EventType.NET_REQUEST) {
      acc.netTotal += 1;
      if (isNetError(event)) acc.netErrors += 1;
    }
    if (event.type === EventType.CONSOLE_ERROR || event.type === EventType.ERROR_UNCAUGHT) {
      acc.consoleErrors += 1;
    }
    if (event.type === EventType.STATE_CHANGE) {
      const name = event.data['name'];
      if (typeof name === 'string' && !acc.statePaths.includes(name)) acc.statePaths.push(name);
    }
  }
  if (acc !== undefined) segments.push(finalize(acc));
  return segments;
}
