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

import { request } from 'node:http';
import { DEV_SERVER_PORTS } from '../cli/cli-port.js';
import { looksLikeDevServer } from './looks-like-dev-server.js';

/** Give up fast: an HTTP answer from localhost either lands quickly or nothing is there. */
const HTTP_PROBE_TIMEOUT_MS = 400;
/**
 * `localhost`, not `127.0.0.1` — so BOTH address families are tried.
 *
 * Measured: a plain `vite --port 4311` on this machine listens on `[::1]` only, and a probe pinned to
 * the IPv4 loopback cannot see it. The old TCP probe had the same blind spot, which meant the
 * diagnostic could miss the very dev server it exists to find while still reporting an unrelated
 * service that happens to bind both stacks (macOS AirPlay does).
 */
/**
 * Both loopback addresses, BY ADDRESS — never by the name `localhost`.
 *
 * A dev server started with `--host` binds the wildcards `0.0.0.0` and `[::]` rather than the
 * loopbacks, and a wildcard bind serves only the family it belongs to. Asking for `localhost` hands
 * the choice of family to the resolver: on Windows it prefers `::1`, so a `0.0.0.0` listener is
 * invisible and the scan reports "nothing is listening" about a dev server that is plainly running.
 * Reported from the field on exactly that setup.
 *
 * `[::1]` is also how a `[::]` bind is reached, and on most stacks a `[::]` bind additionally
 * accepts v4-mapped connections — so between the two, every ordinary bind is covered.
 */
export const PROBE_HOSTS: readonly string[] = ['127.0.0.1', '::1'];

/**
 * Does this port serve a DOCUMENT — i.e. is it a dev server rather than merely something listening?
 *
 * A bare TCP connect reported macOS ControlCenter (AirPlay Receiver, on by default on every Mac,
 * port 5000) as the user's dev server. See looks-like-dev-server for what it actually answers and
 * why "a socket accepted" is the wrong question.
 */
function servesDocument(port: number, host: string): Promise<boolean> {
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

/**
 * Is anything serving a document on this port, on EITHER loopback family?
 *
 * "Either" and not "both": one answer is enough, and requiring both would make the wildcard binds
 * this exists to see fail the check again. A family that errors (no IPv6 stack at all) is an
 * absence, never a rejection — a diagnostic must not throw at the tool it is diagnosing.
 */
export async function anyFamilyServes(
  port: number,
  probe: (port: number, host: string) => Promise<boolean> = servesDocument,
): Promise<boolean> {
  const answers = await Promise.all(
    PROBE_HOSTS.map((host) => probe(port, host).catch(() => false)),
  );
  return answers.some((up) => up);
}

/** Every candidate port serving a document, in ascending order. Never rejects. */
export async function probeDevServers(
  ports: readonly number[] = [...DEV_SERVER_PORTS],
  probe: (port: number) => Promise<boolean> = (p) => anyFamilyServes(p),
): Promise<number[]> {
  const results = await Promise.all(ports.map((p) => probe(p).then((up) => (up ? p : null))));
  return results.filter((p): p is number => p !== null).sort((a, b) => a - b);
}
