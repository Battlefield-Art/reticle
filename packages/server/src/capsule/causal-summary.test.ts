import { describe, expect, it } from 'vitest';
import { EventType, PerfMetric, type ReticleEvent } from '@reticlehq/core';
import { causalSummary } from './causal-summary.js';

let seq = 0;
function e(type: EventType, data: Record<string, unknown>): ReticleEvent {
  seq += 1;
  return { t: seq, seq, type, sessionId: 'demo', data };
}

/**
 * A store that ends consistent can have been inconsistent on the way there, and a from→to pair
 * cannot say so. Measured on a real merchant dashboard: an account switch moved `accountId`
 * immediately and `payments` 160 ms later, so for 160 ms the header named one tenant while the rows
 * belonged to another. Both diffs were reported and nothing said they were 160 ms apart — and
 * waiting for the page to settle is, by construction, waiting for that evidence to disappear.
 */
describe('state diffs carry WHEN, so settling cannot hide a transient', () => {
  const at = (t: number, path: string, from: unknown, to: unknown): ReticleEvent => ({
    t,
    seq: t,
    type: EventType.STATE_CHANGE,
    sessionId: 'demo',
    data: { name: 'dashboard', path, old: from, value: to },
  });

  it('reports the gap between two paths of the same store', () => {
    const summary = causalSummary([
      at(12, 'accountId', 'acc_002', 'acc_001'),
      at(172, 'payments', '[old rows]', '[new rows]'),
    ]);
    expect(summary.stateDiffs.map((d) => [d.path, d.atMs])).toEqual([
      ['accountId', 12],
      ['payments', 172],
    ]);
    // The 160 ms in which the UI showed a MIXTURE — the whole signature of the defect.
    expect(summary.stateSettleMs).toBe(160);
  });

  it('omits the span when the store moved atomically', () => {
    // An app that updates every path in one tick pays nothing, so the field's PRESENCE is the signal.
    const summary = causalSummary([
      at(12, 'accountId', 'acc_002', 'acc_001'),
      at(12, 'payments', '[old]', '[new]'),
    ]);
    expect(summary.stateSettleMs).toBeUndefined();
  });

  it('omits the span for a single change — there is no interval to describe', () => {
    expect(causalSummary([at(12, 'accountId', 'a', 'b')]).stateSettleMs).toBeUndefined();
  });
});

describe('causalSummary', () => {
  it('composes counts, diffs, route, signals, and perf from the window', () => {
    const summary = causalSummary([
      e(EventType.NET_REQUEST, { method: 'GET', url: '/api/ok', status: 200, ok: true }),
      e(EventType.NET_REQUEST, { method: 'POST', url: '/api/order', status: 500, ok: false }),
      e(EventType.CONSOLE_ERROR, { message: 'boom' }),
      e(EventType.STATE_CHANGE, { name: 'cart.count' }),
      e(EventType.STORAGE_CHANGE, { area: 'local', key: 'cart' }),
      e(EventType.ROUTE_CHANGE, { pathname: '/thanks' }),
      e(EventType.SIGNAL, { name: 'order:placed' }),
      e(EventType.PERF, { metric: PerfMetric.CLS, value: 0.12, at: 1 }),
      e(EventType.PERF, { metric: PerfMetric.LONGTASK, value: 80, at: 1 }),
    ]);
    expect(summary.net).toEqual({ total: 2, errors: 1, headline: 'POST /api/order 500' });
    expect(summary.consoleErrors).toBe(1);
    expect(summary.statePathsChanged).toEqual(['cart.count']);
    expect(summary.storageKeysChanged).toEqual(['cart']);
    expect(summary.route).toBe('/thanks');
    expect(summary.signals).toEqual(['order:placed']);
    expect(summary.layoutShift).toBe(0.12);
    expect(summary.longTasks).toBe(1);
  });

  it('reports state/storage as before→after DIFFS, using the shape the observers really emit', () => {
    // STATE_CHANGE is emitted by the store observer as { name, path, value, old } — `value` is the AFTER
    // side. An earlier version of this test invented an {old,new} shape, so stateDiffs silently stayed
    // empty against a live app even though the unit test passed. Assert the REAL wire shape.
    const summary = causalSummary([
      e(EventType.STATE_CHANGE, { name: 'app', path: 'cart.count', old: 0, value: 1 }),
      e(EventType.STORAGE_CHANGE, { area: 'local', key: 'token', old: 'a', new: 'b' }),
    ]);
    expect(summary.stateDiffs).toMatchObject([{ path: 'cart.count', from: 0, to: 1 }]);
    expect(summary.storageDiffs).toEqual([{ key: 'token', from: 'a', to: 'b' }]);
    // The lean name lists stay for the compact index.
    expect(summary.statePathsChanged).toEqual(['app']); // the store name, as the observer emits it
    expect(summary.storageKeysChanged).toEqual(['token']);
  });

  it('caps long diff values so the per-act summary stays bounded', () => {
    const big = 'x'.repeat(500);
    const summary = causalSummary([
      e(EventType.STORAGE_CHANGE, { area: 'local', key: 'blob', old: '', new: big }),
    ]);
    const to = summary.storageDiffs[0]?.to;
    expect(typeof to).toBe('string');
    expect((to as string).length).toBeLessThanOrEqual(140);
  });

  it('omits optional fields on a quiet green act', () => {
    const summary = causalSummary([
      e(EventType.NET_REQUEST, { method: 'GET', url: '/api/ok', status: 200, ok: true }),
    ]);
    expect(summary.net).toEqual({ total: 1, errors: 0 });
    expect(summary.route).toBeUndefined();
    expect(summary.layoutShift).toBeUndefined();
    expect(summary.signals).toEqual([]);
  });
});
