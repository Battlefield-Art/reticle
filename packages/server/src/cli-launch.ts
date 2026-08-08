import * as http from 'node:http';
import { spawn } from 'node:child_process';
import { isOpaqueOrigin, LOOPBACK_HOST, STATUS_PATH } from '@reticlehq/core';
import { describeSkew, DAEMON_FIX } from './version-skew.js';
import { CONTRACT_FINGERPRINT } from '@reticlehq/core';
import { SERVER_VERSION } from './server-version.js';
import { log } from './log.js';

/**
 * CLI launch + status helpers — the daemon-introspection (`reticle status`) and the one-command
 * "show me the app" flow (`reticle open`). Split out of cli.ts so that file stays under the size cap.
 * The decision logic is pure (unit-tested); the IO (fetch, OS browser launch) is injected/isolated.
 */

/** One connected tab as `reticle status` reports it — the at-a-glance health line. */
interface StatusSession {
  sessionId: string;
  url: string;
  throttled: boolean;
  stale: boolean;
  pendingMarks: number;
}

/**
 * Reduce the daemon's /status JSON to the compact view `reticle status` prints. Pure: narrows the
 * untrusted wire payload (never `any`) and tolerates a missing/partial body so a malformed response
 * degrades to "running, 0 sessions" instead of throwing.
 */
export function summarizeStatus(payload: unknown): {
  sessionCount: number;
  sessions: StatusSession[];
} {
  if (typeof payload !== 'object' || null === payload) return { sessionCount: 0, sessions: [] };
  const obj = payload as Record<string, unknown>;
  const raw = Array.isArray(obj['sessions']) ? obj['sessions'] : [];
  const sessions = raw
    .map((s): StatusSession | null => {
      if (typeof s !== 'object' || null === s) return null;
      const r = s as Record<string, unknown>;
      const sessionId = 'string' === typeof r['sessionId'] ? r['sessionId'] : '';
      if ('' === sessionId) return null;
      return {
        sessionId,
        url: 'string' === typeof r['url'] ? r['url'] : '',
        throttled: true === r['throttled'],
        stale: true === r['stale'],
        pendingMarks: 'number' === typeof r['pendingMarks'] ? r['pendingMarks'] : 0,
      };
    })
    .filter((s): s is StatusSession => s !== null);
  const sessionCount =
    'number' === typeof obj['sessionCount'] ? obj['sessionCount'] : sessions.length;
  return { sessionCount, sessions };
}

/** A string field off the /status body, or undefined on a daemon too old to report it. */
function statusField(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || null === payload) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return 'string' === typeof value && value.length > 0 ? value : undefined;
}

/**
 * Warn when the daemon already on this port is a different version than this CLI, and attach anyway.
 *
 * Attaching to whatever owns the port is the point of a daemon — but it means an upgrade does not
 * take effect until that daemon dies, and nothing used to say so. Killing it here would take out
 * another agent's session on a version bump, which is worse than a loud line.
 */
export async function warnOnDaemonSkew(port: number): Promise<void> {
  const status = await fetchStatus(port);
  const skew = describeSkew(
    {
      what: 'the daemon already running on this port',
      version: statusField(status, 'version'),
      contract: statusField(status, 'contract'),
      fix: DAEMON_FIX,
    },
    { version: SERVER_VERSION, contract: CONTRACT_FINGERPRINT },
  );
  if (skew !== undefined) log('reticle_daemon_skew', { port, warning: skew });
}

/** How long the daemon /status probe waits before giving up — a local loopback call is near-instant. */
const STATUS_PROBE_TIMEOUT_MS = 1000;

/** GET the daemon's /status JSON. Resolves to the parsed body, or undefined on any failure. */
export function fetchStatus(port: number): Promise<unknown> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: LOOPBACK_HOST, port, path: STATUS_PATH, timeout: STATUS_PROBE_TIMEOUT_MS },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(undefined);
          }
        });
      },
    );
    req.on('error', () => resolve(undefined));
    req.on('timeout', () => {
      req.destroy();
      resolve(undefined);
    });
  });
}

/** What `reticle open` should do: reuse an already-connected tab, open a new one, or ask for a url. */
type OpenDecision =
  | { action: 'reuse'; url: string }
  | { action: 'open'; url: string }
  | { action: 'need-url' };

function sameOrigin(a: string, b: string): boolean {
  try {
    const origin = new URL(a).origin;
    // Two opaque origins (desktop webviews, file:// docs) BOTH stringify to "null", so comparing them
    // would call every desktop app the same app and reuse the wrong session. Never match on opaque.
    if (isOpaqueOrigin(origin)) return false;
    return origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Decide what `reticle open [url]` does, given the currently-connected tabs. Pure.
 * - no url + a tab connected → reuse it (the app is already open; don't spawn a duplicate).
 * - no url + nothing connected → ask for one.
 * - url + a tab already on that origin → reuse it (idempotent — re-running never piles up tabs).
 * - url + no matching tab → open it.
 */
export function decideOpen(sessions: { url: string }[], url: string | undefined): OpenDecision {
  if (url === undefined) {
    const first = sessions[0];
    return first !== undefined ? { action: 'reuse', url: first.url } : { action: 'need-url' };
  }
  const match = sessions.find((s) => s.url === url || sameOrigin(s.url, url));
  return match !== undefined ? { action: 'reuse', url: match.url } : { action: 'open', url };
}

/**
 * Percent-encode the cmd.exe metacharacters that `start` re-parses so a URL can't break out into
 * command execution on Windows (`?next=x&calc` → command chaining). `%` is left untouched so an
 * already-encoded URL isn't double-encoded; the browser decodes the escapes back to the real URL.
 */
function encodeForWindowsStart(url: string): string {
  return url.replace(/[&^|<>()"'!]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The OS command that opens a URL in the default browser, per platform. Pure — unit-tested. */
export function openCommand(
  url: string,
  platform: NodeJS.Platform,
): { cmd: string; args: string[] } {
  if ('darwin' === platform) return { cmd: 'open', args: [url] };
  if ('win32' === platform) {
    return { cmd: 'cmd', args: ['/c', 'start', '', encodeForWindowsStart(url)] };
  }
  return { cmd: 'xdg-open', args: [url] };
}

/** Launch the default browser at `url` (detached). The spawn is injected so tests stay hermetic. */
export function openInBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  run: (cmd: string, args: string[]) => void = defaultRun,
): void {
  const { cmd, args } = openCommand(url, platform);
  run(cmd, args);
}

function defaultRun(cmd: string, args: string[]): void {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
}
