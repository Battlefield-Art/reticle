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
  [BlindSpotKind.CLOSED_SHADOW_ROOT]: (n) =>
    `${String(n)} closed shadow root${n === 1 ? '' : 's'} unobserved`,
  [BlindSpotKind.CROSS_ORIGIN_IFRAME]: (n) =>
    `${String(n)} cross-origin frame${n === 1 ? '' : 's'} unobserved`,
  [BlindSpotKind.VIRTUALIZED_UNMOUNTED]: (n) =>
    `${String(n)} virtualized unmounted row${n === 1 ? '' : 's'} unobserved`,
  // Not "some rows we could not see" — the events never reached the observer, so this window is a
  // SAMPLE of what the app did. Phrased as a caveat on what the whole result MEANS.
  [BlindSpotKind.RATE_LIMITED]: (n) =>
    `${String(n)} event${n === 1 ? '' : 's'} dropped by the bridge rate cap, so this window is SAMPLED — raise RETICLE_MAX_MESSAGES_PER_SECOND for a busy app`,
  // Not a count of things — a single fact about the page. Phrased so the coverage line reads as a
  // caveat on what the network view MEANS, not as a tally.
  [BlindSpotKind.WRAPPED_NETWORK]: () =>
    'fetch was already wrapped before Reticle, so recorded requests may differ from what was sent',
};

/** Compose the coverage statement. `full` (no note) when nothing was unobserved. */
export function buildCoverageStatement(spots: readonly BlindSpot[]): CoverageStatement {
  const present = spots.filter((s) => s.count > 0);
  if (present.length === 0) return { coverage: 'full', spots: [] };
  // Each label carries its own ending. Appending a blanket " unobserved" here produced
  // "...may differ from what was sent unobserved" for the wrapped-network caveat, which is a
  // sentence rather than a count — and the same dangle appeared the moment a second prose-shaped
  // spot (rate-limited sampling) was added.
  const note = `partial — ${present.map((s) => LABEL[s.kind](s.count)).join(', ')}`;
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
