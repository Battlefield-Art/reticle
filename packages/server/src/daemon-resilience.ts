/**
 * Process-level resilience for the long-running daemon. The daemon serves many agents at once, so a
 * single stray error must not take the whole fleet down:
 *
 * - unhandledRejection (a fire-and-forget promise nobody awaited — the common case in async WS/pool
 * code) → LOG and keep running. One agent's async slip-up can't crash the daemon for everyone.
 * - uncaughtException (a synchronous throw escaped all try/catch) → the process state is undefined
 * per Node's guidance, so LOG a clear reason and exit cleanly; the next `reticle mcp` respawns a fresh
 * daemon, which beats crashing silently or limping along corrupt.
 */

import { TelemetryActor, TelemetryEventKind } from '@reticlehq/core';
import {
  errorSkeleton,
  errorTypeOf,
  fingerprintCrash,
  MAX_REPORTED_FRAMES,
  reticleFrames,
} from './telemetry/error-fingerprint.js';
import { getSessionMetrics } from './telemetry/session-metrics.js';
import { machineSnapshot } from './telemetry/machine-snapshot.js';
import { getTelemetry } from './telemetry/telemetry.js';

export interface ProcessLike {
  on(event: string, listener: (arg: unknown) => void): unknown;
}

type LogFn = (event: string, data: Record<string, unknown>) => void;

function describe(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** The two ways a failure reaches the top of the process. Named so the analytics can tell them apart. */
export const CrashKind = {
  UNHANDLED_REJECTION: 'unhandled_rejection',
  UNCAUGHT_EXCEPTION: 'uncaught_exception',
} as const;
export type CrashKind = (typeof CrashKind)[keyof typeof CrashKind];

/**
 * Report a crash with enough detail to actually diagnose it.
 *
 * This is the only place in the product that learns about a crash at all. An uncaught exception in a
 * long-running daemon takes down every agent attached to it, and the only other record is a line in a
 * local log nobody sends us.
 *
 * The first version sent a hash and nothing else, which made crashes rankable and undiagnosable — you
 * could see that forty machines hit `a3f2c1d8e9b0` and had no way to learn what that was. So it now
 * carries the four things an RCA needs: WHERE (our own frames, with function names and line numbers),
 * WHAT (the message with every variable part stripped), WHEN (the tool in flight), and WHY-ish (the
 * agent's approach run before it). All of it is our code and our vocabulary; the user's stack frames,
 * their paths, and the contents of their message are removed before any of it is built.
 *
 * Best-effort and wrapped: reporting a crash must never be the reason a crash gets worse.
 */
function reportCrash(kind: CrashKind, value: unknown): void {
  try {
    const errorType = errorTypeOf(value);
    const stack = value instanceof Error ? (value.stack ?? '') : '';
    const message = describe(value);
    const { breadcrumb, inFlight } = getSessionMetrics().trail;
    const machine = machineSnapshot();
    void getTelemetry().emit(TelemetryEventKind.RUNTIME_CRASHED, {
      // A crash is ALWAYS reached through something the agent asked for — the daemon does nothing on
      // its own — so attributing it to the agent is accurate rather than a guess.
      actor: TelemetryActor.AGENT,
      crash: {
        kind,
        errorType,
        fingerprint: fingerprintCrash(errorType, stack, message),
        // The skeleton, not the message: every quoted string, path, URL, id and number is replaced
        // by `*` first. This is what makes the fingerprint mean something to a human reading a chart.
        message: errorSkeleton(message).slice(0, 300),
        // Our own frames, our own published code. The file, the line, and the function — which is the
        // whole of "where did it break". Frames from the user's app never survive this.
        frames: reticleFrames(stack).slice(0, MAX_REPORTED_FRAMES),
        ...(inFlight !== undefined ? { tool: inFlight } : {}),
        ...(breadcrumb.length > 0 ? { breadcrumb } : {}),
        // Crashes cluster hard by runtime version and architecture, and we were recording neither.
        nodeVersion: process.versions.node,
        arch: process.arch,
        // "Out of memory" and "our bug" look identical in a stack trace. This is what tells them apart.
        ...(machine !== undefined ? { machine } : {}),
      },
    });
  } catch {
    /* a crash report must never be the reason a crash gets worse */
  }
}

export function installDaemonResilience(proc: ProcessLike, log: LogFn, onFatal: () => void): void {
  proc.on('unhandledRejection', (reason: unknown) => {
    log('reticle_daemon_unhandled_rejection', { reason: describe(reason) });
    reportCrash(CrashKind.UNHANDLED_REJECTION, reason);
  });
  proc.on('uncaughtException', (err: unknown) => {
    log('reticle_daemon_uncaught_exception', { error: describe(err) });
    reportCrash(CrashKind.UNCAUGHT_EXCEPTION, err);
    onFatal();
  });
}
