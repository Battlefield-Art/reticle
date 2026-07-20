import { sanitizeForTransport } from '../security/serialization.js';

/** Store registry — lets the agent pull live framework/store state on demand. */
export type StoreGetter = () => unknown;
/** A store's subscribe method (Zustand/Redux shape): register a listener, get back an unsubscribe. */
export type StoreSubscribe = (listener: () => void) => () => void;

// Persist on a global so registrations survive HMR re-evaluation (see adapters.ts / feedback #7).
const globalStore = globalThis as unknown as {
  __reticleStores?: Map<string, StoreGetter>;
  __reticleStoreSubs?: Map<string, StoreSubscribe>;
};
const stores: Map<string, StoreGetter> = (globalStore.__reticleStores ??= new Map());
// Parallel map: stores that also provided a subscribe method, for automatic STATE_CHANGE diffs.
const subscribers: Map<string, StoreSubscribe> = (globalStore.__reticleStoreSubs ??= new Map());

/**
 * App calls this once per store: registerStore('workspace', () => useWorkspace.getState()). Pass the
 * optional `subscribe` (e.g. `useWorkspace.subscribe`) to get automatic STATE_CHANGE path diffs on
 * every mutation instead of pull-only reads.
 */
export function registerStore(name: string, getter: StoreGetter, subscribe?: StoreSubscribe): void {
  stores.set(name, getter);
  if (subscribe !== undefined) subscribers.set(name, subscribe);
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
