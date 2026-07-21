// Fake clock: patch the APP's setTimeout/setInterval/Date.now/performance.now so the agent
// can deterministically advance time (toasts, debounces, auto-dismiss, commit-on-blur).
// We do NOT patch requestAnimationFrame/microtasks/MessageChannel — React's scheduler relies
// on those, and freezing them would stall the page. Opt-in + reversible.

interface Task {
  id: number;
  time: number;
  cb: () => void;
  interval?: number | undefined;
}

interface Originals {
  setTimeout: typeof window.setTimeout;
  clearTimeout: typeof window.clearTimeout;
  setInterval: typeof window.setInterval;
  clearInterval: typeof window.clearInterval;
  dateNow: () => number;
}

let installed = false;
let virtualNow = 0;
let realBase = 0;
let seq = 1;
let tasks: Task[] = [];
let originals: Originals | null = null;

export function isClockFrozen(): boolean {
  return installed;
}

export function freezeClock(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  virtualNow = 0;
  realBase = Date.now();
  originals = {
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    setInterval: window.setInterval,
    clearInterval: window.clearInterval,
    dateNow: Date.now,
  };

  const schedule = (cb: () => void, delay: number, interval?: number): number => {
    const id = seq;
    seq += 1;
    tasks.push({ id, time: virtualNow + Math.max(0, delay), cb, interval });
    return id;
  };
  const cancel = (id: number): void => {
    tasks = tasks.filter((t) => t.id !== id);
  };

  window.setTimeout = ((cb: () => void, delay = 0) =>
    schedule(cb, delay)) as unknown as typeof window.setTimeout;
  window.clearTimeout = ((id: number) => cancel(id)) as unknown as typeof window.clearTimeout;
  window.setInterval = ((cb: () => void, delay = 0) =>
    schedule(cb, delay, Math.max(1, delay))) as unknown as typeof window.setInterval;
  window.clearInterval = ((id: number) => cancel(id)) as unknown as typeof window.clearInterval;
  // Note: we deliberately do NOT patch performance.now — React 19's scheduler uses it to
  // flush updates, and freezing it stalls re-renders. setTimeout/Date.now cover app timers.
  Date.now = () => realBase + virtualNow;
}

/** Run all timers due within the next `ms` of virtual time, in order. */
export function advanceClock(ms: number): void {
  if (!installed) return;
  const target = virtualNow + Math.max(0, ms);
  let guard = 0;
  for (;;) {
    guard += 1;
    if (guard > 100000) break;
    const due = tasks.filter((t) => t.time <= target).sort((a, b) => a.time - b.time);
    const next = due[0];
    if (next === undefined) break;
    tasks = tasks.filter((t) => t !== next);
    virtualNow = next.time;
    next.cb();
    if (next.interval !== undefined) {
      tasks.push({ ...next, id: seq++, time: virtualNow + next.interval });
    }
  }
  virtualNow = target;
}

/**
 * Restore the real timers AND hand back everything the app queued while frozen.
 *
 * The queue used to be discarded (`tasks = []`). Restoring the native functions is only half the job:
 * the callbacks the app scheduled during the freeze live in the virtual queue, and dropping them leaves
 * the app quietly broken in a new way — a toast that never dismisses, a retry that never fires, a
 * session-expiry check that never runs. `Date.now()` and future timers look healthy, so nothing points
 * at the cause. That matters most on the path this is called from: an agent freezes the clock, the
 * bridge dies, and the developer is left with an app that was never un-frozen deliberately.
 *
 * Pending one-shot timeouts are re-scheduled onto REAL timers with their remaining virtual delay, so a
 * 5s toast frozen 2s in still has ~3s to go. Intervals are deliberately NOT resumed — see below.
 */
export function resetClock(): void {
  if (!installed || originals === null) return;
  const { setTimeout: realSetTimeout } = originals;
  const pending = tasks;
  window.setTimeout = originals.setTimeout;
  window.clearTimeout = originals.clearTimeout;
  window.setInterval = originals.setInterval;
  window.clearInterval = originals.clearInterval;
  Date.now = originals.dateNow;
  const resumeFrom = virtualNow;
  originals = null;
  tasks = [];
  installed = false;
  virtualNow = 0;
  // Re-arm AFTER the natives are restored, so these schedule onto real time rather than back into the
  // queue we are draining.
  //
  // INTERVALS ARE NOT RE-ARMED. The app is still holding the VIRTUAL id it was given while frozen, and
  // a native re-arm returns a different id — so the app's own `clearInterval(id)` would no longer
  // cancel it and the callback would run forever. Worse, both id spaces start at 1, so that stale
  // clearInterval could cancel an unrelated live timer. A one-shot timeout has no such handle problem:
  // it fires once and is done, so losing it is a real behaviour change while re-arming it is safe.
  // Dropping a repeating timer is the lesser harm, and it is stated rather than silent.
  for (const task of pending) {
    if (task.interval !== undefined) continue;
    realSetTimeout(task.cb, Math.max(0, task.time - resumeFrom));
  }
}
