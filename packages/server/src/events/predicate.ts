import {
  ElementState,
  ReticleCommand,
  type CommandResult,
  type ElementQuery,
  type ReticleEvent,
  type MatchResult,
} from '@reticlehq/core';
import { selectPath, capDepth } from '../session/state-select.js';
import { isAmbient, ambientKeyOf, type AmbientCounts } from '../journal/ambient.js';
import {
  PredicateSchema,
  matchValue,
  evalNet,
  evalRoute,
  evalConsole,
  evalAnimation,
  evalSignal,
  evalSettled,
  type Predicate,
  type EvalResult,
} from './predicate-eval.js';

export { PredicateSchema };
export type { Predicate, EvalResult };

/** The subset of Session the predicate engine needs — keeps it testable with a fake. */
export interface PredicateSession {
  command(name: string, args?: Record<string, unknown>): Promise<CommandResult>;
  eventsSince(cursor: number): ReticleEvent[];
  onEvent(listener: (event: ReticleEvent) => void): () => void;
  /** Milliseconds since connect — the same clock that stamps event `t` (injected, testable). */
  elapsed(): number;
  /**
   * Learned per-ref ambient-churn counts (real-time regions that churn with no action driving them).
   * The settle oracle drops events on learned-ambient refs so a chat/ticker page can still go quiet.
   * Optional: a session without ambient learning simply omits it and settle behaves as before.
   */
  ambientCounts?(): AmbientCounts;
}

async function matchOnce(
  session: PredicateSession,
  query: ElementQuery,
  state: ElementState | undefined,
): Promise<MatchResult> {
  const res = await session.command(ReticleCommand.MATCH, { query, state });
  if (!res.ok) return { matched: false, count: 0, elements: [] };
  return (res.result ?? { matched: false, count: 0, elements: [] }) as MatchResult;
}

async function evalElement(
  session: PredicateSession,
  query: ElementQuery,
  state: ElementState | undefined,
  absent: boolean,
): Promise<EvalResult> {
  const match = await matchOnce(session, query, state);
  const subject = JSON.stringify(query);
  if (absent) {
    return match.matched
      ? {
          pass: false,
          failureReason: `expected element to be absent but found ${String(match.count)}`,
          observed: `${String(match.count)} element(s) matching ${subject}`,
          expected: `no element matching ${subject}`,
          assertion: 'element.absent',
          evidence: match.elements,
        }
      : { pass: true, evidence: { absent: true } };
  }
  if (match.matched) return { pass: true, evidence: match.elements };

  // Diagnostic near-miss: was it there but in the wrong state, or a similar element present?
  if (state !== undefined) {
    const relaxed = await matchOnce(session, query, undefined);
    if (relaxed.matched) {
      return {
        pass: false,
        failureReason: `element exists but not in state '${state}'`,
        observed: `element matching ${subject} is present, states: ${
          relaxed.elements[0]?.states.join(', ') ?? 'unknown'
        }`,
        expected: `element matching ${subject} in state '${state}'`,
        assertion: 'element.state',
        evidence: { nearMiss: relaxed.elements },
      };
    }
  }
  if (query.role !== undefined && query.name !== undefined) {
    const roleOnly = await matchOnce(session, { role: query.role }, state);
    if (roleOnly.matched) {
      return {
        pass: false,
        failureReason: `no '${query.role}' named '${query.name}'; saw: ${roleOnly.elements
          .map((e) => e.name)
          .filter((n) => n.length > 0)
          .join(', ')}`,
        observed: `${String(roleOnly.count)} '${query.role}' element(s), named: ${roleOnly.elements
          .map((e) => e.name)
          .filter((n) => n.length > 0)
          .join(', ')}`,
        expected: `a '${query.role}' named '${query.name}'`,
        assertion: 'element.role+name',
        evidence: { nearMiss: roleOnly.elements },
      };
    }
  }
  return {
    pass: false,
    failureReason: `no element matched ${subject}${state === undefined ? '' : ` in state '${state}'`}`,
    observed: 'no matching element on the page',
    expected: `an element matching ${subject}${state === undefined ? '' : ` in state '${state}'`}`,
    assertion: 'element.present',
  };
}

async function evalState(
  session: PredicateSession,
  p: Extract<Predicate, { kind: 'state' }>,
): Promise<EvalResult> {
  const res = await session.command(
    ReticleCommand.STATE_READ,
    p.store !== undefined ? { store: p.store } : {},
  );
  if (!res.ok) {
    return {
      pass: false,
      failureReason: 'state read failed',
      observed: 'the store could not be read',
      expected: 'a readable registered store',
      assertion: 'state.unreadable',
    };
  }
  const stores = ((res.result ?? {}) as { stores?: Record<string, unknown> }).stores ?? {};
  const names = Object.keys(stores);
  const storeName = p.store ?? (names.length === 1 ? names[0] : undefined);
  if (storeName === undefined) {
    return {
      pass: false,
      failureReason:
        names.length === 0
          ? 'no registered store to read state from'
          : `multiple stores (${names.join(', ')}); name one with \`store\``,
    };
  }
  const selection = selectPath(stores[storeName], p.path);
  if (!selection.found) {
    return {
      pass: false,
      failureReason: `state path '${p.path}' not found in store '${storeName}'`,
      observed: `no path '${p.path}' in store '${storeName}'`,
      expected: `store '${storeName}' to expose '${p.path}'`,
      assertion: 'state.path-missing',
      evidence: { availableKeys: selection.availableKeys },
    };
  }
  const want = p.equals === undefined ? '*' : p.equals;
  if (matchValue(selection.value, want)) {
    return {
      pass: true,
      evidence: { store: storeName, path: p.path, value: capDepth(selection.value, 1) },
    };
  }
  return {
    pass: false,
    failureReason: `state '${p.path}' is ${JSON.stringify(capDepth(selection.value, 0))}, expected ${JSON.stringify(want)}`,
    observed: `${p.path} = ${JSON.stringify(capDepth(selection.value, 0))}`,
    expected: `${p.path} = ${JSON.stringify(want)}`,
    assertion: 'state.equals',
    evidence: { store: storeName, path: p.path, value: capDepth(selection.value, 1) },
  };
}

