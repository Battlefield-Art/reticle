/**
 * The in-process session accumulator — the reason Reticle's telemetry bill does not scale with how
 * hard people use it.
 *
 * The old design emitted one event per MCP tool call. That reads as harmless until you multiply it
 * out: a single agent verification loop is 50–200 tool calls, so a thousand daily users would push
 * millions of events a day, and PostHog bills per ingested event. Worse, it was millions of events
 * answering a question that ONE property answers better — `{reticle_act: 40, reticle_assert: 12}`
 * tells you the session was a real verification loop, where 52 separate rows tell you only that 52
 * things happened, with the shape scattered across them.
 *
 * So counts live here, in memory, and leave as a single `daemon_stopped` event.
 *
 * Everything recorded is a COUNT or a fingerprint. No tool arguments, no results, no selectors, no
 * URLs, no error messages — the accumulator has no way to hold them, which is a stronger guarantee
 * than a rule saying it shouldn't.
 */
import {
  BrowserLaunchKind,
  type ConnectFailure,
  type ConnectionStats,
  type ErrorShape,
  type SessionSummary,
  type ToolTiming,
} from '@reticlehq/core';
import { errorSkeleton, fingerprintError } from './error-fingerprint.js';
import { describeToolParams } from './argument-shape.js';
import { machineSnapshot } from './machine-snapshot.js';

/** Cap the distinct error shapes held in memory — a pathological loop must not grow unbounded. */
const MAX_ERROR_KINDS = 40;
/** Cap distinct MCP clients recorded; more than a handful on one daemon is already the story. */
const MAX_CLIENTS = 8;
/** Bounds on the parameter map. Our own schemas are already finite; these are a belt-and-braces cap. */
const MAX_PARAM_TOOLS = 60;
const MAX_PARAMS_PER_TOOL = 24;
/**
 * How many recent tool calls to remember for the crash breadcrumb.
 *
 * Twelve is roughly one verification loop — enough to see the APPROACH (`snapshot → act → act →
 * assert`) rather than just the last step, which is what turns "it crashed in act-tools" into "it
 * crashed acting on a page it had just navigated away from". Names only, so this is a dozen short
 * strings and costs nothing to hold.
 */
const BREADCRUMB_LENGTH = 12;

/**
 * Mutable counters for one daemon lifetime. A plain class, not a store: it is process-local, it never
 * persists, and it dies with the daemon.
 */
export class SessionMetrics {
  #toolCalls = 0;
  #toolErrors = 0;
  #verifications = 0;
  readonly #toolCounts = new Map<string, number>();
  readonly #toolParams = new Map<string, Map<string, number>>();
  /** Ring of the most recent tool NAMES — the agent's approach run, for a crash report. */
  readonly #breadcrumb: string[] = [];
  /** The tool currently in flight, so a crash can name its trigger point. */
  #inFlight: string | undefined;
  #sdkFailures = 0;
  readonly #sdkFailureKinds = new Map<string, ErrorShape>();
  readonly #errorKinds = new Map<string, ErrorShape>();
  readonly #connections = new Map<string, ConnectionStats>();
  readonly #toolTiming = new Map<string, ToolTiming>();
  #busyMs = 0;
  #concurrent = 0;
  #peakConcurrent = 0;
  #unknownToolCalls = 0;
  #bugsFound = 0;
  #browserMs = 0;
  #browserCommands = 0;
  readonly #bugKinds = new Map<string, number>();
  readonly #clients = new Set<string>();
  readonly #startedAt: number;
  readonly #now: () => number;

  /** Clock injected — this file must stay testable without a real one, per the repo's clock rule. */
  constructor(now: () => number) {
    this.#now = now;
    this.#startedAt = now();
  }

