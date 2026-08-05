import { describe, expect, it } from 'vitest';
import { atom, createStore } from 'jotai';
import { proxy, snapshot, subscribe } from 'valtio/vanilla';
import { createActor, createMachine } from 'xstate';
import { makeAutoObservable, reaction, toJS } from 'mobx';
import { QueryClient } from '@tanstack/query-core';
import {
  jotaiStore,
  mobxStore,
  tanstackQueryStore,
  valtioStore,
  xstateStore,
} from './store-adapters.js';

/**
 * The adapters, against the REAL libraries.
 *
 * `store-adapters.test.ts` beside this file drives fakes shaped like each library's surface. Those
 * are not useless — breaking the adapter alone fails them, which was measured, not assumed. What a
 * fake structurally cannot catch is drift between the fake and the LIBRARY, because the fake IS the
 * belief under test: if Jotai renamed `sub`, or XState stopped returning a subscription object,
 * nothing in this repo would notice until a user reported an empty store and empty `stateDiffs` —
 * the same silent blindness that once hid a tenant-mismatch transient.
 *
 * Four of these five adapters were shipped, advertised in the README, and wired by no app anywhere,
 * so they had never once run against the package whose shape they assume. The libraries are
 * devDependencies; none is imported by shipped code, so this costs install time and nothing else.
 *
 * Two properties per adapter, because those are the two Reticle depends on: `getState()` reads the
 * LIVE value after a mutation, and `subscribe()` actually fires so a STATE_CHANGE is emitted.
 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe('store adapters against the libraries they claim to support', () => {
  it('jotai: reads the live atom and fires on set', async () => {
    const store = createStore();
    const count = atom(1);
    const adapter = jotaiStore(store, { count });
    let fired = 0;
    const unsub = adapter.subscribe(() => {
      fired += 1;
    });

    expect(adapter.getState()).toEqual({ count: 1 });
    store.set(count, 42);
    await settle();
    expect(adapter.getState()).toEqual({ count: 42 });
    expect(fired).toBeGreaterThan(0);

    // A real detach: teardown must leave the app as it found it.
    unsub();
    const afterUnsub = fired;
    store.set(count, 7);
    await settle();
    expect(fired).toBe(afterUnsub);
  });

  it('valtio: reads the live proxy and fires on a NESTED mutation', async () => {
    const state = proxy({ cart: { items: 0 } });
    const adapter = valtioStore(state, snapshot, subscribe);
    let fired = 0;
    const unsub = adapter.subscribe(() => {
      fired += 1;
    });

    state.cart.items = 3; // nested, because a shallow subscription would miss exactly this
    await settle();
    expect(adapter.getState()).toEqual({ cart: { items: 3 } });
    expect(fired).toBeGreaterThan(0);
    unsub();
  });

  it('xstate: reads the live snapshot and fires on a transition', async () => {
    const machine = createMachine({
      id: 'checkout',
      initial: 'idle',
      states: { idle: { on: { PAY: 'paying' } }, paying: {} },
    });
    const actor = createActor(machine).start();
    const adapter = xstateStore(actor);
    let fired = 0;
    const unsub = adapter.subscribe(() => {
      fired += 1;
    });

    expect((adapter.getState() as { value: string }).value).toBe('idle');
    actor.send({ type: 'PAY' });
    await settle();
    expect((adapter.getState() as { value: string }).value).toBe('paying');
    expect(fired).toBeGreaterThan(0);
    // XState hands back a subscription OBJECT, not an unsubscribe function — the one reason this
    // adapter exists at all. What it returns here must still be callable.
    expect(() => {
      unsub();
    }).not.toThrow();
  });

  it('mobx: reads the live observable and fires on a mutation', async () => {
    class Cart {
      items = 0;
      constructor() {
        makeAutoObservable(this);
      }
      add(): void {
        this.items += 1;
      }
    }
    const cart = new Cart();
    const adapter = mobxStore(cart, toJS, reaction);
    let fired = 0;
    const unsub = adapter.subscribe(() => {
      fired += 1;
    });

    cart.add();
    await settle();
    expect((adapter.getState() as { items: number }).items).toBe(1);
    expect(fired).toBeGreaterThan(0);
    unsub();
  });

  it('tanstack query: projects a real cache entry and fires on a cache change', async () => {
    const client = new QueryClient();
    const adapter = tanstackQueryStore(client);
    let fired = 0;
    const unsub = adapter.subscribe(() => {
      fired += 1;
    });

    await client.fetchQuery({ queryKey: ['user', 1], queryFn: () => Promise.resolve({ id: 1 }) });
    await settle();
    const state = adapter.getState() as Record<string, unknown>;
    // The projection is keyed by the serialized query key; assert on content, not on our own format.
    expect(JSON.stringify(state)).toContain('user');
    expect(fired).toBeGreaterThan(0);
    unsub();
  });
});
