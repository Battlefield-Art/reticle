import { ContradictionKind, EventType, MUTATING_METHODS, type ReticleEvent } from '@reticlehq/core';
import { asNumber, asString } from '../tools/tools-helpers.js';

/**
 * The contradiction hunter.
 *
 * Every other check in Reticle reads ONE channel and asks "did something bad happen there?" — a
 * console error, a 500, a control that did nothing. A human can do that too, just slower.
 *
 * This asks a question a human structurally cannot: do the channels DISAGREE with each other? A
 * person watching an app has exactly one channel open — the screen. The agent holds the DOM, the
 * store, the app's own signals, the console and the network in one causally ordered window, so it
 * can catch the case where the screen says one thing and the network says the opposite.
 *
 * That gap is where false greens live. The archetype ships in both desktop demos: click Archive, the
 * row disappears, the status line reads "archived", and the IPC call rejected into a swallowed
 * `.catch()`. A screenshot agrees. A DOM assertion agrees. A human agrees. Only the disagreement
 * between channels reveals it.
 *
 * Pure: a window of events in, findings out. No session, no IO, no clock.
 */

export interface Contradiction {
  kind: ContradictionKind;
  /** What one channel asserted — the optimistic half. */
  claim: string;
  /** What the other channel asserted — the half that contradicts it. */
  counter: string;
  /** Concrete evidence, so the agent can go straight to the call or the control. */
  detail: string;
}

interface NetCall {
  method: string;
  url: string;
  status: number | undefined;
  ok: boolean;
}

function netCall(e: ReticleEvent): NetCall {
  const status = asNumber(e.data['status']);
  return {
    method: (asString(e.data['method']) ?? '').toUpperCase(),
    url: asString(e.data['url']) ?? '',
    status,
    // `ok` is authoritative when present (IPC sets it explicitly); status is the HTTP fallback.
    ok:
      e.data['ok'] === true || (e.data['ok'] === undefined && status !== undefined && status < 400),
  };
}

/**
 * Did the user-visible application state move forward? DOM, store and route only — deliberately NOT
 * network, animation or signal. The question every rule below asks is "did the app act as if it
 * succeeded", and a request firing is not the app acting as if anything.
 */
function uiAdvanced(events: readonly ReticleEvent[]): boolean {
  return events.some(
    (e) =>
      e.type === EventType.DOM_ADDED ||
      e.type === EventType.DOM_REMOVED ||
      e.type === EventType.DOM_ATTR ||
      e.type === EventType.DOM_TEXT ||
      e.type === EventType.STATE_CHANGE ||
      e.type === EventType.ROUTE_CHANGE,
  );
}

function isMutating(call: NetCall): boolean {
  return MUTATING_METHODS.includes(call.method);
}

/** State paths/values that read as the app recording a failure rather than hiding one. */
const ACKNOWLEDGED = /error|fail|invalid|reject|denied|unable|could not|couldn't/i;

/**
 * Did the app record the failure in its OWN state — the layer the UI renders from?
 *
 * Without this, "the UI moved while a request failed" fires on correct code: a handler that catches
 * the rejection and renders "could not add" also moves the UI. Both look identical at the level of
 * "DOM changed + request failed"; what separates them is whether the app acknowledged the failure
 * anywhere, or silently proceeded as if it had succeeded.
 *
 * Deliberately NOT satisfied by a console error. `console.error` is invisible to the user, so an app
 * that logs and then shows success is still lying to whoever is looking at it — precisely the case
 * worth reporting.
 *
 * A heuristic, and the one soft edge in this file: an app that surfaces failure through a value this
 * pattern does not recognize will produce a finding a human must dismiss. That direction is the safe
 * one — a false alarm costs a glance, a missed false green ships.
 */
function failureAcknowledged(events: readonly ReticleEvent[]): boolean {
  return events.some((e) => {
    if (e.type !== EventType.STATE_CHANGE) return false;
    const path = asString(e.data['path']) ?? '';
    const value = e.data['value'];
    return ACKNOWLEDGED.test(path) || (typeof value === 'string' && ACKNOWLEDGED.test(value));
  });
}

