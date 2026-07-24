import { describe, it, expect } from 'vitest';
import {
  asRef,
  EventType,
  ReticleCommand,
  type CommandResult,
  type ElementQuery,
  type ReticleEvent,
  type MatchResult,
} from '@reticlehq/core';
import {
  evaluatePredicate,
  waitForPredicate,
  provenExpectedLinks,
  type PredicateSession,
} from './predicate.js';
import { predicateToExpectedLinks } from '../capsule/predicate-to-links.js';
import type { Predicate } from './predicate-eval.js';

/** In-memory session: events from an array, MATCH from a supplied matcher. */
class FakeSession implements PredicateSession {
  constructor(
    private readonly events: ReticleEvent[],
    private readonly matcher: (query: ElementQuery) => MatchResult = () => ({
      matched: false,
      count: 0,
      elements: [],
    }),
    private readonly nowMs = 0,
    private readonly ambient: Record<string, number> = {},
  ) {}

  elapsed(): number {
    return this.nowMs;
  }

  ambientCounts(): Record<string, number> {
    return this.ambient;
  }

  command(name: string, args: Record<string, unknown> = {}): Promise<CommandResult> {
    if (name === ReticleCommand.MATCH) {
      const result = this.matcher(args['query'] ?? {});
      return Promise.resolve({ kind: 'command_result', id: 'x', ok: true, result });
    }
    return Promise.resolve({ kind: 'command_result', id: 'x', ok: true, result: {} });
  }

  eventsSince(cursor = 0): ReticleEvent[] {
    // Mirror RingBuffer.since: only events at/after the cursor (so the `since` floor is exercised).
    return this.events.filter((e) => e.t >= cursor);
  }

  onEvent(): () => void {
    return () => undefined;
  }
}

function ev(type: EventType, data: Record<string, unknown>, t = 1, ref?: string): ReticleEvent {
  return { t, type, sessionId: 's', data, ...(ref !== undefined ? { ref } : {}) };
}

