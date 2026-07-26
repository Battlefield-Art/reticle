/**
 * React render meter — counts commits the way React DevTools does, via the global
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` callback (one call per committed render). This is
 * the Reticle-only perf signal: Playwright/DevTools-MCP cannot observe a single React render, so a page
 * that is thrashing (committing many times a second) while the DOM stays visually identical — a
 * wasted-render storm — looks idle to them. Reticle sees the commit rate.
 *
 * Exposed as a registered store (`__reticle_renders`) so it reads through the normal `reticle_state` path —
 * no new wire surface. Total commits is the robust, version-tolerant signal; we deliberately do NOT
 * attribute per-component (React clears the per-fiber work flags during commit, before this fires, so
 * a post-commit walk can't reliably tell which component re-rendered without the profiler build).
 *
 * HOST-SAFE BY CONSTRUCTION: everything is wrapped in try/catch and React itself guards its calls to
 * the devtools hook in try/catch, so a fault here can never break the host app's rendering. If a real
 * React DevTools hook is already present we AUGMENT it (call the original too); otherwise we install a
 * complete minimal hook. MUST be installed before `react-dom` initializes (React reads the hook at
 * renderer-inject time) — import this as the first side-effect in the app entry, before React.
 */
import { RETICLE_RENDERS_STORE } from '@reticlehq/core';
import { registerStore } from '@reticlehq/browser';
import { HYDRATION_COMPLETE_SIGNAL, createHydrationTracker } from './hydration.js';
import { createCommitAggregator } from './commit-aggregator.js';

const HOOK_KEY = '__REACT_DEVTOOLS_GLOBAL_HOOK__';
const RENDER_STORE = RETICLE_RENDERS_STORE;

// Fire the hydration-complete signal (once, on the first commit) via the SDK instance if it is present.
// Structural access avoids importing the whole Reticle type into this tooling module.
const hydration = createHydrationTracker(() => {
  const instance = (globalThis as { __reticleInstance?: { signal?: (name: string) => void } })
    .__reticleInstance;
  instance?.signal?.(HYDRATION_COMPLETE_SIGNAL);
});

// Access the SDK instance structurally (avoids importing the whole Reticle type into this tooling module).
function reticleInstance(): { renderCommit?: (n: number) => void } | undefined {
  return (globalThis as { __reticleInstance?: { renderCommit?: (n: number) => void } })
    .__reticleInstance;
}

// Emit the render stream as aggregated RENDER_COMMIT events, throttled to one flush per frame so a commit
// storm is one event of magnitude N, never a per-render flood. requestAnimationFrame when available.
const commitStream = createCommitAggregator({
  schedule: (fn) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
    else setTimeout(fn, 16);
  },
  flush: (n) => reticleInstance()?.renderCommit?.(n),
});

/** One React commit: bump the counter, fire hydration on the first, and feed the throttled stream. */
function onReactCommit(): void {
  commits += 1;
  hydration.onCommit();
  commitStream.onCommit();
}

interface DevtoolsHook {
  supportsFiber?: boolean;
  renderers?: Map<number, unknown>;
  inject?: (renderer: unknown) => number;
  onScheduleFiberRoot?: (...args: unknown[]) => void;
  onCommitFiberRoot?: (...args: unknown[]) => void;
  onPostCommitFiberRoot?: (...args: unknown[]) => void;
  onCommitFiberUnmount?: (...args: unknown[]) => void;
}

let commits = 0;
let installed = false;

function noop(): void {
  /* React calls these; a no-op keeps a freshly-installed hook complete. */
}

/** The render stats surfaced via the `__reticle_renders` store (read with reticle_state). */
export interface RenderStats {
  /** Total React commits observed since install (monotonic; diff over a window for a rate). */
  commits: number;
}

export function getRenderStats(): RenderStats {
  return { commits };
}

/** Reset the commit counter — call before a measured window so the count is window-scoped. */
export function resetRenderMeter(): void {
  commits = 0;
}

/**
 * Install (or augment) the React commit hook + register the `__reticle_renders` store. Idempotent and
 * never throws. Call BEFORE react-dom loads.
 */
export function installRenderMeter(): void {
  if (installed) return;
  installed = true;
  try {
    const root = globalThis as unknown as Record<string, DevtoolsHook | undefined>;
    const existing = root[HOOK_KEY];
    if (existing === undefined) {
      root[HOOK_KEY] = {
        supportsFiber: true,
        renderers: new Map(),
        inject: () => 1,
        onScheduleFiberRoot: noop,
        onCommitFiberRoot: onReactCommit,
        onPostCommitFiberRoot: noop,
        onCommitFiberUnmount: noop,
      };
    } else {
      const original =
        typeof existing.onCommitFiberRoot === 'function'
          ? existing.onCommitFiberRoot.bind(existing)
          : undefined;
      existing.onCommitFiberRoot = (...args: unknown[]) => {
        onReactCommit();
        if (original !== undefined) {
          try {
            original(...args);
          } catch {
            /* a real DevTools hook faulting must not be our problem */
          }
        }
      };
    }
    registerStore(RENDER_STORE, () => getRenderStats());
  } catch {
    /* never break the host app */
  }
}