function describe(call: NetCall): string {
  return `${call.method} ${call.url}${call.status === undefined ? '' : ` → ${String(call.status)}`}`;
}

export function findContradictions(events: readonly ReticleEvent[]): Contradiction[] {
  const found: Contradiction[] = [];
  const settled = events.filter((e) => e.type === EventType.NET_REQUEST).map(netCall);
  const failed = settled.filter((c) => !c.ok);
  const advanced = uiAdvanced(events);
  const signals = events
    .filter((e) => e.type === EventType.SIGNAL)
    .map((e) => asString(e.data['name']) ?? 'signal');

  // ── The app claimed success while its own request failed ────────────────────────────────────
  // A signal is the sharper claim: the app did not merely LOOK right, it explicitly asserted
  // success. When both hold it is one fact, so only the sharper one is reported.
  if (failed.length > 0 && signals.length > 0) {
    found.push({
      kind: ContradictionKind.SIGNAL_CONTRADICTED,
      claim: `the app fired ${signals.map((s) => `"${s}"`).join(', ')}`,
      counter: `${String(failed.length)} request(s) in the same window failed`,
      detail: failed.map(describe).join('; '),
    });
  } else if (failed.length > 0 && advanced && !failureAcknowledged(events)) {
    found.push({
      kind: ContradictionKind.UI_ADVANCED_REQUEST_FAILED,
      claim: 'the UI moved forward (DOM/store/route changed)',
      counter: `${String(failed.length)} request(s) in the same window failed`,
      detail: failed.map(describe).join('; '),
    });
  }

  // ── A write succeeded and nothing on the client moved ───────────────────────────────────────
  // Writes only: a GET that changes nothing is a prefetch; a POST that changes nothing is a lost
  // write, a response parsed into the void, or a render that never happened.
  if (!advanced) {
    const ignoredWrites = settled.filter((c) => c.ok && isMutating(c));
    if (ignoredWrites.length > 0) {
      found.push({
        kind: ContradictionKind.RESPONSE_IGNORED,
        claim: `${String(ignoredWrites.length)} write(s) succeeded on the server`,
        counter: 'nothing on the client changed — no DOM, store or route movement',
        detail: ignoredWrites.map(describe).join('; '),
      });
    }
  }

  // ── The same write fired more than once ─────────────────────────────────────────────────────
  const writeCounts = new Map<string, number>();
  for (const call of settled) {
    if (!isMutating(call)) continue;
    const key = `${call.method} ${call.url}`;
    writeCounts.set(key, (writeCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of writeCounts) {
    if (count < 2) continue;
    found.push({
      kind: ContradictionKind.DUPLICATE_REQUEST,
      claim: 'one user action was performed',
      counter: `the same write fired ${String(count)} times`,
      detail: `${key} ×${String(count)}`,
    });
  }

  // ── The UI advanced over a request that never came back ─────────────────────────────────────
  // Gated on the UI having moved: an in-flight request while the app is still visibly waiting is
  // just a slow request, not a contradiction. It becomes one when the app proceeded regardless —
  // which is also what makes a later `{ kind: "settled" }` assertion a false green.
  if (advanced) {
    const settledIds = new Set(
      events
        .filter((e) => e.type === EventType.NET_REQUEST)
        .map((e) => asString(e.data['id']))
        .filter((id): id is string => id !== undefined),
    );
    const inFlight = events
      .filter((e) => e.type === EventType.NET_PENDING)
      .map((e) => ({ id: asString(e.data['id']), call: netCall(e) }))
      .filter((p) => p.id === undefined || !settledIds.has(p.id));
    if (inFlight.length > 0) {
      found.push({
        kind: ContradictionKind.REQUEST_NEVER_SETTLED,
        claim: 'the UI moved forward and the action reported done',
        counter: `${String(inFlight.length)} request(s) were still in flight`,
        detail: inFlight.map((p) => describe(p.call)).join('; '),
      });
    }
  }

  return found;
}