describe('predicate engine', () => {
  it('matches a network predicate', async () => {
    const session = new FakeSession([
      ev(EventType.NET_REQUEST, { method: 'POST', url: '/api/order', status: 200 }),
    ]);
    const r = await evaluatePredicate(session, {
      kind: 'net',
      method: 'POST',
      urlContains: '/api/order',
      status: 200,
    });
    expect(r.pass).toBe(true);
  });

  it('net count: exactly-once passes on one match, fails on a double-submit', async () => {
    // The regression class: an action that should fire ONE request fires two (double-submit /
    // useEffect double-fire / a retry storm). Presence-only `net` passes both; `count` catches it.
    const once = new FakeSession([
      ev(EventType.NET_REQUEST, { method: 'POST', url: '/api/deploy', status: 200 }),
    ]);
    const okPredicate = {
      kind: 'net' as const,
      method: 'POST',
      urlContains: '/api/deploy',
      count: 1,
    };
    expect((await evaluatePredicate(once, okPredicate)).pass).toBe(true);

    const twice = new FakeSession([
      ev(EventType.NET_REQUEST, { method: 'POST', url: '/api/deploy', status: 200 }),
      ev(EventType.NET_REQUEST, { method: 'POST', url: '/api/deploy', status: 200 }),
    ]);
    const r = await evaluatePredicate(twice, okPredicate);
    expect(r.pass).toBe(false);
    expect(r.failureReason).toContain('2');
  });

  it('net count: an unmatched url is not counted (count scoped to the matcher)', async () => {
    const session = new FakeSession([
      ev(EventType.NET_REQUEST, { method: 'POST', url: '/api/deploy', status: 200 }),
      ev(EventType.NET_REQUEST, { method: 'GET', url: '/api/other', status: 200 }),
    ]);
    expect(
      (await evaluatePredicate(session, { kind: 'net', urlContains: '/api/deploy', count: 1 }))
        .pass,
    ).toBe(true);
  });

  it('net count: respects the since floor (a prior-action request is not counted)', async () => {
    const session = new FakeSession([
      ev(EventType.NET_REQUEST, { method: 'POST', url: '/api/deploy', status: 200 }, 10),
      ev(EventType.NET_REQUEST, { method: 'POST', url: '/api/deploy', status: 200 }, 30),
    ]);
    const predicate = { kind: 'net' as const, urlContains: '/api/deploy', count: 1 };
    expect((await evaluatePredicate(session, predicate)).pass).toBe(false); // both counted = 2
    expect((await evaluatePredicate(session, predicate, 20)).pass).toBe(true); // floor drops the stale one
  });

  it('since floor: a stale signal before the cursor does NOT fake a pass', async () => {
    // A signal fired at t=10 (e.g. during a PRIOR act). Asserting after a later act (floor=20)
    // must NOT match it — that is the stale-buffer false-pass the honesty fix closes.
    const session = new FakeSession([
      ev(EventType.SIGNAL, { name: 'validation', data: { score: 68 } }, 10),
    ]);
    const predicate = {
      kind: 'signal' as const,
      name: 'validation',
      dataMatches: { score: 68 },
    };
    expect((await evaluatePredicate(session, predicate)).pass).toBe(true); // no floor → legacy behavior
    expect((await evaluatePredicate(session, predicate, 20)).pass).toBe(false); // floor=20 → stale ignored
  });

  it('since floor: a fresh signal at/after the cursor still matches', async () => {
    const session = new FakeSession([
      ev(EventType.SIGNAL, { name: 'validation', data: { score: 78 } }, 25),
    ]);
    const predicate = {
      kind: 'signal' as const,
      name: 'validation',
      dataMatches: { score: 78 },
    };
    expect((await evaluatePredicate(session, predicate, 20)).pass).toBe(true);
  });

  it('console absent passes when no errors, fails when present', async () => {
    const clean = new FakeSession([ev(EventType.CONSOLE_LOG, { message: 'hi' })]);
    expect(
      (await evaluatePredicate(clean, { kind: 'console', level: 'error', absent: true })).pass,
    ).toBe(true);
    const dirty = new FakeSession([ev(EventType.CONSOLE_ERROR, { message: 'boom' })]);
    expect(
      (await evaluatePredicate(dirty, { kind: 'console', level: 'error', absent: true })).pass,
    ).toBe(false);
  });

  it('allOf requires every sub-predicate, anyOf requires one', async () => {
    const session = new FakeSession([
      ev(EventType.NET_REQUEST, { method: 'POST', url: '/api/order', status: 200 }),
      ev(EventType.ROUTE_CHANGE, { pathname: '/success' }),
    ]);
    const all = await evaluatePredicate(session, {
      kind: 'allOf',
      predicates: [
        { kind: 'net', urlContains: '/api/order', status: 200 },
        { kind: 'route', pathname: '/success' },
      ],
    });
    expect(all.pass).toBe(true);

    const allFail = await evaluatePredicate(session, {
      kind: 'allOf',
      predicates: [
        { kind: 'net', urlContains: '/api/order', status: 200 },
        { kind: 'route', pathname: '/nope' },
      ],
    });
    expect(allFail.pass).toBe(false);
    expect(allFail.failureReason).toBeTruthy();

    const any = await evaluatePredicate(session, {
      kind: 'anyOf',
      predicates: [
        { kind: 'route', pathname: '/nope' },
        { kind: 'route', pathname: '/success' },
      ],
    });
    expect(any.pass).toBe(true);
  });

  it('proven links narrow a green anyOf to the branch that actually held (honest grade)', async () => {
    // The OR greens because the app was CLEAN (no console errors), NOT because the signal fired.
    const session = new FakeSession([
      ev(EventType.NET_REQUEST, { method: 'POST', url: '/api/save', status: 200 }),
    ]);
    const anyOf: Predicate = {
      kind: 'anyOf',
      predicates: [
        { kind: 'signal', name: 'saved' }, // strong branch — this signal never fired
        { kind: 'console', level: 'error', absent: true }, // weak branch — holds (page is clean)
      ],
    };
    // It's green — but only via the clean-console branch.
    expect((await evaluatePredicate(session, anyOf)).pass).toBe(true);
    // Declared links still claim the signal consequence (every branch flattens in).
    expect(predicateToExpectedLinks(anyOf).some((l) => l.kind === 'signal')).toBe(true);
    // Proven links must NOT — the signal was one of the options and never happened. Grading off these
    // yields PRESENCE, so a minGrade:signal/net gate correctly refuses to trust this green.
    const proven = await provenExpectedLinks(session, anyOf);
    expect(proven.some((l) => l.kind === 'signal')).toBe(false);
  });

  it('proven links keep every allOf branch (all held for it to be green)', async () => {
    const session = new FakeSession([
      ev(EventType.SIGNAL, { name: 'saved' }),
      ev(EventType.NET_REQUEST, { method: 'POST', url: '/api/save', status: 200 }),
    ]);
    const allOf: Predicate = {
      kind: 'allOf',
      predicates: [
        { kind: 'signal', name: 'saved' },
        { kind: 'net', urlContains: '/api/save', status: 200 },
      ],
    };
    const proven = await provenExpectedLinks(session, allOf);
    expect(proven.some((l) => l.kind === 'signal')).toBe(true);
    expect(proven.some((l) => l.kind === 'net')).toBe(true);
  });

  it('not inverts', async () => {
    const session = new FakeSession([]);
    const r = await evaluatePredicate(session, {
      kind: 'not',
      predicate: { kind: 'console', level: 'error' },
    });
    expect(r.pass).toBe(true);
  });

  it('signal predicate matches name + dataMatches with wildcard', async () => {
    const session = new FakeSession([
      ev(EventType.SIGNAL, { name: 'webhook:received', data: { provider: 'stripe', id: 'pi_1' } }),
    ]);
    const r = await evaluatePredicate(session, {
      kind: 'signal',
      name: 'webhook:received',
      dataMatches: { provider: 'stripe', id: '*' },
    });
    expect(r.pass).toBe(true);
  });

  it('signal dataMatches supports operators and array contains', async () => {
    const session = new FakeSession([
      ev(EventType.SIGNAL, {
        name: 'chat:edit-applied',
        data: { count: 2, sections: ['hook', 'beat'] },
      }),
    ]);
    const pass = await evaluatePredicate(session, {
      kind: 'signal',
      name: 'chat:edit-applied',
      dataMatches: { count: { $gte: 1 }, sections: { $contains: 'hook' } },
    });
    expect(pass.pass).toBe(true);
    const fail = await evaluatePredicate(session, {
      kind: 'signal',
      name: 'chat:edit-applied',
      dataMatches: { count: { $gte: 5 } },
    });
    expect(fail.pass).toBe(false);
  });

  it('signal failure reports a near-miss with what actually fired', async () => {
    const session = new FakeSession([
      ev(EventType.SIGNAL, { name: 'section:added', data: { label: '' } }),
    ]);
    const r = await evaluatePredicate(session, {
      kind: 'signal',
      name: 'section:added',
      dataMatches: { label: 'Beat' },
    });
    expect(r.pass).toBe(false);
    expect(r.failureReason).toContain('fired');
    expect(r.evidence).toMatchObject({ nearMiss: [{ label: '' }] });
  });

  it('element predicate reports a near-miss when the name is wrong', async () => {
    const session = new FakeSession([], (query) => {
      // Only a button named "Cancel" exists.
      if (query.role === 'button' && query.name === undefined) {
        return {
          matched: true,
          count: 1,
          elements: [
            { ref: asRef('e1'), role: 'button', name: 'Cancel', states: [], visible: true },
          ],
        };
      }
      return { matched: false, count: 0, elements: [] };
    });
    const r = await evaluatePredicate(session, {
      kind: 'element',
      query: { role: 'button', name: 'Submit' },
    });
    expect(r.pass).toBe(false);
    expect(r.failureReason).toContain('Cancel');
  });

  it('diagnose=false skips the near-miss round-trips (interim-poll fast path)', async () => {
    // The wait loop passes diagnose=false on its interim polls — which read only `pass` — so the extra
    // role-only MATCH scan is not run. Count the MATCH commands to prove the second scan is skipped.
    let matchCalls = 0;
    const session = new FakeSession([], (query) => {
      matchCalls += 1;
      if (query.role === 'button' && query.name === undefined) {
        return {
          matched: true,
          count: 1,
          elements: [
            { ref: asRef('e1'), role: 'button', name: 'Cancel', states: [], visible: true },
          ],
        };
      }
      return { matched: false, count: 0, elements: [] };
    });
    const q = { kind: 'element', query: { role: 'button', name: 'Submit' } } as const;

    matchCalls = 0;
    const interim = await evaluatePredicate(session, q, 0, false);
    expect(interim.pass).toBe(false);
    expect(interim.assertion).toBe('element.present'); // plain fail, no near-miss
    expect(matchCalls).toBe(1); // ONE scan, not two

    matchCalls = 0;
    const full = await evaluatePredicate(session, q, 0, true);
    expect(full.assertion).toBe('element.role+name'); // full near-miss on the diagnostic path
    expect(matchCalls).toBe(2); // the extra role-only scan ran
  });

  it('turns a disconnected browser command into a failed wait verdict', async () => {
    const session: PredicateSession = {
      command: () => Promise.reject(new Error('session disconnected')),
      eventsSince: () => [],
      onEvent: () => () => undefined,
      elapsed: () => 0,
    };
    const result = await waitForPredicate(
      session,
      { kind: 'element', query: { text: 'Ready' } },
      100,
    );
    expect(result).toEqual({ pass: false, failureReason: 'session disconnected' });
  });

  it('propagates the STRUCTURED cause (observed/expected/assertion) on a timed-out wait', async () => {
    // The bug: on timeout, waitForPredicate rebuilt the verdict as { pass, evidence, failureReason },
    // discarding observed/expected/assertion that the near-miss oracle computed — the highest-value
    // localization signal, thrown away exactly on the failure path where it matters. A net.count
    // predicate that can never be satisfied must still return the structured near-miss.
    const session = new FakeSession(
      [ev(EventType.NET_REQUEST, { url: '/api/x', status: 200 }, 10)],
      undefined,
      100,
    );
    const result = await waitForPredicate(
      session,
      { kind: 'net', urlContains: '/api/', count: 99 },
      80,
    );
    expect(result.pass).toBe(false);
    expect(result.assertion).toBe('net.count');
    expect(result.observed).toContain('1 matching');
    expect(result.expected).toContain('99');
  });
});

