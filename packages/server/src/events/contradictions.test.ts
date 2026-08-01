import { describe, expect, it } from 'vitest';
import { ContradictionKind, EventType, type ReticleEvent } from '@reticlehq/core';
import { findContradictions } from './contradictions.js';

let seq = 0;
function ev(type: EventType, data: Record<string, unknown> = {}): ReticleEvent {
  seq += 1;
  return { t: seq, seq, type, sessionId: 's', data };
}

const domChanged = (): ReticleEvent => ev(EventType.DOM_REMOVED, { path: 'li' });
const stateChanged = (): ReticleEvent =>
  ev(EventType.STATE_CHANGE, { store: 'app', path: 'todos' });
const okCall = (method = 'POST', url = '/api/x'): ReticleEvent =>
  ev(EventType.NET_REQUEST, { id: `n${String(seq)}`, method, url, status: 200, ok: true });
const failedCall = (method = 'POST', url = '/api/x'): ReticleEvent =>
  ev(EventType.NET_REQUEST, { id: `n${String(seq)}`, method, url, status: 500, ok: false });

const kinds = (events: ReticleEvent[]): string[] => findContradictions(events).map((c) => c.kind);

describe('findContradictions — cross-channel disagreement', () => {
  /**
   * The archetype, and the exact bug both desktop demo apps plant: the row disappears, the status
   * line reads "archived", and the IPC call rejected. Screenshot, DOM assertion and human glance all
   * agree the feature works. Only the disagreement BETWEEN channels reveals it.
   */
  it('catches a UI that advanced while its request failed', () => {
    const found = findContradictions([domChanged(), failedCall('IPC', 'ipc://todos:archive')]);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe(ContradictionKind.UI_ADVANCED_REQUEST_FAILED);
    expect(found[0]?.detail).toContain('ipc://todos:archive');
  });

  /**
   * The discriminator that keeps the headline rule honest. A handler that CATCHES the rejection and
   * renders "could not add" also moves the UI while a request failed — identical at the level of
   * "DOM changed + request failed". What separates correct code from a swallowed error is whether
   * the app recorded the failure anywhere in the state the UI renders from.
   */
  it('stays silent when the app recorded the failure in its own state', () => {
    const acknowledgedByPath = [
      ev(EventType.STATE_CHANGE, { name: 'app', path: 'lastError', value: 'title is required' }),
      failedCall(),
    ];
    expect(kinds(acknowledgedByPath)).toEqual([]);

    const acknowledgedByValue = [
      ev(EventType.STATE_CHANGE, { name: 'app', path: 'status', value: 'stats failed' }),
      failedCall(),
    ];
    expect(kinds(acknowledgedByValue)).toEqual([]);
  });

  it('still reports when the state moved but never mentioned the failure', () => {
    const silent = [
      ev(EventType.STATE_CHANGE, { name: 'app', path: 'status', value: 'archived' }),
      failedCall(),
    ];
    expect(kinds(silent)).toEqual([ContradictionKind.UI_ADVANCED_REQUEST_FAILED]);
  });

  /**
   * A console error does NOT count as acknowledging it. console.error is invisible to the user, so
   * an app that logs and then shows success is still lying to whoever is looking at the screen.
   */
  it('does not accept a console error as surfacing the failure', () => {
    const logged = [
      domChanged(),
      ev(EventType.CONSOLE_ERROR, { message: 'save failed' }),
      failedCall(),
    ];
    expect(kinds(logged)).toEqual([ContradictionKind.UI_ADVANCED_REQUEST_FAILED]);
  });

  it('treats a store mutation as the UI advancing, not just the DOM', () => {
    expect(kinds([stateChanged(), failedCall()])).toEqual([
      ContradictionKind.UI_ADVANCED_REQUEST_FAILED,
    ]);
  });

  /**
   * Strongest form: the app did not merely LOOK right, it fired its own success signal while its
   * request failed. That outranks the generic UI-advanced claim, so only the sharper one is
   * reported — two entries for one fact would be noise.
   */
  it('reports a contradicted signal instead of the weaker UI claim', () => {
    const found = findContradictions([
      domChanged(),
      ev(EventType.SIGNAL, { name: 'todo:archived' }),
      failedCall(),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe(ContradictionKind.SIGNAL_CONTRADICTED);
    expect(found[0]?.claim).toContain('todo:archived');
  });

  it('catches a successful write that changed nothing on the client', () => {
    expect(kinds([okCall('POST', '/api/save')])).toEqual([ContradictionKind.RESPONSE_IGNORED]);
  });

  /**
   * A GET that fires without moving the UI is a prefetch, not a lost write. Restricting the rule to
   * mutating methods is what stops it crying wolf on every ordinary read.
   */
  it('does not treat a GET with no UI change as an ignored response', () => {
    expect(kinds([okCall('GET', '/api/list')])).toEqual([]);
  });

  it('catches the same write firing twice in one action', () => {
    const found = findContradictions([
      okCall('POST', '/api/order'),
      okCall('POST', '/api/order'),
      domChanged(),
    ]);
    expect(found.map((c) => c.kind)).toContain(ContradictionKind.DUPLICATE_REQUEST);
    expect(found.find((c) => c.kind === ContradictionKind.DUPLICATE_REQUEST)?.detail).toContain(
      '2',
    );
  });

  it('does not call two DIFFERENT writes a duplicate', () => {
    expect(kinds([okCall('POST', '/api/a'), okCall('POST', '/api/b'), domChanged()])).toEqual([]);
  });

  it('catches the UI advancing over a request that never settled', () => {
    const pending = ev(EventType.NET_PENDING, { id: 'n99', method: 'POST', url: '/api/slow' });
    expect(kinds([pending, domChanged()])).toEqual([ContradictionKind.REQUEST_NEVER_SETTLED]);
  });

  it('does not flag an in-flight request when the UI did not move (the app is still waiting)', () => {
    const pending = ev(EventType.NET_PENDING, { id: 'n98', method: 'POST', url: '/api/slow' });
    expect(kinds([pending])).toEqual([]);
  });

  it('does not flag a request that settled inside the window', () => {
    const pending = ev(EventType.NET_PENDING, { id: 'n1', method: 'POST', url: '/api/x' });
    const settled = ev(EventType.NET_REQUEST, {
      id: 'n1',
      method: 'POST',
      url: '/api/x',
      status: 200,
      ok: true,
    });
    expect(kinds([pending, settled, domChanged()])).toEqual([]);
  });

  it('is silent on a healthy action — UI moved, the write succeeded', () => {
    expect(kinds([okCall('POST', '/api/save'), domChanged()])).toEqual([]);
  });

  it('is silent on an empty window', () => {
    expect(findContradictions([])).toEqual([]);
  });

  /** A failed request with NO UI movement is an honest failure — the app did not lie about it. */
  it('does not flag a failed request the UI never pretended succeeded', () => {
    expect(kinds([failedCall()])).toEqual([]);
  });
});

describe('failure misattributed — the server broke, the app blamed the user', () => {
  const serverFault = (url = '/api/login'): ReticleEvent =>
    ev(EventType.NET_REQUEST, { id: 'n1', method: 'POST', url, status: 500, ok: false });

  /**
   * Found on a bug this project did not write for this feature: bench-app's `swallowed-500-login`
   * forces /api/login to 500, and the app answers `auth:denied` — the user is told their password is
   * wrong while the backend is down. They cannot fix it, and the real fault is never reported.
   */
  it('catches a 5xx answered with a user-fault signal', () => {
    const found = findContradictions([
      serverFault(),
      ev(EventType.SIGNAL, { name: 'auth:denied' }),
    ]);
    expect(found.map((c) => c.kind)).toContain(ContradictionKind.FAILURE_MISATTRIBUTED);
  });

  it('catches it from state as well as from a signal', () => {
    const found = findContradictions([
      serverFault(),
      ev(EventType.STATE_CHANGE, { name: 'app', path: 'error', value: 'Invalid credentials' }),
    ]);
    expect(found.map((c) => c.kind)).toContain(ContradictionKind.FAILURE_MISATTRIBUTED);
  });

  /** A 4xx genuinely IS the user's fault. Blaming them there is correct, not a contradiction. */
  it('stays silent when the status actually blames the client', () => {
    const clientFault = ev(EventType.NET_REQUEST, {
      id: 'n2',
      method: 'POST',
      url: '/api/login',
      status: 401,
      ok: false,
    });
    const found = findContradictions([clientFault, ev(EventType.SIGNAL, { name: 'auth:denied' })]);
    expect(found.map((c) => c.kind)).not.toContain(ContradictionKind.FAILURE_MISATTRIBUTED);
  });

  it('stays silent when a 5xx is reported honestly as a server problem', () => {
    const found = findContradictions([
      serverFault(),
      ev(EventType.STATE_CHANGE, { name: 'app', path: 'error', value: 'Server error, try again' }),
    ]);
    expect(found.map((c) => c.kind)).not.toContain(ContradictionKind.FAILURE_MISATTRIBUTED);
  });

  /**
   * A failure-shaped signal is not a success claim. Reporting SIGNAL_CONTRADICTED here would say
   * "the app claimed success" about an app that plainly did not — the finding would be true in
   * outline and wrong in its reasoning, which is how a checker loses trust.
   */
  it('does not call a failure signal a contradicted success claim', () => {
    const found = findContradictions([
      serverFault(),
      ev(EventType.SIGNAL, { name: 'auth:denied' }),
    ]);
    expect(found.map((c) => c.kind)).not.toContain(ContradictionKind.SIGNAL_CONTRADICTED);
  });
});

describe('one fact, one finding', () => {
  /**
   * A misattributed failure and "the UI advanced while a request failed" describe the SAME failed
   * call. Reporting both makes the output read as two problems and buries the sharper one, which is
   * how a report stops being actionable.
   */
  it('reports only the sharper misattribution, not the generic UI-advanced claim too', () => {
    const found = findContradictions([
      ev(EventType.NET_REQUEST, {
        id: 'n1',
        method: 'POST',
        url: '/api/login',
        status: 500,
        ok: false,
      }),
      ev(EventType.SIGNAL, { name: 'auth:denied' }),
      domChanged(),
    ]);
    expect(found.map((c) => c.kind)).toEqual([ContradictionKind.FAILURE_MISATTRIBUTED]);
  });

  it('treats a failure-shaped signal as the app acknowledging the failure', () => {
    const found = findContradictions([
      failedCall(),
      ev(EventType.SIGNAL, { name: 'save:failed' }),
      domChanged(),
    ]);
    expect(found).toEqual([]);
  });
});

describe('acknowledgement without relying on English', () => {
  const failed500 = (): ReticleEvent =>
    ev(EventType.NET_REQUEST, {
      id: 'n1',
      method: 'POST',
      url: '/api/save',
      status: 500,
      ok: false,
      error: 'Datenbank nicht erreichbar',
    });

  /**
   * The lexical patterns are English-only, so a German or Japanese app that surfaces its failure
   * perfectly well would still be reported as hiding it. The structural signal costs nothing and is
   * language-independent: if the app put the FAILED CALL'S OWN error text into its state, it plainly
   * knows the call failed, whatever language it says so in.
   */
  it('accepts the failed call’s own error text echoed into state, in any language', () => {
    const found = findContradictions([
      failed500(),
      ev(EventType.STATE_CHANGE, {
        name: 'app',
        path: 'meldung',
        value: 'Datenbank nicht erreichbar',
      }),
      domChanged(),
    ]);
    expect(found).toEqual([]);
  });

  it('still reports when the state moved but never echoed the failure', () => {
    const found = findContradictions([
      failed500(),
      ev(EventType.STATE_CHANGE, { name: 'app', path: 'zustand', value: 'gespeichert' }),
      domChanged(),
    ]);
    expect(found.map((c) => c.kind)).toEqual([ContradictionKind.UI_ADVANCED_REQUEST_FAILED]);
  });

  it('does not match on a trivially short error string', () => {
    const shortErr = ev(EventType.NET_REQUEST, {
      id: 'n2',
      method: 'POST',
      url: '/api/save',
      status: 500,
      ok: false,
      error: 'no',
    });
    const found = findContradictions([
      shortErr,
      ev(EventType.STATE_CHANGE, { name: 'app', path: 'x', value: 'now saved' }),
      domChanged(),
    ]);
    expect(found.map((c) => c.kind)).toEqual([ContradictionKind.UI_ADVANCED_REQUEST_FAILED]);
  });
});
