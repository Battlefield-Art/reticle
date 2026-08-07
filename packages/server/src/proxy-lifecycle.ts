/**
 * When the proxy may start a daemon — the rule that keeps an idle install from looping forever.
 *
 * Two changes collided to produce a real regression, and this is the seam that prevents it coming
 * back. A daemon may now shut itself down when it has served nothing and no browser ever connected
 * (see daemon-usefulness.ts). The proxy separately learned to respawn a dead daemon, because one
 * that crashed or was stopped used to take the agent's whole Reticle surface with it. Together they
 * loop: the daemon exits as useless, the proxy immediately brings back a daemon that is equally
 * useless, which exits, forever. Measured with a 4s grace: four processes in 200 seconds. At the
 * real 300s grace that is a new process every five minutes for the 74% of installs that never call a
 * tool, for as long as the editor is open.
 *
 * The rule that resolves it: a dropped stream is not demand. Reattach to a daemon that is already
 * there; otherwise go dormant and let the next thing the CLIENT asks for bring Reticle back.
 *
 * Extracted as pure functions because the decision used to live inside a closure where no test could
 * reach it — and a guard that re-implements the decision instead of calling it is insensitive to the
 * thing it claims to guard.
 */

/** What to do when the SSE stream drops. */
export const OnDrop = {
  /** A daemon is listening — reattach to it. */
  REATTACH: 'reattach',
  /** Nothing is listening. Do NOT spawn: wait to be needed. */
  DORMANT: 'dormant',
} as const;
export type OnDrop = (typeof OnDrop)[keyof typeof OnDrop];

/**
 * A stream drop only ever justifies reattaching, never spawning. This is the whole fix: the proxy
 * used to spawn here, which turned a daemon's own idle shutdown into a permanent respawn loop.
 */
export function onStreamDrop(daemonListening: boolean): OnDrop {
  return daemonListening ? OnDrop.REATTACH : OnDrop.DORMANT;
}

/** What to do with a client message. */
export const OnRequest = {
  /** Connected — post it straight through. */
  SEND: 'send',
  /** Reconnecting already; hold it until the endpoint arrives. */
  QUEUE: 'queue',
  /** Dormant: this is demand. Start a daemon, reattach, then flush. */
  WAKE: 'wake',
} as const;
export type OnRequest = (typeof OnRequest)[keyof typeof OnRequest];

/**
 * The client asking for something is the ONLY event that may start a daemon.
 *
 * `connected` means a session endpoint is in hand. When it is not, a dormant proxy wakes (spawning
 * if needed) and a merely-reconnecting one queues — the difference between "nothing is coming back
 * on its own" and "something already is".
 */
export function onClientRequest(connected: boolean, dormant: boolean): OnRequest {
  if (connected) return OnRequest.SEND;
  return dormant ? OnRequest.WAKE : OnRequest.QUEUE;
}
