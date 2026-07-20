import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventType } from '@reticlehq/core';
import { installStorage } from './storage.js';

interface Captured {
  type: EventType;
  data: Record<string, unknown>;
}

describe('installStorage — storage write events', () => {
  let events: Captured[];
  let teardown: () => void;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    events = [];
    teardown = installStorage((type, data) => events.push({ type, data }));
  });
  afterEach(() => {
    teardown();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('emits a STORAGE_CHANGE with old + new on setItem', () => {
    localStorage.setItem('cart', '2-items');
    localStorage.setItem('cart', '3-items');
    const changes = events.filter((e) => e.type === EventType.STORAGE_CHANGE);
    expect(changes).toHaveLength(2);
    expect(changes[1]?.data).toMatchObject({ area: 'local', key: 'cart', old: '2-items', new: '3-items' });
  });

  it('redacts the value of a credential-bearing key', () => {
    localStorage.setItem('auth_token', 'tok-secret-123');
    const change = events.find((e) => e.type === EventType.STORAGE_CHANGE);
    expect(change?.data['new']).toBe('[REDACTED]');
    expect(change?.data['new']).not.toContain('secret');
  });

  it('distinguishes session from local by the storage instance', () => {
    sessionStorage.setItem('view', 'overview');
    expect(events[0]?.data['area']).toBe('session');
  });

  it('emits a change with no `new` field on removeItem (signals removal)', () => {
    localStorage.setItem('k', 'v');
    events.length = 0;
    localStorage.removeItem('k');
    const change = events.find((e) => e.type === EventType.STORAGE_CHANGE);
    expect(change?.data).toMatchObject({ area: 'local', key: 'k', old: 'v' });
    expect(change?.data['new']).toBeUndefined();
  });

  it('stops emitting after teardown (fully reversible)', () => {
    teardown();
    events.length = 0;
    localStorage.setItem('after', 'x');
    expect(events).toHaveLength(0);
  });
});
