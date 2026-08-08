/**
 * Verbose internal flow tracing, for people working ON Reticle.
 *
 * The gap it fills: the journal records what the AGENT did to the app, and telemetry records
 * aggregates. Neither says which of OUR code a tool call went through, in what order, or where the
 * time went — so every "why is this flow slow" and "which path produced this verdict" was
 * reconstructed by hand from reading source. One line per stage answers both.
 *
 * Design, in order of what it cost to get wrong elsewhere in this repo:
 *
 *  - OFF by default, and free when off (`span` calls the function and returns). A trace on every
 *    tool call is a cost on the hot path, and the hot path is a verification loop of 50–200 calls.
 *  - ONE line per stage, emitted when it ENDS, carrying its own duration. A start line as well
 *    would double the volume to say something the end line already implies.
 *  - Correlated by a call id and a depth, carried in AsyncLocalStorage rather than threaded through
 *    every signature. Several agents are inside `runTool` at once — interleaving is the normal case
 *    — so without an id the output is a pile of unrelated lines, and instrumenting anything would
 *    mean changing its parameters, which is how instrumentation stops being added.
 *  - Through the existing `log()`, so it lands in the same stderr stream the daemon already
 *    redirects to `~/.reticle/daemon-<port>.log`. No new sink, no new file, nothing else to tail.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { ReticleEnv } from '@reticlehq/core';
import { log } from './log.js';

/** The `event` field every trace line carries, so one `grep` separates it from milestone logs. */
export const TRACE_EVENT = 'trace';

const ON_VALUES: ReadonlySet<string> = new Set(['1', 'true', 'on', 'yes']);

interface CallContext {
  callId: string;
  depth: number;
}

const context = new AsyncLocalStorage<CallContext>();

/**
 * Monotonic within a process, and PID-qualified so it stays unique across them.
 *
 * A bare counter was not enough: the e2e battery runs many daemons, and a restarted daemon starts
 * over at 1, so `c7` named a different call in every process. Aggregating that trace silently
 * merged unrelated calls into one — measured on the first real trace collected, before it had a
 * chance to mislead anything.
 */
let nextCallId = 0;
const CALL_ID_PREFIX = `p${String(process.pid)}-c`;

/**
 * Whether tracing is on. Read per call rather than cached at import: a daemon is long-lived, and a
 * flag you can only set before startup is one nobody turns on while looking at the problem.
 */
export function traceEnabled(): boolean {
  const raw = process.env[ReticleEnv.TRACE];
  return raw !== undefined && ON_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Run `fn` as a named stage, recording how long it took and how it sat inside the call around it.
 *
 * Wrap a stage worth a line in a bottleneck hunt — a session resolve, a browser round-trip, a
 * predicate evaluation — not every function. The value of the trace is that reading it is faster
 * than reading the code, and that stops being true somewhere around one line per statement.
 */
export async function span<T>(
  name: string,
  fields: Record<string, unknown>,
  fn: () => Promise<T> | T,
): Promise<T> {
  if (!traceEnabled()) return fn();
  const parent = context.getStore();
  const scope: CallContext =
    parent === undefined
      ? { callId: `${CALL_ID_PREFIX}${String((nextCallId += 1))}`, depth: 0 }
      : parent;
  const depth = parent === undefined ? 0 : parent.depth;
  const startedAt = Date.now();
  const emit = (ok: boolean, extra: Record<string, unknown>): void => {
    log(TRACE_EVENT, {
      span: name,
      ms: Date.now() - startedAt,
      depth,
      callId: scope.callId,
      ok,
      ...fields,
      ...extra,
    });
  };
  // The child scope is what nested spans see: same call, one level deeper.
  const child: CallContext = { callId: scope.callId, depth: depth + 1 };
  try {
    const value = await context.run(child, async () => fn());
    emit(true, {});
    return value;
  } catch (err) {
    // A stage that THREW is the one most worth having in the trace: without this line the trace
    // shows a call that entered a stage and never left it, which reads as a hang.
    emit(false, { error: String(err).slice(0, 300) });
    throw err;
  }
}
