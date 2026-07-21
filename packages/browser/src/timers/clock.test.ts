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

  it('does NOT resume an interval — an un-cancellable repeat is worse than a dropped one', async () => {
    // The app still holds the VIRTUAL id it was handed while frozen. Re-arming natively returns a
    // different id, so the app's own clearInterval(id) could never stop the callback — and since both
    // id spaces start at 1, that stale clearInterval might cancel an unrelated live timer instead.
    // My first version did re-arm, and this very test masked it: it cleaned up with the virtual id, so
    // the interval kept firing for the rest of the worker while the assertion still passed.
    freezeClock();
    let ticks = 0;
    const id = window.setInterval(() => {
      ticks += 1;
    }, 5);
    resetClock();
    clearInterval(id); // the app's own cleanup, using the id it was given
    await new Promise((r) => setTimeout(r, 40));
    expect(ticks).toBe(0);
  });
});
