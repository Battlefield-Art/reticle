import {
  EventType,
  PhenomenonType,
  type JournalAction,
  type ReticleEvent,
} from '@reticlehq/core';

/**
 * A detected phenomenon — a named, evidence-backed anomaly over the journal. Deterministic matchers, no
 * scanning by the agent: the layer names the fault, the agent acts on the name. `pre-hydration-click`
 * lands once the hydration signal (a later W4 item) exists; the three here need only journal data.
 */
export interface Finding {
  phenomenon: PhenomenonType;
  evidence: Record<string, unknown>;
}

/** ACT tools that represent a user-style interaction (a "click"), for dead-click detection. */
const CLICK_TOOLS = new Set(['reticle_act', 'reticle_act_and_wait']);

/** A request that started (NET_PENDING) but never completed (no NET_REQUEST with the same id). */
export function detectHungRequests(events: readonly ReticleEvent[]): Finding[] {
  const completed = new Set<unknown>();
  for (const event of events) {
    if (event.type === EventType.NET_REQUEST) completed.add(event.data['id']);
  }
  const findings: Finding[] = [];
  for (const event of events) {
    if (event.type !== EventType.NET_PENDING) continue;
    if (completed.has(event.data['id'])) continue;
    findings.push({
      phenomenon: PhenomenonType.HUNG_REQUEST,
      evidence: { id: event.data['id'], method: event.data['method'], url: event.data['url'] },
    });
  }
  return findings;
}

/** A 5xx response observed while the page was hidden — an error the user never sees. */
export function detectHidden500(events: readonly ReticleEvent[]): Finding[] {
  const findings: Finding[] = [];
  let hidden = false;
  for (const event of events) {
    if (event.type === EventType.PAGE_HEALTH) {
      const h = event.data['hidden'];
      if (typeof h === 'boolean') hidden = h;
      continue;
    }
    if (event.type !== EventType.NET_REQUEST) continue;
    const status = event.data['status'];
    if (hidden && typeof status === 'number' && status >= 500) {
      findings.push({
        phenomenon: PhenomenonType.HIDDEN_500,
        evidence: { url: event.data['url'], status, method: event.data['method'] },
      });
    }
  }
  return findings;
}

/** An act that dispatched but attributed no events — the app did nothing. */
export function detectDeadClicks(actions: readonly JournalAction[]): Finding[] {
  const findings: Finding[] = [];
  for (const action of actions) {
    if (!CLICK_TOOLS.has(action.tool)) continue;
    if (action.seqRange !== undefined) continue; // it caused something → not dead
    findings.push({
      phenomenon: PhenomenonType.DEAD_CLICK,
      evidence: { actionId: action.actionId, tool: action.tool, args: action.args },
    });
  }
  return findings;
}

/** Run every journal-only matcher over a session's events + actions. */
export function detectPhenomena(
  events: readonly ReticleEvent[],
  actions: readonly JournalAction[],
): Finding[] {
  return [
    ...detectHungRequests(events),
    ...detectHidden500(events),
    ...detectDeadClicks(actions),
  ];
}
