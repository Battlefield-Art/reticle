import { describe, expect, it } from 'vitest';
import { EventType, type ReticleEvent } from '@reticlehq/core';
import { firstDivergence, type ExpectedLink } from './divergence.js';

let seq = 0;
function e(type: EventType, data: Record<string, unknown>): ReticleEvent {
  seq += 1;
  return { t: seq, seq, type, sessionId: 'demo', data };
}

describe('firstDivergence', () => {
  it('returns null when the whole declared chain held', () => {
    const expected: ExpectedLink[] = [
      { kind: 'net', urlContains: '/api/order', status: 200 },
      { kind: 'signal', name: 'order:placed' },
    ];
    const observed = [
      e(EventType.NET_REQUEST, { url: 'http://x/api/order', status: 200 }),
      e(EventType.SIGNAL, { name: 'order:placed' }),
    ];
    expect(firstDivergence(expected, observed)).toBeNull();
  });

  it('names the first failing link — a hidden-500 (request fired but 500, not 200)', () => {
    const expected: ExpectedLink[] = [
      { kind: 'net', urlContains: '/api/order', status: 200 },
      { kind: 'signal', name: 'order:placed' },
    ];
    const observed = [e(EventType.NET_REQUEST, { url: 'http://x/api/order', status: 500 })];
    const divergence = firstDivergence(expected, observed);
    expect(divergence?.expected).toEqual({ kind: 'net', urlContains: '/api/order', status: 200 });
    expect(divergence?.observed).toContain('500');
    expect(divergence?.observed).toContain('expected 200');
  });

  it('names a hung-request (no request reached the endpoint at all)', () => {
    const expected: ExpectedLink[] = [{ kind: 'net', urlContains: '/api/order', status: 200 }];
    const divergence = firstDivergence(expected, []);
    expect(divergence?.observed).toContain('no request to /api/order');
  });

  it('stops at the FIRST divergence, not a later one', () => {
    const expected: ExpectedLink[] = [
      { kind: 'signal', name: 'validated' }, // fails first
      { kind: 'signal', name: 'order:placed' },
    ];
    const divergence = firstDivergence(expected, []);
    expect(divergence?.expected).toEqual({ kind: 'signal', name: 'validated' });
  });
});
