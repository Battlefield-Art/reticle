import { describe, it, expect, afterEach } from 'vitest';
import { freezeClock, advanceClock, resetClock, isClockFrozen } from './clock.js';

afterEach(() => {
  resetClock();
});

describe('fake clock', () => {
  it('freezes setTimeout and fires it only when advanced past the delay', () => {
    freezeClock();
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 5000);
    advanceClock(4999);
    expect(fired).toBe(false);
    advanceClock(2);
    expect(fired).toBe(true);
  });

  it('freezes Date.now / performance.now and advances them deterministically', () => {
    freezeClock();
    const t0 = Date.now();
    advanceClock(1000);
    expect(Date.now() - t0).toBe(1000);
  });

  it('runs intervals each tick', () => {
    freezeClock();
    let n = 0;
    const id = setInterval(() => {
      n += 1;
    }, 100);
    advanceClock(350);
    expect(n).toBe(3);
    clearInterval(id);
  });

  it('reset restores real timers', () => {
    freezeClock();
    expect(isClockFrozen()).toBe(true);
    resetClock();
    expect(isClockFrozen()).toBe(false);
  });
});

/**
 * Restoring real timers is only half of un-freezing. The callbacks the app queued during the freeze
 * live in the virtual queue, and discarding them leaves the app broken in a NEW way — a toast that
 * never dismisses, a retry that never fires — while `Date.now()` and future timers look healthy, so
 * nothing points at the cause. This matters most on the path resetClock is actually called from: the
 * agent froze the clock, the bridge died, and nobody un-froze it deliberately.
 */
describe('resetClock hands back the work queued while frozen', () => {
  afterEach(() => {
    resetClock();
  });

  it('runs a timeout that was scheduled during the freeze', async () => {
    freezeClock();
    let fired = false;
    window.setTimeout(() => {
      fired = true;
    }, 5);
    resetClock(); // bridge lost — nothing will ever advance the virtual clock again
    await new Promise((r) => setTimeout(r, 40));
    expect(fired).toBe(true);
  });

  it('preserves the REMAINING delay rather than firing everything immediately', async () => {
    freezeClock();
    let fired = false;
    window.setTimeout(() => {
      fired = true;
    }, 10_000);
    resetClock();
    await new Promise((r) => setTimeout(r, 30));
    // A 10s timer must still be pending — re-arming must not collapse into "run it all now".
    expect(fired).toBe(false);
  });

  it('resumes an interval AND lets the app cancel it with the id it was given', async () => {
    // The handle is the whole difficulty: the app holds a VIRTUAL id, the re-arm produces a NATIVE one.
    // Two earlier attempts got this wrong — one re-armed without translation (uncancellable, and the
    // stale clear could kill an unrelated timer), the other dropped intervals entirely to dodge it
    // while re-arming timeouts, which has the identical hazard.
    freezeClock();
    let ticks = 0;
    const id = window.setInterval(() => {
      ticks += 1;
    }, 5);
    resetClock();
    await new Promise((r) => setTimeout(r, 30));
    expect(ticks).toBeGreaterThan(0); // it resumed
    const seen = ticks;
    clearInterval(id); // the app's own cleanup, with the id it was handed while frozen
    await new Promise((r) => setTimeout(r, 30));
    expect(ticks).toBe(seen); // and it actually stopped
  });

  it('lets the app cancel a re-armed TIMEOUT with its original id', async () => {
    // `const t = setTimeout(hide, 5000); return () => clearTimeout(t)` — the standard effect cleanup.
    freezeClock();
    let fired = false;
    const id = window.setTimeout(() => {
      fired = true;
    }, 10);
    resetClock();
    clearTimeout(id);
    await new Promise((r) => setTimeout(r, 40));
    expect(fired).toBe(false);
  });

  it('does not disturb a native timer that happens to share the virtual id space', async () => {
    // Both id spaces start at 1, so a naive re-arm made the app's clear cancel an unrelated timer.
    freezeClock();
    window.setTimeout(() => undefined, 10_000); // virtual id 1
    resetClock();
    let unrelated = false;
    const nativeId = setTimeout(() => {
      unrelated = true;
    }, 20);
    clearTimeout(1 as unknown as typeof nativeId); // stale virtual id from the frozen period
    await new Promise((r) => setTimeout(r, 50));
    expect(unrelated).toBe(true); // the unrelated timer must survive
    clearTimeout(nativeId);
  });
});
