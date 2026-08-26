/**
 * Automatic sync, for the session nobody thinks about.
 *
 * Somebody runs Reticle all morning. Every tool call rewrites the impact record; every verification
 * writes a run. If sync is a command a human types, the dashboard is stale for exactly as long as
 * they are busy — which is precisely when the numbers on it would have been worth looking at.
 *
 * So the daemon does it. Not a new process, not a thing to remember: the daemon is already running
 * for the whole session (it is what the agent talks to), so it is the only place where "sync while
 * work is happening" costs nobody anything.
 *
 * ── THE THREE RULES THAT KEEP IT INVISIBLE ────────────────────────────────────────────────────
 * QUIET WHEN IDLE. A cycle on an unchanged session is one small GET and nothing else. That is what
 * makes a one-minute timer affordable; it is also why the timer is not adaptive — a scheme that
 * "backs off when idle" is complexity paid for a cost that is already near zero.
 *
 * NEVER IN THE WAY. Nothing here is awaited by a tool call. A sync that can slow down or fail a
 * verification would be a sync worth switching off, and the local record is authoritative anyway.
 *
 * SILENT UNLESS IT MATTERS. A failed cycle is logged once per NEW error, not once per minute: a
 * laptop on a train would otherwise fill the log with the same line four hundred times and teach
 * everyone to ignore it.
 */
import { log } from '../log.js';
import { describeSync, runSyncCycle, type SyncReport } from './sync-cycle.js';
import { diskSink, diskSource, readCloudState } from './sync-disk.js';
import type { ProjectCloud } from './cloud-config.js';

/** How often the daemon cycles. See the note above on why this is a constant and not a curve. */
export const DAEMON_SYNC_INTERVAL_MS = 60_000;

/** Given to the first cycle so a freshly-started daemon does not race the session that woke it. */
const FIRST_CYCLE_DELAY_MS = 5_000;

export interface SyncDaemonDeps {
  reticleRoot: string;
  /** Resolved per tick, not once: a repo linked while the daemon is alive starts syncing itself. */
  cloud: () => Promise<ProjectCloud>;
  now?: () => number;
  intervalMs?: number;
  /** Injected for the test; the real one is `fetch`. */
  request?: (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => Promise<{ status: number; text: string }>;
}

export interface SyncDaemon {
  /** Run one cycle now, whatever the timer is doing. Returns undefined when not linked. */
  syncNow: () => Promise<SyncReport | undefined>;
  stop: () => void;
}

const defaultRequest = async (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<{ status: number; text: string }> => {
  const res = await fetch(url, init);
  return { status: res.status, text: await res.text() };
};

/**
 * Start the loop. Safe to call for an UNLINKED project: it resolves the link on every tick and does
 * nothing until one appears, which is what lets `reticle link` take effect without a restart.
 */
export function startSyncDaemon(deps: SyncDaemonDeps): SyncDaemon {
  const intervalMs = deps.intervalMs ?? DAEMON_SYNC_INTERVAL_MS;
  const now = deps.now ?? ((): number => Date.now());
  const request = deps.request ?? defaultRequest;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  /** The last error already reported. Repeats are swallowed so an offline laptop stays quiet. */
  let reportedError: string | undefined;

  const cycle = async (): Promise<SyncReport | undefined> => {
    // Overlap guard: a slow cycle must not have a second one started on top of it, or two bundles
    // race and the cursor written by the loser silently rewinds the winner's progress.
    if (running) return undefined;
    running = true;
    try {
      const cloud = await deps.cloud();
      if (null === cloud.config) return undefined;
      const full = diskSource(deps.reticleRoot);
      const report = await runSyncCycle({
        config: cloud.config,
        source: {
          runs: () => (cloud.policy.runs ? full.runs() : []),
          flows: () => (cloud.policy.flows ? full.flows() : []),
          derived: (kind) => (cloud.policy.memory ? full.derived(kind) : undefined),
        },
        sink: diskSink(deps.reticleRoot),
        state: readCloudState(deps.reticleRoot),
        now,
        request,
      });
      if (report.error !== undefined) {
        if (report.error !== reportedError) {
          reportedError = report.error;
          log('reticle_cloud_sync_failed', { error: report.error });
        }
      } else {
        reportedError = undefined;
        // Only when something actually moved. A per-minute "nothing to send" is noise that trains
        // people to stop reading the log.
        const moved =
          report.runsSent > 0 ||
          report.flowsSent > 0 ||
          report.derivedSent.length > 0 ||
          report.pulled > 0;
        if (moved) log('reticle_cloud_synced', { summary: describeSync(report) });
      }
      return report;
    } catch (error: unknown) {
      // Belt and braces: runSyncCycle already swallows, and a throw here would kill the timer.
      const message = error instanceof Error ? error.message : String(error);
      if (message !== reportedError) {
        reportedError = message;
        log('reticle_cloud_sync_failed', { error: message });
      }
      return undefined;
    } finally {
      running = false;
    }
  };

  const schedule = (delay: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void cycle().finally(() => schedule(intervalMs));
    }, delay);
    // Unref'd: a pending sync must never be the reason a process refuses to exit.
    timer.unref?.();
  };

  schedule(FIRST_CYCLE_DELAY_MS);

  return {
    syncNow: cycle,
    stop: (): void => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
