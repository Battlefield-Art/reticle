/**
 * Blind-spot register — the never-silent statement of what the layer CANNOT see. Closed shadow roots,
 * cross-origin iframes, and virtualized-unmounted rows are documented limits; a result that touched one
 * says so (`coverage: partial — 2 cross-origin frames unobserved`) instead of implying it saw everything.
 * Pure formatting over the counted blind spots the observers report.
 */

// The kind enum lives in core (it crosses the wire in a BLIND_SPOT event); re-exported here so existing
// honesty-side imports keep working.
export { BlindSpotKind } from '@reticlehq/core';
import { BlindSpotKind, EventType, type ReticleEvent } from '@reticlehq/core';

export interface BlindSpot {
  kind: BlindSpotKind;
  count: number;
}

export interface CoverageStatement {
  coverage: 'full' | 'partial';
  /** Present only when partial — the human/agent-legible list of what went unobserved. */
  note?: string;
  spots: BlindSpot[];
}

const LABEL: Record<BlindSpotKind, (n: number) => string> = {
  [BlindSpotKind.CLOSED_SHADOW_ROOT]: (n) => `${String(n)} closed shadow root${n === 1 ? '' : 's'}`,
  [BlindSpotKind.CROSS_ORIGIN_IFRAME]: (n) => `${String(n)} cross-origin frame${n === 1 ? '' : 's'}`,
  [BlindSpotKind.VIRTUALIZED_UNMOUNTED]: (n) =>
    `${String(n)} virtualized unmounted row${n === 1 ? '' : 's'}`,
};

/** Compose the coverage statement. `full` (no note) when nothing was unobserved. */
export function buildCoverageStatement(spots: readonly BlindSpot[]): CoverageStatement {
  const present = spots.filter((s) => s.count > 0);
  if (present.length === 0) return { coverage: 'full', spots: [] };
  const note = `partial — ${present.map((s) => `${LABEL[s.kind](s.count)} unobserved`).join(', ')}`;
  return { coverage: 'partial', note, spots: present };
}

/**
 * Reduce a window's BLIND_SPOT events to one spot per kind — the LATEST reported count wins (the sensor
 * emits only on change, so the last value is the live count). This is how a result's coverage is derived
 * from what the SDK observed during the action, with no extra round-trip.
 */
export function blindSpotsFromEvents(events: readonly ReticleEvent[]): BlindSpot[] {
  const latest = new Map<BlindSpotKind, number>();
  for (const e of events) {
    if (e.type !== EventType.BLIND_SPOT) continue;
    const kind = e.data['kind'];
    const count = e.data['count'];
    if (typeof kind === 'string' && typeof count === 'number') {
      latest.set(kind as BlindSpotKind, count);
    }
  }
  return [...latest].map(([kind, count]) => ({ kind, count }));
}

/**
 * Blind spots from the session's remembered LEVEL state rather than from a window of events.
 *
 * The SDK emits BLIND_SPOT only when the count changes, so a page that mounted cross-origin frames at
 * load announces them once and is silent thereafter. Deriving coverage from one act's window then
 * reports "full" for a page a third of which is unobservable — and the act tool's own description
 * tells harnesses to gate on that block. Ask the session what is true now instead of inferring it
 * from what happened to be said recently.
 */
export function blindSpotsFromState(state: Readonly<Record<string, number>>): BlindSpot[] {
  return Object.entries(state).map(([kind, count]) => ({ kind: kind as BlindSpotKind, count }));
}
