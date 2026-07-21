import { describe, it, expect } from 'vitest';
import { EventType, type ReticleEvent } from '@reticlehq/core';
import {
  buildNetworkDetail,
  mergeNetworkDetail,
  attachNetworkDetail,
  type NetworkDetail,
  type ResponseLike,
} from './network-detail.js';

describe('buildNetworkDetail', () => {
  it('shapes an authoritative response into a NET_DETAIL payload, lower-casing header names', () => {
    const detail = buildNetworkDetail({
      url: 'https://api.example/order',
      method: 'POST',
      status: 201,
      headers: { 'Content-Type': 'application/json', 'X-Trace': 'abc' },
      resourceType: 'fetch',
    });
    expect(detail).toEqual({
      url: 'https://api.example/order',
      method: 'POST',
      status: 201,
      headers: { 'content-type': 'application/json', 'x-trace': 'abc' },
      resourceType: 'fetch',
    });
  });
});

describe('mergeNetworkDetail', () => {
  const req = (url: string, method: string): ReticleEvent => ({
    t: 1,
    type: EventType.NET_REQUEST,
    sessionId: 's',
    data: { url, method, status: 200 },
  });
  const detail = (url: string, method: string, headers: Record<string, string>): ReticleEvent => ({
    t: 2,
    type: EventType.NET_DETAIL,
    sessionId: 's',
    data: { url, method, status: 200, headers },
  });

  it('folds authoritative headers onto the matching in-page NET_REQUEST (by url+method)', () => {
    const merged = mergeNetworkDetail([
      req('/api/order', 'POST'),
      detail('/api/order', 'POST', { 'content-type': 'application/json' }),
    ]);
    const request = merged.find((e) => e.type === EventType.NET_REQUEST);
    expect(request?.data['headers']).toEqual({ 'content-type': 'application/json' });
    // The now-redundant NET_DETAIL is dropped from the merged view (its detail lives on the request).
    expect(merged.some((e) => e.type === EventType.NET_DETAIL)).toBe(false);
  });

  it('keeps an unmatched NET_DETAIL as its own event (never silently dropped)', () => {
    const merged = mergeNetworkDetail([detail('/api/other', 'GET', { etag: 'v1' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.type).toBe(EventType.NET_DETAIL);
  });

  it('does not clobber headers the in-page event already carries', () => {
    const withHeaders: ReticleEvent = {
      t: 1,
      type: EventType.NET_REQUEST,
      sessionId: 's',
      data: { url: '/x', method: 'GET', status: 200, headers: { 'x-app': '1' } },
    };
    const merged = mergeNetworkDetail([withHeaders, detail('/x', 'GET', { 'x-cdp': '2' })]);
    expect(merged.find((e) => e.type === EventType.NET_REQUEST)?.data['headers']).toEqual({
      'x-app': '1',
    });
  });
});

describe('attachNetworkDetail', () => {
  it('emits a NET_DETAIL for each response the page reports', async () => {
    const events: NetworkDetail[] = [];
    let handler: ((res: ResponseLike) => void) | undefined;
    const page = {
      on: (event: 'response', fn: (res: ResponseLike) => void) => {
        if (event === 'response') handler = fn;
      },
    };
    attachNetworkDetail(page, (data) => events.push(data));
    // Simulate a Playwright Response.
    handler?.({
      url: () => 'https://api/x',
      status: () => 200,
      headers: () => ({ 'content-type': 'text/html' }),
      request: () => ({ method: () => 'GET', resourceType: () => 'document' }),
    });
    await Promise.resolve(); // flush the async headers() → emit microtask
    await Promise.resolve();
    expect(events[0]).toMatchObject({ url: 'https://api/x', status: 200, method: 'GET' });
  });
});
