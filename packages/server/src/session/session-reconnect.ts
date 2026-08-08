/**
 * Block until a reloaded page has re-announced itself under the same session id.
 *
 * A reload tears the SDK down. The id survives (see session-continuity), and the daemon replaces the
 * old Session with a new one when the page says HELLO again — so "is it back?" is exactly "does a
 * DIFFERENT object hold this id now?". Identity, not a flag: the returning page always constructs a
 * new Session, and nothing else can claim an id it already owns.
 *
 * Polls a live getter rather than subscribing, because there is no reconnect event to subscribe to
 * and inventing one for this would be a wire change for a two-second wait.
 */

export interface WaitForReconnectOptions {
  /** The session registered under this id right now, or undefined if none is. */
  current: () => object | undefined;
  /** The session object that was live when the reload was dispatched. */
  previous: object;
  /** Give up after this much elapsed time and let the caller report it honestly. */
  timeoutMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  pollMs?: number;
}

const DEFAULT_POLL_MS = 100;

/**
 * How long a reload is worth waiting for before answering "not confirmed".
 *
 * A production build is back in well under a second; a cold dev-server route rebuild is the slow
 * case this budget is sized for. It is a CEILING, not a delay — the common path returns on the first
 * or second poll.
 */
export const RELOAD_RECONNECT_TIMEOUT_MS = 5000;

export async function waitForReconnect(opts: WaitForReconnectOptions): Promise<boolean> {
  const poll = opts.pollMs ?? DEFAULT_POLL_MS;
  const start = opts.now();
  for (;;) {
    const live = opts.current();
    if (live !== undefined && live !== opts.previous) return true;
    if (opts.now() - start >= opts.timeoutMs) return false;
    await opts.sleep(poll);
  }
}