describe('settled predicate (deterministic waiting)', () => {
  it('passes when there has been no network/DOM/animation activity since the floor', async () => {
    // Only a non-activity event (signal) in the buffer → nothing to settle → quiet.
    const session = new FakeSession([ev(EventType.SIGNAL, { name: 'x' }, 100)], undefined, 1000);
    const r = await evaluatePredicate(session, { kind: 'settled' }, 0);
    expect(r.pass).toBe(true);
  });

  it('fails while the last activity is more recent than quietMs', async () => {
    // Last network call at t=900, now=1000 → 100ms quiet < 200ms required.
    const session = new FakeSession(
      [ev(EventType.NET_REQUEST, { url: '/api/x', status: 200 }, 900)],
      undefined,
      1000,
    );
    const r = await evaluatePredicate(session, { kind: 'settled', quietMs: 200 }, 0);
    expect(r.pass).toBe(false);
    expect(r.failureReason).toContain('not settled');
    expect((r.evidence as { quietForMs: number }).quietForMs).toBe(100);
  });

  it('passes once the quiet gap reaches quietMs (structural DOM mutation long enough ago)', async () => {
    // Last DOM node added at t=500, now=1000 → 500ms quiet ≥ 200ms required.
    const session = new FakeSession([ev(EventType.DOM_ADDED, {}, 500)], undefined, 1000);
    const r = await evaluatePredicate(session, { kind: 'settled', quietMs: 200 }, 0);
    expect(r.pass).toBe(true);
    expect((r.evidence as { quietForMs: number }).quietForMs).toBe(500);
  });

  it('ignores ambient dom.text / animation frames so an animated page can still settle', async () => {
    // A count-up counter + spinner emit a text/anim event EVERY frame — here at t=995/998, only
    // 2-5ms ago. If these counted as activity the page would never go quiet; they must not.
    const session = new FakeSession(
      [
        ev(EventType.DOM_TEXT, { text: '42' }, 995),
        ev(EventType.ANIM_START, { name: 'spin' }, 996),
        ev(EventType.ANIM_END, { name: 'pulse' }, 998),
      ],
      undefined,
      1000,
    );
    const r = await evaluatePredicate(session, { kind: 'settled', quietMs: 200 }, 0);
    expect(r.pass).toBe(true); // settled despite very recent text/anim churn
  });

  it('excludes learned-ambient regions so a churning chat page still settles', async () => {
    // A real-time chat adds a DOM node every frame on ref "chat-log". Very recent (t=990, 10ms ago),
    // so without ambient learning the page would never go quiet. Once the ref is learned-ambient
    // (>= threshold unattributed churns), its structural churn must not hold `settled` open.
    const churn = [
      ev(EventType.DOM_ADDED, {}, 985, 'chat-log'),
      ev(EventType.DOM_ADDED, {}, 990, 'chat-log'),
    ];
    const notLearned = new FakeSession(churn, undefined, 1000);
    expect((await evaluatePredicate(notLearned, { kind: 'settled', quietMs: 200 }, 0)).pass).toBe(
      false,
    );
    const learned = new FakeSession(churn, undefined, 1000, { 'chat-log': 25 });
    const r = await evaluatePredicate(learned, { kind: 'settled', quietMs: 200 }, 0);
    expect(r.pass).toBe(true); // settled: chat-log churn is ambient, excluded from the settle oracle
  });

  it('a churning FEED (new element each tick, ref-less removals) still settles — the ambient-churn acceptance', async () => {
    // The real hostile shape: every appended row is a NEW element (fresh ref) and each removal has NO
    // ref, so ref-keyed exclusion never applied and settle stayed blocked forever. Keyed on the stable
    // region, the same stream is correctly treated as ambient.
    const churn: ReticleEvent[] = [];
    for (let i = 0; i < 6; i++) {
      churn.push({
        t: 980 + i,
        type: EventType.DOM_ADDED,
        sessionId: 's',
        ref: `e${String(800 + i)}`,
        data: { region: 'hostile-feed' },
      });
      churn.push({
        t: 981 + i,
        type: EventType.DOM_REMOVED,
        sessionId: 's',
        data: { region: 'hostile-feed' },
      });
    }
    const notLearned = new FakeSession(churn, undefined, 1000);
    expect((await evaluatePredicate(notLearned, { kind: 'settled', quietMs: 200 }, 0)).pass).toBe(
      false,
    );

    const learned = new FakeSession(churn, undefined, 1000, { 'hostile-feed': 40 });
    const r = await evaluatePredicate(learned, { kind: 'settled', quietMs: 200 }, 0);
    expect(r.pass).toBe(true); // settles despite a feed that never stops churning
  });

  it('keeps a non-ambient structural change even while an ambient region churns', async () => {
    // The chat churns (ambient) AND a real modal mounts on a different ref → still NOT settled.
    const session = new FakeSession(
      [
        ev(EventType.DOM_ADDED, {}, 990, 'chat-log'),
        ev(EventType.DOM_ADDED, {}, 992, 'modal-root'),
      ],
      undefined,
      1000,
      { 'chat-log': 25 },
    );
    const r = await evaluatePredicate(session, { kind: 'settled', quietMs: 200 }, 0);
    expect(r.pass).toBe(false); // modal-root is real work, holds settle open
  });

  it('respects the since floor: activity before the floor does not count', async () => {
    // A burst at t=100, then quiet. Asserting from floor=900 ignores the old burst → settled.
    const session = new FakeSession(
      [ev(EventType.DOM_ADDED, {}, 100), ev(EventType.ANIM_START, { name: 'spin' }, 100)],
      undefined,
      1000,
    );
    expect((await evaluatePredicate(session, { kind: 'settled', quietMs: 200 }, 900)).pass).toBe(
      true,
    );
    // From the start (floor 0) the burst is in scope but it is 900ms old → still settled.
    expect((await evaluatePredicate(session, { kind: 'settled', quietMs: 200 }, 0)).pass).toBe(
      true,
    );
  });

  it('composes inside allOf with a consequence predicate', async () => {
    const session = new FakeSession(
      [
        ev(EventType.SIGNAL, { name: 'deploy:shipped', data: {} }, 600),
        ev(EventType.NET_REQUEST, { url: '/api/deploy', status: 200 }, 600),
      ],
      undefined,
      1000,
    );
    const r = await evaluatePredicate(
      session,
      {
        kind: 'allOf',
        predicates: [
          { kind: 'signal', name: 'deploy:shipped' },
          { kind: 'settled', quietMs: 300 },
        ],
      },
      0,
    );
    expect(r.pass).toBe(true);
  });
});

