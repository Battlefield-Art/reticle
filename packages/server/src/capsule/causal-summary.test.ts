import { describe, expect, it } from 'vitest';
import { EventType, PerfMetric, type ReticleEvent } from '@reticlehq/core';
import { causalSummary } from './causal-summary.js';

let seq = 0;
function e(type: EventType, data: Record<string, unknown>): ReticleEvent {
  seq += 1;
  return { t: seq, seq, type, sessionId: 'demo', data };
}

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

  it('reports state/storage as before→after DIFFS (from the events old/new), not just names', () => {
    const summary = causalSummary([
      e(EventType.STATE_CHANGE, { name: 'cart.count', path: 'cart.count', old: 0, new: 1 }),
      e(EventType.STORAGE_CHANGE, { area: 'local', key: 'token', old: 'a', new: 'b' }),
    ]);
    expect(summary.stateDiffs).toEqual([{ path: 'cart.count', from: 0, to: 1 }]);
    expect(summary.storageDiffs).toEqual([{ key: 'token', from: 'a', to: 'b' }]);
    // The lean name lists stay for the compact index.
    expect(summary.statePathsChanged).toEqual(['cart.count']);
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
    const summary = causalSummary([e(EventType.NET_REQUEST, { method: 'GET', url: '/api/ok', status: 200, ok: true })]);
    expect(summary.net).toEqual({ total: 1, errors: 0 });
    expect(summary.route).toBeUndefined();
    expect(summary.layoutShift).toBeUndefined();
    expect(summary.signals).toEqual([]);
  });
});
