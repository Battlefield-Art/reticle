/**
 * Telling the agent that a newer Reticle exists.
 *
 * Until now nothing did. `checkForUpdate` had exactly one caller — the `reticle update` command — so
 * a published release was invisible to every install until a human happened to type that command,
 * which in practice meant never. A fix could ship and sit unused for months on the machines that hit
 * the bug it fixed.
 *
 * The nudge rides the tool-result envelope rather than being a tool of its own, for the same reason
 * the session-health and pool-lease reminders do: the agent is mid-task, and something it has to go
 * and ASK for is something it will not ask for. Delivered ONCE per daemon process — a repeated
 * "please update" during someone's work is noise, and noise is what gets filtered out.
 *
 * It deliberately does NOT update anything by itself. A silent self-install would swap the binary
 * under a running session, restart the daemon, and drop every agent attached to it — during work the
 * human never agreed to interrupt. So the envelope carries the fact and the exact command, and the
 * decision stays with the people whose machine it is.
 */
import { checkForUpdate } from './update-checker.js';
import { SERVER_VERSION } from '../server-version.js';
import { log } from '../log.js';

/** Let the daemon finish coming up before touching the network. */
const CHECK_DELAY_MS = 8_000;

export interface UpdateNudge {
  /** The version available, so the agent can tell the human what they would be moving to. */
  latestVersion: string;
  currentVersion: string;
  /** The exact command. Spelled out so the agent never has to guess or invent one. */
  command: string;
  action: string;
}

const UPDATE_COMMAND = 'reticle update';

let pending: UpdateNudge | undefined;
let delivered = false;

/**
 * Kick off a background check. Non-blocking and best-effort: `checkForUpdate` never throws, caches
 * for 24h on disk, and falls back to the cached manifest when the registry is unreachable — so this
 * costs one npm registry request per day per machine, and nothing at all when offline.
 */
export function startUpdateCheck(now: () => number = () => Date.now()): void {
  setTimeout(() => {
    void checkForUpdate(SERVER_VERSION, now)
      .then((manifest) => {
        if (!manifest.updateAvailable || manifest.latestVersion === undefined) return;
        pending = {
          currentVersion: SERVER_VERSION,
          latestVersion: manifest.latestVersion,
          command: UPDATE_COMMAND,
          action:
            `A newer Reticle is available (${SERVER_VERSION} → ${manifest.latestVersion}). ` +
            `Tell the human, and run \`${UPDATE_COMMAND}\` if they agree — it restarts the daemon, ` +
            'so do it between tasks rather than mid-verification. Continue your current task first.',
        };
        log('reticle_update_available', {
          from: SERVER_VERSION,
          to: manifest.latestVersion,
        });
      })
      .catch(() => {
        /* a version check must never surface to a user */
      });
  }, CHECK_DELAY_MS).unref();
}

/** The nudge, once. Returns undefined afterwards so a long session is told exactly one time. */
export function takeUpdateNudge(): UpdateNudge | undefined {
  if (delivered || pending === undefined) return undefined;
  delivered = true;
  return pending;
}

/** Tests only — drop the module state so each case starts clean. */
export function resetUpdateNudge(): void {
  pending = undefined;
  delivered = false;
}

/** Tests only — seed a pending nudge without going near the network. */
export function setPendingUpdate(nudge: UpdateNudge | undefined): void {
  pending = nudge;
  delivered = false;
}