  /**
   * Record a call starting. Returns a function to call when it finishes — that closure is what makes
   * timing correct under CONCURRENCY: several agents can be inside `runTool` at once, so a single
   * "last start time" field would attribute one tool's duration to another. Each call carries its own.
   */
  startToolCall(tool: string, args?: Record<string, unknown>): (durationMs: number) => void {
    this.recordToolCall(tool, args);
    this.#concurrent += 1;
    if (this.#concurrent > this.#peakConcurrent) this.#peakConcurrent = this.#concurrent;
    let settled = false;
    return (durationMs: number) => {
      if (settled) return; // a double-settle would corrupt the concurrency count
      settled = true;
      this.#concurrent = Math.max(0, this.#concurrent - 1);
      this.#busyMs += durationMs;
      const timing = this.#toolTiming.get(tool) ?? { totalMs: 0, maxMs: 0 };
      timing.totalMs += durationMs;
      timing.maxMs = Math.max(timing.maxMs, durationMs);
      this.#toolTiming.set(tool, timing);
    };
  }

  /**
   * Time spent waiting on the BROWSER, across all commands.
   *
   * Compared against `busyMs` this answers the question a single total cannot: of the time an agent
   * spends inside Reticle, how much is us and how much is the app under test? Without the split a
   * 4-second `reticle_act` is unattributable — it could be our overhead or the app taking 4 seconds
   * to settle, and those have opposite fixes. A high ratio here is a finding about their app; a low
   * one alongside a high `busyMs` is a performance bug of ours.
   */
  recordBrowserLatency(ms: number): void {
    this.#browserMs += ms;
    this.#browserCommands += 1;
  }

  /** A call for a tool that does not exist. Non-zero means our surface is confusing the agent. */
  recordUnknownTool(): void {
    this.#unknownToolCalls += 1;
  }

  recordToolCall(tool: string, args?: Record<string, unknown>): void {
    this.#toolCalls += 1;
    bump(this.#toolCounts, tool);
    this.#inFlight = tool;
    this.#breadcrumb.push(tool);
    if (this.#breadcrumb.length > BREADCRUMB_LENGTH) this.#breadcrumb.shift();
    if (args === undefined) return;
    // Which PARAMETERS get used, per tool — names only (plus a short allowlist of our own enums).
    // Bounded by our own schemas: a tool has a fixed handful of declared parameters, so this map
    // cannot grow with traffic the way a value-carrying one would.
    let perTool = this.#toolParams.get(tool);
    if (perTool === undefined) {
      if (this.#toolParams.size >= MAX_PARAM_TOOLS) return;
      perTool = new Map<string, number>();
      this.#toolParams.set(tool, perTool);
    }
    for (const param of describeToolParams(args)) {
      if (perTool.size < MAX_PARAMS_PER_TOOL || perTool.has(param)) bump(perTool, param);
    }
  }

  /**
   * One failed tool call. Grouped by fingerprint, but stored WITH its skeleton message and the tool
   * that produced it — a bare fingerprint could be ranked and never diagnosed, which made the top
   * error in the dashboard a number nobody could act on.
   */
  recordToolError(message: string, tool?: string): void {
    this.#toolErrors += 1;
    const fingerprint = fingerprintError(message);
    const existing = this.#errorKinds.get(fingerprint);
    if (existing !== undefined) {
      existing.count += 1;
      return;
    }
    // Stop growing once the cap is hit; the tail is noise and the head is what gets fixed.
    if (this.#errorKinds.size >= MAX_ERROR_KINDS) return;
    this.#errorKinds.set(fingerprint, {
      fingerprint,
      count: 1,
      message: errorSkeleton(message),
      ...(tool !== undefined ? { tool } : {}),
    });
  }

  /**
   * A failure reported by the IN-PAGE half of Reticle, over the bridge.
   *
   * Kept in its own bucket rather than mixed into tool errors: a broken observer and a failing tool
   * call are different defects with different owners, and merging them would hide the browser-side
   * one inside a much larger pile. Same treatment otherwise — fingerprinted, variables stripped.
   */
  recordSdkFailure(site: string, message: string): void {
    this.#sdkFailures += 1;
    const fingerprint = fingerprintError(`${site}|${message}`);
    const existing = this.#sdkFailureKinds.get(fingerprint);
    if (existing !== undefined) {
      existing.count += 1;
      return;
    }
    if (this.#sdkFailureKinds.size >= MAX_ERROR_KINDS) return;
    this.#sdkFailureKinds.set(fingerprint, {
      fingerprint,
      count: 1,
      message: errorSkeleton(message),
      tool: site,
    });
  }

  /** The agent's recent approach run + the call in flight — context for a crash report. */
  get trail(): { breadcrumb: string[]; inFlight: string | undefined } {
    return { breadcrumb: [...this.#breadcrumb], inFlight: this.#inFlight };
  }

  recordVerification(): void {
    this.#verifications += 1;
  }

  /** One defect found in the app under test — the outcome number, kept broken down by kind. */
  recordBug(kind: string): void {
    this.#bugsFound += 1;
    if (this.#bugKinds.size < MAX_ERROR_KINDS || this.#bugKinds.has(kind))
      bump(this.#bugKinds, kind);
  }

  /**
   * One connection ATTEMPT. Call before the attempt; settle it with the outcome.
   *
   * The previous version counted only successes, and counted them inconsistently — incrementing
   * before the await on the CDP path and after it on the launch path — so one number meant attempts,
   * the others meant successes, and nothing in the data said which. A connection metric that cannot
   * express failure misses the only question worth asking: how often can people not get a browser?
   */
  recordConnectAttempt(kind: BrowserLaunchKind): (failure?: ConnectFailure) => void {
    const stats = this.#connections.get(kind) ?? { attempts: 0, successes: 0 };
    stats.attempts += 1;
    this.#connections.set(kind, stats);
    let settled = false;
    return (failure?: ConnectFailure) => {
      if (settled) return;
      settled = true;
      if (failure === undefined) {
        stats.successes += 1;
        return;
      }
      stats.failures ??= {};
      stats.failures[failure] = (stats.failures[failure] ?? 0) + 1;
    };
  }

  recordClient(name: string): void {
    if (this.#clients.size < MAX_CLIENTS) this.#clients.add(name.slice(0, 64));
  }

  /**
   * Roll the counters into the event payload. `final` marks a clean shutdown; a periodic flush passes
   * false so a session killed before it can exit is not lost entirely (see the flush note in cli.ts).
   */
  summarize(final: boolean): SessionSummary {
    const machine = machineSnapshot();
    return {
      durationMs: Math.max(0, this.#now() - this.#startedAt),
      toolCalls: this.#toolCalls,
      toolCounts: Object.fromEntries(this.#toolCounts),
      toolErrors: this.#toolErrors,
      ...(this.#errorKinds.size > 0 ? { errors: [...this.#errorKinds.values()] } : {}),
      sdkFailures: this.#sdkFailures,
      ...(this.#sdkFailureKinds.size > 0 ? { sdkErrors: [...this.#sdkFailureKinds.values()] } : {}),
      verifications: this.#verifications,
      bugsFound: this.#bugsFound,
      ...(this.#bugKinds.size > 0 ? { bugKinds: Object.fromEntries(this.#bugKinds) } : {}),
      ...(this.#toolParams.size > 0
        ? {
            toolParams: Object.fromEntries(
              [...this.#toolParams].map(([tool, params]) => [tool, Object.fromEntries(params)]),
            ),
          }
        : {}),
      ...(this.#connections.size > 0 ? { connections: Object.fromEntries(this.#connections) } : {}),
      ...(this.#toolTiming.size > 0 ? { toolTiming: Object.fromEntries(this.#toolTiming) } : {}),
      busyMs: this.#busyMs,
      browserMs: this.#browserMs,
      browserCommands: this.#browserCommands,
      peakConcurrentTools: this.#peakConcurrent,
      unknownToolCalls: this.#unknownToolCalls,
      ...(machine !== undefined ? { machine } : {}),
      ...(this.#clients.size > 0 ? { clients: [...this.#clients] } : {}),
      final,
    };
  }

  /** True when nothing at all happened — a flush of an idle daemon is not worth an event. */
  get empty(): boolean {
    return (
      this.#toolCalls === 0 &&
      this.#verifications === 0 &&
      this.#toolErrors === 0 &&
      this.#bugsFound === 0 &&
      this.#sdkFailures === 0
    );
  }

  /** Zero the counters after a non-final flush so the next flush reports the NEXT window, not a total. */
  reset(): void {
    this.#toolCalls = 0;
    this.#toolErrors = 0;
    this.#verifications = 0;
    this.#toolCounts.clear();
    this.#toolParams.clear();
    this.#errorKinds.clear();
    this.#sdkFailures = 0;
    this.#sdkFailureKinds.clear();
    this.#connections.clear();
    this.#toolTiming.clear();
    this.#busyMs = 0;
    this.#browserMs = 0;
    this.#browserCommands = 0;
    this.#peakConcurrent = 0;
    this.#unknownToolCalls = 0;
    this.#bugsFound = 0;
    this.#bugKinds.clear();
  }
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * The process-wide accumulator. A module singleton because the two call sites that feed it — the tool
 * chokepoint and the MCP error boundary — are far apart in the graph and threading a metrics object
 * through every ToolDeps would be a large, purely mechanical change for no added safety.
 */
let current: SessionMetrics | undefined;

export const getSessionMetrics = (now: () => number = () => Date.now()): SessionMetrics =>
  (current ??= new SessionMetrics(now));

/** Record one browser round-trip. Free-function form so the session hot path is a single call. */
export const recordBrowserLatency = (ms: number): void => {
  getSessionMetrics().recordBrowserLatency(ms);
};

/** Narrow-and-record one in-page failure. Keeps the session hot path to a single call. */
export const recordSdkFailure = (failure: { site: string; message: string }): void => {
  getSessionMetrics().recordSdkFailure(failure.site, failure.message);
};

/** Tests only — drop the singleton so each case starts from zero. */
export const resetSessionMetrics = (): void => {
  current = undefined;
};
