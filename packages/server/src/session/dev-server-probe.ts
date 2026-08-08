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
import { request } from 'node:http';
import { DEV_SERVER_PORTS } from '../cli-port.js';
import { looksLikeDevServer } from './looks-like-dev-server.js';

/** Give up fast: a localhost connect either lands in a millisecond or nothing is there. */
const PROBE_TIMEOUT_MS = 150;
/** An HTTP answer from localhost is fast too, but slower than a bare connect. */
const HTTP_PROBE_TIMEOUT_MS = 400;
/**
 * `localhost`, not `127.0.0.1` — so BOTH address families are tried.
 *
 * Measured: a plain `vite --port 4311` on this machine listens on `[::1]` only, and a probe pinned to
 * the IPv4 loopback cannot see it. The old TCP probe had the same blind spot, which meant the
 * diagnostic could miss the very dev server it exists to find while still reporting an unrelated
 * service that happens to bind both stacks (macOS AirPlay does).
 */
const PROBE_HOST = 'localhost';

/** Resolve true when something accepts a TCP connection on this localhost port. */
export function isListening(port: number, host = PROBE_HOST): Promise<boolean> {
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

/**
 * Does this port serve a DOCUMENT — i.e. is it a dev server rather than merely something listening?
 *
 * A bare TCP connect reported macOS ControlCenter (AirPlay Receiver, on by default on every Mac,
 * port 5000) as the user's dev server. See looks-like-dev-server for what it actually answers and
 * why "a socket accepted" is the wrong question.
 */
export function servesDocument(port: number, host = PROBE_HOST): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      { host, port, path: '/', method: 'GET', timeout: HTTP_PROBE_TIMEOUT_MS },
      (res) => {
        const answer = looksLikeDevServer(res.statusCode ?? 0, res.headers['content-type']);
        res.resume(); // drain, so the socket closes rather than lingering
        resolve(answer);
      },
    );
    req.once('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.once('error', () => resolve(false));
    req.end();
  });
}

/** Every candidate port serving a document, in ascending order. Never rejects. */
export async function probeDevServers(
  ports: readonly number[] = [...DEV_SERVER_PORTS],
  probe: (port: number) => Promise<boolean> = (p) => servesDocument(p),
): Promise<number[]> {
  const results = await Promise.all(ports.map((p) => probe(p).then((up) => (up ? p : null))));
  return results.filter((p): p is number => p !== null).sort((a, b) => a - b);
}
