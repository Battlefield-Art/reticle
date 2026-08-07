/**
 * Which of the usual dev-server ports have something listening on them.
 *
 * The one fact that separates "the app is not running" from "the app is running and never dialled
 * us" — the difference between two completely different next actions for the agent, which the
 * no-session message could not tell apart before. See no-session-diagnosis.ts.
 *
 * Kept out of the hot path: `SessionManager.resolve` is synchronous and runs on every tool call, so
 * the probe refreshes in the background and the resolve path reads a cached answer. A stale answer
 * is fine here — it is a hint in an error message, not a decision.
 */

import * as net from 'node:net';
import { DEV_SERVER_PORTS } from '../cli-port.js';

/** Give up fast: a localhost connect either lands in a millisecond or nothing is there. */
const PROBE_TIMEOUT_MS = 150;

/** Resolve true when something accepts a TCP connection on this localhost port. */
export function isListening(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result: boolean): void => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/** Every candidate port with a listener, in ascending order. Never rejects. */
export async function probeDevServers(
  ports: readonly number[] = [...DEV_SERVER_PORTS],
  probe: (port: number) => Promise<boolean> = (p) => isListening(p),
): Promise<number[]> {
  const results = await Promise.all(ports.map((p) => probe(p).then((up) => (up ? p : null))));
  return results.filter((p): p is number => p !== null).sort((a, b) => a - b);
}
