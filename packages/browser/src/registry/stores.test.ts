import { describe, it, expect } from 'vitest';
import {
  registerStore,
  unregisterStore,
  storeNames,
  readStores,
  subscribableStores,
} from './stores.js';

describe('store registry — passing the STORE auto-wires change diffs', () => {
  it('accepts a Zustand/Redux-shaped store and wires BOTH getState and subscribe', () => {
    // The dormant-feature fix: registerStore('app', useApp) must make STATE_CHANGE automatic. Passing
    // only a getter (the old form) leaves the app on pull-only reads, which is what shipped before.
    let listener: (() => void) | undefined;
    const store = {
      getState: () => ({ count: 1 }),
      subscribe: (fn: () => void) => {
        listener = fn;
        return () => (listener = undefined);
      },
    };
    registerStore('ws_store', store);
    expect(readStores('ws_store')).toEqual({ ws_store: { count: 1 } });
    const subs = subscribableStores().filter(([n]) => n === 'ws_store');
    expect(subs).toHaveLength(1); // ← auto-subscribed, no 3rd argument needed
    subs[0]?.[2](() => undefined);
    expect(listener).toBeDefined(); // the store's own subscribe was used
    unregisterStore('ws_store');
  });

  it('accepts a CALLABLE Zustand-style hook (function carrying getState/subscribe)', () => {
    // Regression: Zustand's create() returns a callable hook, so a real store is typeof 'function'.
    // An object-only guard silently fell through to the getter path and left STATE_CHANGE dormant —
    // caught only by driving a live app, never by an object-shaped fixture.
    let subscribed = false;
    const useApp = Object.assign(() => ({ count: 0 }), {
      getState: () => ({ count: 7 }),
      subscribe: (_fn: () => void) => {
        subscribed = true;
        return () => undefined;
      },
    });
    registerStore('ws_zustand', useApp);
    expect(readStores('ws_zustand')).toEqual({ ws_zustand: { count: 7 } });
    const subs = subscribableStores().filter(([n]) => n === 'ws_zustand');
    expect(subs).toHaveLength(1);
    subs[0]?.[2](() => undefined);
    expect(subscribed).toBe(true);
    unregisterStore('ws_zustand');
  });

  it('a plain getter still registers (back-compat) but is NOT auto-subscribed', () => {
    registerStore('ws_getter', () => ({ count: 1 }));
    expect(readStores('ws_getter')).toEqual({ ws_getter: { count: 1 } });
    expect(subscribableStores().filter(([n]) => n === 'ws_getter')).toHaveLength(0);
    unregisterStore('ws_getter');
  });
});

describe('store registry', () => {
  it('registers a store and reads it back', () => {
    registerStore('ws_a', () => ({ items: 3 }));
    expect(readStores()).toMatchObject({ ws_a: { items: 3 } });
    expect(storeNames()).toContain('ws_a');
    unregisterStore('ws_a');
  });

  it('filters to a single store by name; unknown name yields empty', () => {
    registerStore('ws_b', () => 1);
    registerStore('ws_c', () => 2);
    expect(readStores('ws_b')).toEqual({ ws_b: 1 });
    expect(readStores('nope')).toEqual({});
    unregisterStore('ws_b');
    unregisterStore('ws_c');
  });

  it('isolates a throwing getter as an __error; other stores still read', () => {
    registerStore('ws_bad', () => {
      throw new Error('boom');
    });
    registerStore('ws_ok', () => 42);
    const out = readStores();
    expect(out['ws_bad']).toEqual({ __error: 'boom' });
    expect(out['ws_ok']).toBe(42);
    unregisterStore('ws_bad');
    unregisterStore('ws_ok');
  });

  it('returns redacted, JSON-safe state for secrets, BigInt, and cycles', () => {
    const state: Record<string, unknown> = { password: 'secret', count: 2n };
    state['self'] = state;
    registerStore('ws_safe', () => state);
    const out = readStores('ws_safe');
    expect(out['ws_safe']).toEqual({
      password: '[REDACTED]',
      count: '2',
      self: '[CIRCULAR]',
    });
    expect(() => JSON.stringify(out)).not.toThrow();
    unregisterStore('ws_safe');
  });

  it('unregisterStore removes it', () => {
    registerStore('ws_d', () => 0);
    expect(storeNames()).toContain('ws_d');
    unregisterStore('ws_d');
    expect(storeNames()).not.toContain('ws_d');
  });
});
