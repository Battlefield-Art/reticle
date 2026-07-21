import { EventType, REDACTED_VALUE } from '@reticlehq/core';
import {
  subscribableStores,
  onStoreRegistered,
  type StoreGetter,
  type StoreSubscribe,
} from '../registry/stores.js';
import { isSensitiveKey, sanitizeForTransport } from '../security/serialization.js';
import type { Emit, Teardown } from './types.js';

interface StateChange {
  path: string;
  old: unknown;
  new: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Shallow top-level diff of two store states — the keys whose value changed. Immutable updates
 * (Zustand/Redux) replace the changed key's reference, so `Object.is` catches them. Pure; deep-nested
 * diffing behind an unchanged top-level reference is a v2 concern.
 */
export function diffState(prev: unknown, next: unknown): StateChange[] {
  if (!isRecord(prev) || !isRecord(next)) {
    return Object.is(prev, next) ? [] : [{ path: '', old: prev, new: next }];
  }
  const changes: StateChange[] = [];
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (!Object.is(prev[key], next[key])) changes.push({ path: key, old: prev[key], new: next[key] });
  }
  return changes;
}

/** Redact a changed value when its path is credential-bearing, else cap it for transport. */
function project(path: string, value: unknown): unknown {
  return isSensitiveKey(path) ? REDACTED_VALUE : sanitizeForTransport(value);
}

function safeRead(getter: StoreGetter): unknown {
  try {
    return getter();
  } catch {
    return undefined;
  }
}

/**
 * Subscribe to every registered store that exposed a subscribe method, emitting a STATE_CHANGE per
 * changed top-level path with {name, path, old, new} — automatic diffs, not pull-only readings. Stores
 * without a subscribe fall back to the pull path (reticle_state). Fully reversible.
 */
export function installStoreState(emit: Emit): Teardown {
  const unsubscribes: Array<() => void> = [];
  const seen = new Set<string>();
  const watch = ([name, getter, subscribe]: [string, StoreGetter, StoreSubscribe]): void => {
    if (seen.has(name)) return; // a re-registration (HMR) must not double-emit
    seen.add(name);
    let last = safeRead(getter);
    unsubscribes.push(
      subscribe(() => {
        const next = safeRead(getter);
        for (const change of diffState(last, next)) {
          emit(EventType.STATE_CHANGE, {
            name,
            path: change.path,
            value: project(change.path, change.new),
            old: project(change.path, change.old),
          });
        }
        last = next;
      }),
    );
  };
  // Stores already registered...
  for (const entry of subscribableStores()) watch(entry);
  // ...and any registered LATER. The SDK installs observers during connect(), but apps call
  // registerStore() after that, so without this the common case subscribes to nothing.
  unsubscribes.push(onStoreRegistered(watch));
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
