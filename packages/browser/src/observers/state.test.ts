import { describe, it, expect, afterEach } from 'vitest';
import { EventType } from '@reticlehq/core';
import { diffState, installStoreState } from './state.js';
import { registerStore, unregisterStore } from '../registry/stores.js';

interface Captured {
  type: EventType;
  data: Record<string, unknown>;
}

/** Minimal Zustand/Redux-shaped store. */
function fakeStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: (): T => state,
    setState: (next: T): void => {
      state = next;
      for (const l of listeners) l();
    },
    subscribe: (l: () => void): (() => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

describe('diffState', () => {
  it('reports only the top-level keys whose value changed', () => {
    const changes = diffState({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 });
    expect(changes).toEqual([
      { path: 'b', old: 2, new: 3 },
      { path: 'c', old: undefined, new: 4 },
    ]);
  });

  it('treats a non-object state as a single path', () => {
    expect(diffState(1, 2)).toEqual([{ path: '', old: 1, new: 2 }]);
    expect(diffState(5, 5)).toEqual([]);
  });
});

describe('installStoreState', () => {
  afterEach(() => {
    unregisterStore('cart');
    unregisterStore('late');
  });

  it('observes a store registered AFTER install (the real app ordering)', () => {
    // Regression: the SDK installs observers during connect(), but apps call registerStore() after —
    // so enumerating once at install subscribed to nothing and STATE_CHANGE never fired in any real app.
    const events: Captured[] = [];
    const teardown = installStoreState((type, data) => events.push({ type, data }));

    const store = fakeStore<{ count: number }>({ count: 1 });
    registerStore('late', store); // registered AFTER installStoreState
    store.setState({ count: 2 });

    const changes = events.filter((e) => e.type === EventType.STATE_CHANGE);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.data).toMatchObject({ name: 'late', path: 'count', old: 1, value: 2 });

    teardown();
    store.setState({ count: 3 });
    expect(events.filter((e) => e.type === EventType.STATE_CHANGE)).toHaveLength(1);
  });

  it('emits STATE_CHANGE path diffs when a subscribed store mutates', () => {
    const store = fakeStore<{ count: number; token?: string }>({ count: 1 });
    registerStore('cart', store.getState, store.subscribe);
    const events: Captured[] = [];
    const teardown = installStoreState((type, data) => events.push({ type, data }));

    store.setState({ count: 2 });
    teardown();
    store.setState({ count: 3 }); // after teardown → ignored

    const changes = events.filter((e) => e.type === EventType.STATE_CHANGE);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.data).toMatchObject({ name: 'cart', path: 'count', old: 1, value: 2 });
  });

  it('redacts a credential-bearing changed path', () => {
    const store = fakeStore<Record<string, unknown>>({ token: 'old' });
    registerStore('cart', store.getState, store.subscribe);
    const events: Captured[] = [];
    const teardown = installStoreState((type, data) => events.push({ type, data }));

    store.setState({ token: 'new-secret' });
    teardown();

    const change = events.find((e) => e.type === EventType.STATE_CHANGE);
    expect(change?.data['value']).toBe('[REDACTED]');
    expect(JSON.stringify(change?.data)).not.toContain('secret');
  });
});
