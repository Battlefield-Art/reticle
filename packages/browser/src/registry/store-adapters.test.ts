import { describe, expect, it, vi } from 'vitest';
import {
  tanstackQueryStore,
  jotaiStore,
  xstateStore,
  valtioStore,
  mobxStore,
  pushStore,
} from './store-adapters.js';

/** A fake matching the shape of TanStack Query's cache surface (getAll + subscribe). */
function fakeQueryClient(queries: unknown[]) {
  const listeners = new Set<() => void>();
  return {
    client: {
      getQueryCache: () => ({
        getAll: () => queries as never,
        subscribe: (l: () => void) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      }),
    },
    emit: () => {
      for (const l of listeners) l();
    },
    listenerCount: () => listeners.size,
  };
}

describe('tanstackQueryStore', () => {
  const query = {
    queryKey: ['deployments', 42],
    state: {
      status: 'success',
      fetchStatus: 'idle',
      dataUpdatedAt: 1700,
      error: null,
      data: { name: 'api' },
    },
    isStale: () => true,
  };

  it('keys each query by its joined query key', () => {
    const { client } = fakeQueryClient([query]);
    const state = tanstackQueryStore(client).getState() as Record<string, unknown>;
    expect(Object.keys(state)).toEqual(['deployments/42']);
  });

  it('carries freshness, not just the value — the whole point of reading the cache', () => {
    // A stale-cache bug renders a plausible number and fires NO request. Only isStale/fetchStatus/
    // dataUpdatedAt let an agent assert the UI read from FRESH data rather than merely correct-looking
    // data, which is the assertion neither a screenshot nor a network log can make.
    const { client } = fakeQueryClient([query]);
    const state = tanstackQueryStore(client).getState() as Record<string, Record<string, unknown>>;
    expect(state['deployments/42']).toMatchObject({
      status: 'success',
      fetchStatus: 'idle',
      isStale: true,
      dataUpdatedAt: 1700,
      error: null,
      data: { name: 'api' },
    });
  });

  it('flattens an error to its message so the payload stays serializable', () => {
    const failing = {
      queryKey: ['x'],
      state: { status: 'error', error: { message: 'boom' } },
      isStale: () => false,
    };
    const { client } = fakeQueryClient([failing]);
    const state = tanstackQueryStore(client).getState() as Record<string, Record<string, unknown>>;
    expect(state['x']?.['error']).toBe('boom');
  });

  it('subscribes to the cache and unsubscribes cleanly', () => {
    const { client, emit, listenerCount } = fakeQueryClient([query]);
    const listener = vi.fn();
    const unsub = tanstackQueryStore(client).subscribe(listener);
    emit();
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    expect(listenerCount()).toBe(0);
    emit();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('follows a REBUILT QueryClient instead of answering from the old cache', () => {
    // Strict Mode double effects, a provider remount and HMR all rebuild the client. An adapter that
    // captured the cache once would keep serving a store the app no longer reads — a stale-data bug
    // inside the tool whose entire purpose is catching stale data.
    let current = fakeQueryClient([query]).client.getQueryCache();
    const client = { getQueryCache: () => current };
    expect(Object.keys(tanstackQueryStore(client).getState() as object)).toEqual([
      'deployments/42',
    ]);

    const replacement = {
      queryKey: ['users'],
      state: { status: 'success', data: [] },
      isStale: () => false,
    };
    current = fakeQueryClient([replacement]).client.getQueryCache();
    expect(Object.keys(tanstackQueryStore(client).getState() as object)).toEqual(['users']);
  });

  it('an empty cache reads as an empty object, never undefined', () => {
    const { client } = fakeQueryClient([]);
    expect(tanstackQueryStore(client).getState()).toEqual({});
  });
});

describe('jotaiStore', () => {
  function fakeJotai() {
    const values = new Map<object, unknown>();
    const subs = new Map<object, Set<() => void>>();
    return {
      store: {
        get: (atom: object) => values.get(atom),
        sub: (atom: object, l: () => void) => {
          const set = subs.get(atom) ?? new Set();
          set.add(l);
          subs.set(atom, set);
          return () => set.delete(l);
        },
      },
      set: (atom: object, v: unknown) => values.set(atom, v),
      emit: (atom: object) => {
        for (const l of subs.get(atom) ?? []) l();
      },
      subCount: (atom: object) => (subs.get(atom) ?? new Set()).size,
    };
  }

  it('reads every named atom into one object', () => {
    const jotai = fakeJotai();
    const cart = {},
      user = {};
    jotai.set(cart, ['apple']);
    jotai.set(user, { id: 1 });
    const state = jotaiStore(jotai.store, { cart, user }).getState();
    expect(state).toEqual({ cart: ['apple'], user: { id: 1 } });
  });

  it('one listener fires for a change to ANY named atom', () => {
    const jotai = fakeJotai();
    const a = {},
      b = {};
    const listener = vi.fn();
    jotaiStore(jotai.store, { a, b }).subscribe(listener);
    jotai.emit(a);
    jotai.emit(b);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe detaches from every atom, not just the first', () => {
    const jotai = fakeJotai();
    const a = {},
      b = {};
    const unsub = jotaiStore(jotai.store, { a, b }).subscribe(vi.fn());
    unsub();
    expect(jotai.subCount(a)).toBe(0);
    expect(jotai.subCount(b)).toBe(0);
  });
});

describe('xstateStore', () => {
  it('adapts a subscription OBJECT into an unsubscribe function', () => {
    const unsubscribe = vi.fn();
    const actor = {
      getSnapshot: () => ({ value: 'idle' }),
      subscribe: () => ({ unsubscribe }),
    };
    const store = xstateStore(actor);
    expect(store.getState()).toEqual({ value: 'idle' });
    store.subscribe(vi.fn())();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('valtioStore', () => {
  it('snapshots through the passed-in functions rather than importing valtio', () => {
    const proxy = { count: 1 };
    const unsub = vi.fn();
    const store = valtioStore(
      proxy,
      (p) => ({ ...p }),
      () => unsub,
    );
    expect(store.getState()).toEqual({ count: 1 });
    expect(store.subscribe(vi.fn())).toBe(unsub);
  });
});

describe('mobxStore', () => {
  it('reads through toJS and subscribes through reaction', () => {
    const observable = { total: 5 };
    const dispose = vi.fn();
    const reaction = vi.fn(() => dispose);
    const store = mobxStore(observable, (v) => ({ ...v }), reaction);
    expect(store.getState()).toEqual({ total: 5 });
    expect(store.subscribe(vi.fn())).toBe(dispose);
    expect(reaction).toHaveBeenCalledTimes(1);
  });
});

describe('pushStore (React Context / useState — no readable store exists)', () => {
  it('reads the latest pushed value', () => {
    const { store, push } = pushStore({ n: 0 });
    push({ n: 7 });
    expect(store.getState()).toEqual({ n: 7 });
  });

  it('notifies subscribers on every push, so STATE_CHANGE diffs fire', () => {
    const { store, push } = pushStore(null);
    const listener = vi.fn();
    store.subscribe(listener);
    push(1);
    push(2);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops notifications', () => {
    const { store, push } = pushStore(null);
    const listener = vi.fn();
    store.subscribe(listener)();
    push(1);
    expect(listener).not.toHaveBeenCalled();
  });
});