/** Session whose STATE_READ returns a fixed `{ stores }` map — exercises the state predicate. */
class StateSession implements PredicateSession {
  constructor(private readonly stores: Record<string, unknown>) {}
  elapsed(): number {
    return 0;
  }
  command(name: string): Promise<CommandResult> {
    if (name === ReticleCommand.STATE_READ) {
      return Promise.resolve({
        kind: 'command_result',
        id: 'x',
        ok: true,
        result: { stores: this.stores, storeNames: Object.keys(this.stores) },
      });
    }
    return Promise.resolve({ kind: 'command_result', id: 'x', ok: true, result: {} });
  }
  eventsSince(): ReticleEvent[] {
    return [];
  }
  onEvent(): () => void {
    return () => undefined;
  }
}

describe('state predicate — assert store truth', () => {
  const app = {
    app: {
      deployments: [
        { id: 1, status: 'queued' },
        { id: 2, status: 'live' },
      ],
      count: 2,
    },
  };

  it('passes when a dot-path value equals the expected literal', async () => {
    const r = await evaluatePredicate(new StateSession(app), {
      kind: 'state',
      store: 'app',
      path: 'deployments.0.status',
      equals: 'queued',
    });
    expect(r.pass).toBe(true);
  });

  it('fails legibly when the displayed value lies about the store (desync)', async () => {
    // UI showed "live"; the store says "queued". Asserting equals:'live' must fail and name the truth.
    const r = await evaluatePredicate(new StateSession(app), {
      kind: 'state',
      store: 'app',
      path: 'deployments.0.status',
      equals: 'live',
    });
    expect(r.pass).toBe(false);
    expect(r.failureReason).toContain('queued');
  });

  it('supports operator patterns ($gte, $length)', async () => {
    const session = new StateSession(app);
    expect(
      (
        await evaluatePredicate(session, {
          kind: 'state',
          store: 'app',
          path: 'count',
          equals: { $gte: 2 },
        })
      ).pass,
    ).toBe(true);
    expect(
      (
        await evaluatePredicate(session, {
          kind: 'state',
          store: 'app',
          path: 'deployments',
          equals: { $length: 2 },
        })
      ).pass,
    ).toBe(true);
    expect(
      (
        await evaluatePredicate(session, {
          kind: 'state',
          store: 'app',
          path: 'count',
          equals: { $gte: 5 },
        })
      ).pass,
    ).toBe(false);
  });

  it('presence check passes when equals is omitted and the path resolves', async () => {
    const r = await evaluatePredicate(new StateSession(app), {
      kind: 'state',
      store: 'app',
      path: 'deployments.1.id',
    });
    expect(r.pass).toBe(true);
  });

  it('diagnoses a missing path with the keys that WERE available', async () => {
    const r = await evaluatePredicate(new StateSession(app), {
      kind: 'state',
      store: 'app',
      path: 'deployments.0.nope',
    });
    expect(r.pass).toBe(false);
    expect((r.evidence as { availableKeys?: string[] }).availableKeys).toContain('status');
  });

  it('defaults to the only store when none is named, but flags ambiguity otherwise', async () => {
    const single = await evaluatePredicate(new StateSession({ app: { v: 1 } }), {
      kind: 'state',
      path: 'v',
      equals: 1,
    });
    expect(single.pass).toBe(true);
    const ambiguous = await evaluatePredicate(new StateSession({ app: {}, cart: {} }), {
      kind: 'state',
      path: 'v',
    });
    expect(ambiguous.pass).toBe(false);
    expect(ambiguous.failureReason).toContain('multiple stores');
  });
});

