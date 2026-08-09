/**
 * The daemon's telemetry lifecycle, in one place: start, the periodic flush that survives a kill, the
 * one-shot project profile, and the rich summary on shutdown.
 *
 * Extracted from `cli.ts` because it is a cohesive unit with its own timers and its own failure rule
 * (nothing here may ever be able to fail a daemon start), and because `cli.ts` is a dispatcher — the
 * more of this that lives there, the harder it is to see what a command actually does.
 */
import { TelemetryEventKind } from '@reticlehq/core';
import { getTelemetry } from './telemetry.js';
import { getSessionMetrics } from './session-metrics.js';
import { profileProject } from './project-profile.js';
import { startUpdateCheck } from '../update/update-nudge.js';
import { markDaemonStart } from './mcp-connection.js';

/** Let the daemon finish coming up before walking the source tree for a profile. */
const PROJECT_PROFILE_DELAY_MS = 5_000;
/**
 * How often a long-lived daemon flushes its counters.
 *
 * ponytail: coarse on purpose. A daemon that is SIGKILLed — OOM, a closed laptop, `kill -9` — never
 * reaches its shutdown handler, so without this the whole session's counters die with it. Thirty
 * minutes bounds that loss to one window while keeping the event volume near zero for the common case
 * (most daemons stop cleanly and send exactly one summary). If the lost windows ever show up as a
 * real gap, the upgrade is a small on-disk journal replayed at the next start, not a shorter timer.
 */
/**
 * How often a running daemon rolls up its window.
 *
 * Exported because it is the BOUND ON WHAT IS LOST: a daemon that has served a tool never
 * idle-exits, so nothing calls shutdown, so its last partial window dies with the process. At 30
 * minutes against a median 28-minute session that meant the median session reported nothing at all.
 * Only non-empty windows emit, so a shorter interval costs nothing on the 74% of daemons that never
 * serve a tool.
 */
export const SESSION_FLUSH_MS = 5 * 60 * 1000;

/** Stops the timers this installed. Called from the daemon's shutdown path. */
export interface DaemonTelemetry {
  /**
   * Emit the final, rich session summary and stop flushing. Safe to call more than once.
   *
   * AWAITABLE, and the daemon must await it. Every other send in the product is fire-and-forget
   * because losing one counter never matters — but this one carries the whole session, and the
   * process calls `process.exit(0)` immediately afterwards, which kills an in-flight POST. Verified
   * against a local capture server: fire-and-forget lost the event every single time. A send that
   * fails or hangs still cannot block the exit, because `emit` swallows its own errors and is bounded
   * by its own request timeout.
   */
  shutdown(): Promise<void>;
}

/**
 * Report the daemon as started, profile the project once, and keep the session counters flushing.
 * Every timer is `unref`'d so telemetry can never be the reason a daemon refuses to exit.
 */
export function installDaemonTelemetry(
  cwd: string,
  now: () => number = () => Date.now(),
): DaemonTelemetry {
  const metrics = getSessionMetrics(now);
  void getTelemetry().emit(TelemetryEventKind.DAEMON_STARTED);
  // Ask npm whether a newer Reticle exists, so the agent can tell the human. Nothing checked before
  // this, so a published fix was invisible until someone manually ran `reticle update`.
  startUpdateCheck(now);
  markDaemonStart(now());

  // One profile per daemon start: what kind of project this is and how deeply Reticle is used in it.
  // Deferred off the boot path — it walks the source tree, and nothing about a daemon coming up
  // should wait on a filesystem scan.
  setTimeout(() => {
    try {
      void getTelemetry().emit(TelemetryEventKind.PROJECT_PROFILED, {
        project: profileProject(cwd, now()),
      });
    } catch {
      /* a profile is a nice-to-have; it must never touch the daemon */
    }
  }, PROJECT_PROFILE_DELAY_MS).unref();

  const flush = setInterval(() => {
    if (metrics.empty) return; // an idle window is not worth an event
    // NOT daemon_stopped: the daemon is still running. See SESSION_PROGRESS.
    void getTelemetry().emit(TelemetryEventKind.SESSION_PROGRESS, {
      session: metrics.summarize(false),
    });
    metrics.reset();
  }, SESSION_FLUSH_MS);
  flush.unref();

  let stopped: Promise<void> | undefined;
  return {
    shutdown(): Promise<void> {
      // Both SIGTERM and the idle-shutdown path can call this; the second caller awaits the first
      // send rather than emitting a duplicate summary.
      stopped ??= (async () => {
        clearInterval(flush);
        // The rich one: the whole session in a single event — duration, the tool histogram, error
        // shapes, verifications, browser launches. This is what replaced the per-tool-call event.
        await getTelemetry().emit(TelemetryEventKind.DAEMON_STOPPED, {
          session: metrics.summarize(true),
        });
      })();
      return stopped;
    },
  };
}
