import { sanitizeForTransport } from '../security/serialization.js';

/** Store registry — lets the agent pull live framework/store state on demand. */
export type StoreGetter = () => unknown;
/** A store's subscribe method (Zustand/Redux shape): register a listener, get back an unsubscribe. */
export type StoreSubscribe = (listener: () => void) => () => void;

// Persist on a global so registrations survive HMR re-evaluation (see adapters.ts / feedback #7).
/** Notified when a SUBSCRIBABLE store is registered, so a late registration is still observed. */
export type StoreRegisteredListener = (
  entry: [string, StoreGetter, StoreSubscribe],
) => void;

const globalStore = globalThis as unknown as {
  __reticleStores?: Map<string, StoreGetter>;
  __reticleStoreSubs?: Map<string, StoreSubscribe>;
  __reticleStoreListeners?: Set<StoreRegisteredListener>;
};
const stores: Map<string, StoreGetter> = (globalStore.__reticleStores ??= new Map());
// Parallel map: stores that also provided a subscribe method, for automatic STATE_CHANGE diffs.
const subscribers: Map<string, StoreSubscribe> = (globalStore.__reticleStoreSubs ??= new Map());
const registrationListeners: Set<StoreRegisteredListener> = (globalStore.__reticleStoreListeners ??=
  new Set());

/**
 * Observe FUTURE subscribable-store registrations. The SDK installs its observers during connect, but
 * apps call registerStore afterwards — so enumerating once at install time subscribes to nothing and
 * STATE_CHANGE never fires. Observers use this to pick up stores registered after they installed.
 */
export function onStoreRegistered(listener: StoreRegisteredListener): () => void {
  registrationListeners.add(listener);
  return () => registrationListeners.delete(listener);
}

/** A Zustand/Redux-shaped store: exposes both current state and a subscribe. */
export interface StoreLike {
  getState: () => unknown;
  subscribe: StoreSubscribe;
}

function isStoreLike(source: StoreGetter | StoreLike): source is StoreLike {
  // Zustand's `create` returns a CALLABLE hook that also carries getState/subscribe, so a store can be
  // typeof 'function' as well as 'object'. What distinguishes it from a plain getter is those two members
  // — never the typeof. (Checking only for 'object' left every Zustand app on pull-only reads.)
  if (source === null) return false;
  if (typeof source !== 'object' && typeof source !== 'function') return false;
  const candidate = source as Partial<StoreLike>;
  return typeof candidate.getState === 'function' && typeof candidate.subscribe === 'function';
}

/**
 * App calls this once per store. PREFER passing the store itself — `registerStore('app', useApp)` —
 * which wires `getState` AND `subscribe`, so every mutation emits a STATE_CHANGE path diff automatically
 * (the before→after the causal summary reports). Passing a bare getter still works for back-compat, but
 * leaves the store on pull-only reads: no change events, and an empty `stateDiffs` in every act summary.
 */
export function registerStore(
  name: string,
  source: StoreGetter | StoreLike,
  subscribe?: StoreSubscribe,
): void {
  if (isStoreLike(source)) {
    const getter: StoreGetter = () => source.getState();
    const sub: StoreSubscribe = (listener) => source.subscribe(listener);
    stores.set(name, getter);
    subscribers.set(name, sub);
    notifyRegistered(name, getter, sub);
    return;
  }
  stores.set(name, source);
  if (subscribe !== undefined) {
    subscribers.set(name, subscribe);
    notifyRegistered(name, source, subscribe);
  }
}

function notifyRegistered(name: string, getter: StoreGetter, subscribe: StoreSubscribe): void {
  for (const listener of registrationListeners) {
    try {
      listener([name, getter, subscribe]);
    } catch {
      // a broken observer must never break the app's registerStore call
    }
  }
}

export function unregisterStore(name: string): void {
  stores.delete(name);
  subscribers.delete(name);
}

export function storeNames(): string[] {
  return [...stores.keys()];
}

/** Registered stores that exposed a subscribe method, as [name, getter, subscribe] tuples. */
export function subscribableStores(): Array<[string, StoreGetter, StoreSubscribe]> {
  const out: Array<[string, StoreGetter, StoreSubscribe]> = [];
  for (const [name, subscribe] of subscribers) {
    const getter = stores.get(name);
    if (getter !== undefined) out.push([name, getter, subscribe]);
  }
  return out;
}

/**
 * Read one store (by name) or all of them WITHOUT transport sanitization. For scoped reads that
 * select a sub-tree first, so a deep/large path (e.g. row 250 of a 500-row array) isn't truncated
 * before selection. Each getter is isolated: a throw becomes an error object.
 */
export function readStoresRaw(only?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, getter] of stores) {
    if (only !== undefined && name !== only) continue;
    try {
      out[name] = getter();
    } catch (error) {
      out[name] = { __error: error instanceof Error ? error.message : String(error) };
    }
  }
  return out;
}

/** Read one store (by name) or all of them, each capped for transport. */
export function readStores(only?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(readStoresRaw(only))) {
    out[name] = sanitizeForTransport(value);
  }
  return out;
}