/** Session that lets the test drive events and control when each command resolves, to prove the
 * waiter never fans out one round-trip per event. `command` counts calls (one STATE_READ per eval). */
class CoalesceSession implements PredicateSession {
  commandCount = 0;
  #listener: ((event: ReticleEvent) => void) | null = null;
  #pending: Array<(r: CommandResult) => void> = [];
  elapsed(): number {
    return 0;
  }
  eventsSince(): ReticleEvent[] {
    return [];
  }
  onEvent(listener: (event: ReticleEvent) => void): () => void {
    this.#listener = listener;
    return () => {
      this.#listener = null;
    };
  }
  emit(): void {
    this.#listener?.(ev(EventType.DOM_ADDED, {}));
  }
  command(): Promise<CommandResult> {
    this.commandCount += 1;
    return new Promise((res) => this.#pending.push(res));
  }
  resolveNext(result: unknown): void {
    const res = this.#pending.shift();
    if (res !== undefined) res({ kind: 'command_result', id: 'x', ok: true, result });
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('waitForPredicate coalescing', () => {
  it('a burst of events triggers at most one trailing re-check, not one per event', async () => {
    const session = new CoalesceSession();
    const p = waitForPredicate(
      session,
      { kind: 'state', store: 's', path: 'x', equals: 1 },
      10_000,
    );
    await flush();
    expect(session.commandCount).toBe(1); // initial evaluation, in flight

    for (let i = 0; i < 50; i += 1) session.emit();
    expect(session.commandCount).toBe(1); // 50 events blocked by the single-in-flight guard

    session.resolveNext({ stores: { s: { x: 0 } } }); // not-yet-true → exactly one trailing re-check
    await flush();
    expect(session.commandCount).toBe(2);

    session.resolveNext({ stores: { s: { x: 1 } } }); // now true → the wait resolves
    const r = await p;
    expect(r.pass).toBe(true);
  });
});

/**
 * A failure carries its cause as STRUCTURE, not only as prose.
 *
 * `failureReason` already said this in a sentence, and a sentence is the wrong shape for a consumer
 * that has to branch on it. Measured on three seeded bugs, an agent given observed/expected/assertion
 * alongside the source pointer used fewer tool calls than one given the pointer alone; the repair
 * literature separately has structured feedback beating rich natural-language feedback by 10.5pp,
 * with narrative finishing LAST. The prose stays for humans reading a log.
 *
 * Scope, stated so it cannot be mistaken for complete: the ELEMENT oracle carries these today. The
 * other classes (net, state, signal, console, route, settled, animation) still return prose only —
 * that is the remaining work, and the last test here names it rather than leaving it to memory.
 */
describe('element failures carry observed/expected/assertion', () => {
  const session = (elements: { states?: string[]; name?: string }[]): PredicateSession =>
    ({
      eventsSince: () => [],
      elapsed: () => 0,
      // Honours the state filter the way matchQuery does — without that, a state assertion "matches"
      // its own relaxed retry and the near-miss branch is never reached.
      command: (_cmd: string, args?: Record<string, unknown>) => {
        const want = typeof args?.['state'] === 'string' ? args['state'] : undefined;
        const all = elements.map((e, i) => ({
          ref: `e${String(i)}`,
          role: 'button',
          name: e.name ?? 'Save',
          states: e.states ?? ['present', 'visible', 'enabled'],
          visible: true,
        }));
        const hit = want === undefined ? all : all.filter((e) => e.states.includes(want));
        return Promise.resolve({
          kind: 'command_result',
          id: 'c',
          ok: true,
          result: { matched: hit.length > 0, count: hit.length, elements: hit },
        });
      },
    }) as unknown as PredicateSession;

  it('a missing element states what was looked for and what was seen', async () => {
    const r = await evaluatePredicate(session([]), {
      kind: 'element',
      query: { by: 'testid', value: 'new-deploy' },
    });
    expect(r.pass).toBe(false);
    expect(r.assertion).toBe('element.present');
    expect(r.observed).toContain('no matching element');
    expect(r.expected).toContain('new-deploy');
  });

  it('an element present in the wrong state reports the states it actually had', async () => {
    const r = await evaluatePredicate(session([{ states: ['present', 'hidden'] }]), {
      kind: 'element',
      query: { by: 'testid', value: 'new-deploy' },
      state: 'visible',
    });
    expect(r.pass).toBe(false);
    expect(r.assertion).toBe('element.state');
    expect(r.observed).toContain('hidden');
    expect(r.expected).toContain('visible');
  });

  it('an absent-assertion that finds something reports the count', async () => {
    const r = await evaluatePredicate(session([{}, {}]), {
      kind: 'element',
      query: { by: 'testid', value: 'toast' },
      absent: true,
    });
    expect(r.pass).toBe(false);
    expect(r.assertion).toBe('element.absent');
    expect(r.observed).toContain('2');
  });

  it('a PASSING assertion carries no failure structure — it is not noise on the green path', async () => {
    const r = await evaluatePredicate(session([{}]), {
      kind: 'element',
      query: { by: 'testid', value: 'new-deploy' },
    });
    expect(r.pass).toBe(true);
    expect(r.assertion).toBeUndefined();
    expect(r.observed).toBeUndefined();
  });

  /**
   * Every oracle now carries the structure, so this asserts COVERAGE rather than a limit.
   *
   * The test this replaces asserted the opposite — that non-element oracles had no `assertion` — and
   * went red the moment they grew one, which is precisely what it was written to do. A gap that
   * reports itself is the only kind that reliably gets closed; this repo lost four e2e specs and a
   * whole tool capability to gaps that did not.
   */
  const NON_ELEMENT: { label: string; predicate: Predicate; expected: string }[] = [
    {
      label: 'net',
      predicate: { kind: 'net', urlContains: '/api/x', count: 1 },
      expected: 'net.count',
    },
    {
      label: 'net presence',
      predicate: { kind: 'net', urlContains: '/api/x' },
      expected: 'net.present',
    },
    {
      label: 'route',
      predicate: { kind: 'route', pathname: '/deployments' },
      expected: 'route.changed',
    },
    {
      label: 'console',
      predicate: { kind: 'console', level: 'error' },
      expected: 'console.present',
    },
    {
      label: 'console absent',
      predicate: { kind: 'console', level: 'error', absent: true },
      expected: undefined as unknown as string,
    },
    {
      label: 'signal',
      predicate: { kind: 'signal', name: 'compose:generated' },
      expected: 'signal.absent',
    },
    {
      label: 'animation',
      predicate: { kind: 'animation', name: 'fade' },
      expected: 'animation.present',
    },
  ];

  for (const { label, predicate, expected } of NON_ELEMENT) {
    if (expected === undefined) continue; // absent-console PASSES on an empty window; nothing to assert
    it(`${label} failures carry an assertion kind`, async () => {
      const r = await evaluatePredicate(session([]), predicate);
      expect(r.pass).toBe(false);
      expect(r.assertion).toBe(expected);
      expect(r.observed).toBeDefined();
      expect(r.expected).toBeDefined();
    });
  }

  it('the assertion kind distinguishes failures that need different fixes', async () => {
    // "never fired" and "fired with the wrong payload" share one prose line but not one fix.
    const never = await evaluatePredicate(session([]), {
      kind: 'signal',
      name: 'compose:generated',
    });
    expect(never.assertion).toBe('signal.absent');
  });
});
