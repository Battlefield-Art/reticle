import { useEffect, useRef, useState } from 'react';

/**
 * Timing fixture (§4.10) plus the dynamic-region trap (§4.11).
 *
 * Everything here is correct at any single instant — the right value renders, the right request is
 * made, nothing throws. The bugs live in HOW OFTEN and HOW SOON, which no screenshot and no
 * point-in-time DOM read can distinguish.
 */

export const SEARCH_INPUT_TESTID = 'timing-search';
export const SEARCH_RESULT_TESTID = 'timing-search-result';
export const RETRY_BUTTON_TESTID = 'timing-retry';
export const RETRY_STATUS_TESTID = 'timing-retry-status';
export const CLOCK_TESTID = 'timing-clock';
export const CLOCK_STABLE_TESTID = 'timing-clock-label';

const API = 'http://localhost:8787';

/**
 * Knobs the injector flips. Debounce delay and retry cap are the whole behaviour under test, so they
 * live in one mutable object rather than being baked into the component.
 */
export const TIMING_CONFIG = {
  /**
   * 0 disables debouncing entirely — one request per keystroke.
   *
   * 2000ms rather than a realistic ~300ms on purpose: each driven keystroke is an MCP round-trip,
   * which measured LONGER than 300ms, so every keystroke escaped a realistic window and a healthy
   * build issued one request per key — a false positive. The window has to outlast the driver, or the
   * fixture tests the harness's latency instead of the app's debouncing.
   */
  debounceMs: 2000,
  /** How many attempts a failing request is allowed IN TOTAL before giving up. */
  maxAttempts: 3,
};

/** Ticks often enough to be genuinely "live" — this is the region a diff check must not flag. */
const CLOCK_TICK_MS = 250;

export function TimingPanel(): React.ReactElement {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<number | null>(null);
  const [retryStatus, setRetryStatus] = useState('idle');
  const [now, setNow] = useState(() => Date.now());
  const timerRef = useRef<number | undefined>(undefined);

  // Debounced search. With debounceMs > 0 a burst of keystrokes produces ONE request; with it at 0
  // every keystroke fires. Identical results either way — only the request count differs.
  useEffect(() => {
    if (query.length === 0) return;
    const fire = (): void => {
      void fetch(`${API}/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((d: { matches?: number }) => setMatches(d.matches ?? 0))
        .catch(() => undefined);
    };
    if (TIMING_CONFIG.debounceMs === 0) {
      fire();
      return;
    }
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(fire, TIMING_CONFIG.debounceMs);
    return () => window.clearTimeout(timerRef.current);
  }, [query]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Bounded retry. The endpoint always fails, so the ONLY difference between correct and incorrect is
  // how many times we ask before giving up — a count over time, invisible to any single observation.
  const runRetries = async (): Promise<void> => {
    setRetryStatus('retrying');
    for (let attempt = 1; attempt <= TIMING_CONFIG.maxAttempts; attempt += 1) {
      try {
        const res = await fetch(`${API}/api/flaky`);
        if (res.ok) {
          setRetryStatus('recovered');
          return;
        }
      } catch {
        /* network error counts as a failed attempt */
      }
      await new Promise((r) => setTimeout(r, 60 * attempt)); // linear backoff, small for the bench
    }
    setRetryStatus('gave up');
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 8 }}>
      <div className="card-title">Timing</div>
      <input
        data-testid={SEARCH_INPUT_TESTID}
        className="field"
        placeholder="Search services…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div data-testid={SEARCH_RESULT_TESTID}>{matches === null ? 'no search yet' : `${String(matches)} matches`}</div>
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn"
          data-testid={RETRY_BUTTON_TESTID}
          onClick={() => void runRetries()}
        >
          Fetch with retry
        </button>
        <span data-testid={RETRY_STATUS_TESTID}>{retryStatus}</span>
      </div>
      {/*
        §4.11 trap. This region changes on its own several times a second on a HEALTHY build. A diff or
        text oracle that treats "it changed" as "something broke" would flag it forever. The label
        beside it never changes, and is what a stable-content check should key on.
      */}
      <div className="row" style={{ gap: 8 }}>
        <span data-testid={CLOCK_STABLE_TESTID}>Last refreshed</span>
        <span data-testid={CLOCK_TESTID} className="mono">
          {new Date(now).toISOString().slice(11, 23)}
        </span>
      </div>
    </div>
  );
}
