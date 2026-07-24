import type { StoreLike, StoreSubscribe } from './stores.js';

/**
 * Adapters that give non-`{getState, subscribe}` state libraries the shape `registerStore` wants.
 *
 * `registerStore` duck-types on `{getState, subscribe}`, which zustand and Redux satisfy natively — so
 * those two needed nothing and got support for free. Everything else was unserved, and the gap was not
 * evenly distributed: by weekly npm downloads TanStack Query (~64M) is larger than zustand (~46M) and
 * redux (~39M), and it holds the state most likely to be WRONG in a way nothing else can see.
 *
 * That last point is the reason this file exists rather than a docs page. A stale-cache bug — the UI
 * rendering data the server has since changed, a mutation that never invalidated its query, an
 * optimistic update that was never rolled back — fires NO network request. An outside-in tool watching
 * the network sees silence and calls it healthy; the DOM shows a plausible number. The only witness is
 * the cache itself, and until now Reticle could not read it either.
 *
 * Every adapter here is a pure function returning `{getState, subscribe}`. None of them import their
 * library — they take an already-constructed client/store/proxy and use structural types, so this file
 * adds no dependency and no bundle weight for an app that uses none of them.
 */

/** The minimum of TanStack Query's `QueryClient` that this adapter touches. */
interface QueryLike {
  queryKey: readonly unknown[];
  state: {
    status: string;
    fetchStatus?: string;
    dataUpdatedAt?: number;
    error?: { message?: string } | null;
    data?: unknown;
  };
  isStale?: () => boolean;
}
interface QueryCacheLike {
  getAll: () => QueryLike[];
  subscribe: (listener: () => void) => () => void;
}
interface QueryClientLike {
  getQueryCache: () => QueryCacheLike;
}

/** How a single cached query is projected into readable state. */
export interface QuerySnapshot {
  status: string;
  fetchStatus: string | undefined;
  isStale: boolean | undefined;
  dataUpdatedAt: number | undefined;
  error: string | null;
  data: unknown;
}

/**
 * Expose a TanStack Query cache as a Reticle store, keyed by query key.
 *
 * `isStale` / `fetchStatus` / `dataUpdatedAt` are carried deliberately: they are what let an agent
 * assert the stronger property — not merely "the value rendered is X" but "the cache the UI rendered
 * from was actually fresh". A screenshot cannot distinguish a correct number from a correct-looking
 * stale one, and neither can a network log when the request never fired.
 *
 * ```ts
 * registerStore('queries', tanstackQueryStore(queryClient));
 * ```
 */
export function tanstackQueryStore(client: QueryClientLike): StoreLike {
  // Resolved per call, not captured once. A QueryClient can be rebuilt — React Strict Mode double
  // effects, a provider remount, HMR — and an adapter holding the old cache would keep answering
  // from a store the app no longer reads, which is a stale-data bug inside the tool whose job is
  // catching stale data.
  return {
    getState: (): Record<string, QuerySnapshot> => {
      const out: Record<string, QuerySnapshot> = {};
      for (const query of client.getQueryCache().getAll()) {
        const key = query.queryKey.map((part) => String(part)).join('/');
        out[key] = {
          status: query.state.status,
          fetchStatus: query.state.fetchStatus,
          isStale: query.isStale?.(),
          dataUpdatedAt: query.state.dataUpdatedAt,
          error: query.state.error?.message ?? null,
          data: query.state.data,
        };
      }
      return out;
    },
    subscribe: (listener: () => void): (() => void) => client.getQueryCache().subscribe(listener),
  };
}

/** The minimum of a Jotai vanilla store this adapter touches. */
interface JotaiStoreLike {
  get: (atom: object) => unknown;
  sub: (atom: object, listener: () => void) => () => void;
}

/**
 * Expose a chosen set of Jotai atoms as one Reticle store.
 *
 * The atom map is not an ergonomic shortcut, it is forced by the design: Jotai has no registry of live
 * atoms to enumerate, so "the whole store" is not a thing that exists. Naming the atoms you care about
 * is the only way to snapshot them, and it doubles as a declaration of what matters.
 *
 * ```ts
 * registerStore('app', jotaiStore(getDefaultStore(), { cart: cartAtom, user: userAtom }));
 * ```
 */
export function jotaiStore(store: JotaiStoreLike, atoms: Record<string, object>): StoreLike {
  return {
    getState: (): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [name, atom] of Object.entries(atoms)) out[name] = store.get(atom);
      return out;
    },
    subscribe: (listener: () => void): (() => void) => {
      const unsubs = Object.values(atoms).map((atom) => store.sub(atom, listener));
      return () => {
        for (const unsub of unsubs) unsub();
      };
    },
  };
}

/** The minimum of an XState actor this adapter touches. */
interface ActorLike {
  getSnapshot: () => unknown;
  subscribe: (listener: () => void) => { unsubscribe: () => void };
}

/**
 * Expose an XState actor as a Reticle store. Its `subscribe` returns a subscription OBJECT rather than
 * an unsubscribe function, which is the single reason it does not satisfy `StoreLike` already.
 */
export function xstateStore(actor: ActorLike): StoreLike {
  return {
    getState: (): unknown => actor.getSnapshot(),
    subscribe: (listener: () => void): (() => void) => {
      const subscription = actor.subscribe(listener);
      return () => subscription.unsubscribe();
    },
  };
}

/**
 * Expose a Valtio proxy as a Reticle store. Valtio ships `snapshot`/`subscribe` as free functions
 * rather than methods, so the caller passes them in — importing them here would make every consumer
 * of this file depend on valtio.
 *
 * ```ts
 * import { snapshot, subscribe } from 'valtio/vanilla';
 * registerStore('app', valtioStore(state, snapshot, subscribe));
 * ```
 */
export function valtioStore<T extends object>(
  proxy: T,
  snapshot: (p: T) => unknown,
  subscribe: (p: T, listener: () => void) => () => void,
): StoreLike {
  return {
    getState: (): unknown => snapshot(proxy),
    subscribe: (listener: () => void): (() => void) => subscribe(proxy, listener),
  };
}

/**
 * Expose a MobX observable as a Reticle store. `toJS` and `reaction` are passed in for the same
 * dependency reason as valtio above.
 *
 * ```ts
 * import { reaction, toJS } from 'mobx';
 * registerStore('app', mobxStore(store, toJS, reaction));
 * ```
 */
export function mobxStore<T>(
  observable: T,
  toJS: (value: T) => unknown,
  reaction: (track: () => unknown, effect: () => void) => () => void,
): StoreLike {
  return {
    getState: (): unknown => toJS(observable),
    subscribe: (listener: () => void): (() => void) =>
      reaction(
        () => toJS(observable),
        () => listener(),
      ),
  };
}

/**
 * Build a store whose value is PUSHED in rather than pulled — for state that has no object to read.
 *
 * React Context and `useState`/`useReducer` keep their value inside the fiber tree; there is no store
 * instance and no subscription point outside React, so no adapter over a public API is possible. The
 * only way in is to invert the direction: the component holding the value tells Reticle when it
 * changes. `@reticlehq/react`'s `useReticleStore` hook is the ergonomic wrapper over this.
 *
 * Returns the store plus the `push` that updates it, so the caller owns the write side.
 */
export function pushStore(initial: unknown): { store: StoreLike; push: (value: unknown) => void } {
  let current = initial;
  const listeners = new Set<() => void>();
  const subscribe: StoreSubscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return {
    store: { getState: () => current, subscribe },
    push: (value: unknown): void => {
      current = value;
      for (const listener of listeners) listener();
    },
  };
}
