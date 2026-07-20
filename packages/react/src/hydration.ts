/**
 * React hydration detection — a science-backed differentiator. The published literature says no agent
 * framework can detect hydration completion from OUTSIDE the page: pre-hydration clicks are silent no-ops,
 * and only an in-app SDK knows when handlers attached. React's FIRST commit (via the DevTools commit hook)
 * is the hydration/initial-mount boundary — so the first commit is "handlers attached". We emit a
 * `reticle:hydration-complete` signal exactly once, letting the agent wait for interactivity instead of
 * clicking into the void. Pure tracker; the commit hook drives it, the SDK emits the signal.
 */

/** The signal fired once React has committed its first render (handlers attached). */
export const HYDRATION_COMPLETE_SIGNAL = 'reticle:hydration-complete';

export interface HydrationTracker {
  /** Call on every React commit; fires `onHydrated` exactly once, on the first. */
  onCommit(): void;
  isHydrated(): boolean;
}

export function createHydrationTracker(onHydrated: () => void): HydrationTracker {
  let hydrated = false;
  return {
    onCommit(): void {
      if (hydrated) return;
      hydrated = true;
      onHydrated();
    },
    isHydrated: (): boolean => hydrated,
  };
}