export async function evaluatePredicate(
  session: PredicateSession,
  predicate: Predicate,
  since = 0,
): Promise<EvalResult> {
  const events = session.eventsSince(since);
  switch (predicate.kind) {
    case 'element':
      return evalElement(session, predicate.query, predicate.state, predicate.absent ?? false);
    case 'text':
      return evalElement(
        session,
        { text: predicate.contains },
        predicate.visible === true ? ElementState.VISIBLE : undefined,
        predicate.absent ?? false,
      );
    case 'net':
      return evalNet(events, predicate);
    case 'route':
      return evalRoute(events, predicate);
    case 'console':
      return evalConsole(events, predicate);
    case 'animation':
      return evalAnimation(events, predicate);
    case 'signal':
      return evalSignal(events, predicate);
    case 'state':
      return evalState(session, predicate);
    case 'settled': {
      // Drop events on learned-ambient regions (chat/ticker churn) before the settle check — by ref
      // alone, NOT by attribution: window-attribution ("happened during the action window") is a time
      // heuristic, never causation, so a chat message arriving mid-window must not hold settle open.
      const counts = session.ambientCounts?.();
      const settleEvents =
        counts === undefined ? events : events.filter((e) => !isAmbient(counts, ambientKeyOf(e)));
      return evalSettled(settleEvents, predicate, session.elapsed());
    }
    case 'allOf': {
      const results = await Promise.all(
        predicate.predicates.map((p) => evaluatePredicate(session, p, since)),
      );
      const failed = results.find((r) => !r.pass);
      return failed === undefined
        ? { pass: true, evidence: results.map((r) => r.evidence) }
        : {
            pass: false,
            failureReason: failed.failureReason ?? 'a sub-predicate of allOf failed',
            evidence: results,
          };
    }
    case 'anyOf': {
      const results = await Promise.all(
        predicate.predicates.map((p) => evaluatePredicate(session, p, since)),
      );
      const passed = results.find((r) => r.pass);
      return passed !== undefined
        ? { pass: true, evidence: passed.evidence }
        : { pass: false, failureReason: 'no sub-predicate of anyOf matched', evidence: results };
    }
    case 'not': {
      const inner = await evaluatePredicate(session, predicate.predicate, since);
      return inner.pass
        ? { pass: false, failureReason: 'negated predicate unexpectedly held', evidence: inner }
        : { pass: true };
    }
    default:
      return { pass: false, failureReason: 'unknown predicate' };
  }
}

/**
 * Evaluate now, else wait for it to become true (on each event + a poll) until timeout. `since` is
 * the event-time floor (see evaluatePredicate) so a waiter cannot resolve on a stale buffered event.
 */
export function waitForPredicate(
  session: PredicateSession,
  predicate: Predicate,
  timeoutMs: number,
  since = 0,
): Promise<EvalResult> {
  return new Promise<EvalResult>((resolve) => {
    let done = false;
    const failed = (error: unknown): EvalResult => ({
      pass: false,
      failureReason: error instanceof Error ? error.message : String(error),
    });
    const finish = (result: EvalResult): void => {
      if (done) return;
      done = true;
      unsub();
      clearInterval(interval);
      clearTimeout(timer);
      resolve(result);
    };
    // Coalesce re-checks: at most ONE evaluatePredicate is ever in flight (each can be a browser
    // MATCH/STATE_READ round-trip). Events that arrive while one is running set a single trailing
    // re-check instead of each firing their own command — otherwise a page emitting an event per
    // animation frame fans out hundreds of concurrent round-trips and collapses under backpressure.
    let inFlight = false;
    let pendingRecheck = false;
    const check = (): void => {
      if (done) return;
      if (inFlight) {
        pendingRecheck = true;
        return;
      }
      inFlight = true;
      void evaluatePredicate(session, predicate, since)
        .then((r) => {
          if (r.pass) finish(r);
        })
        .catch((error: unknown) => {
          finish(failed(error));
        })
        .finally(() => {
          inFlight = false;
          if (pendingRecheck && !done) {
            pendingRecheck = false;
            check();
          }
        });
    };
    const unsub = session.onEvent(() => {
      check();
    });
    const interval = setInterval(check, 150);
    const timer = setTimeout(() => {
      void evaluatePredicate(session, predicate, since)
        .then((r) => {
          finish({
            pass: false,
            evidence: r.evidence,
            failureReason: r.failureReason ?? 'timed out waiting for predicate',
          });
        })
        .catch((error: unknown) => {
          finish(failed(error));
        });
    }, timeoutMs);
    check();
  });
}
