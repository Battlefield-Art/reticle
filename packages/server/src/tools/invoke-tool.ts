import { healthEnvelope } from '../session/session-health.js';
import { getTelemetry, TelemetryEventKind } from '../telemetry/telemetry.js';
import { asString } from './tools-helpers.js';
import { ReticleTool } from './tool-names.js';
import type { Session } from '../session/session.js';
import type { ToolDef, ToolDeps } from './tools.js';

/**
 * The live-session tools whose result MUST carry the
 * session-health envelope. Owned in ONE place — not retrofitted per handler — so a throttled tab
 * can never return a healthy-looking result from any of these. `runTool` is the single choke point
 * (mcp.ts + tool-invoker.ts) that splices health on; the guard test asserts the set is exhaustive.
 */
export const SESSION_BOUND_TOOLS: ReadonlySet<string> = new Set([
  ReticleTool.SNAPSHOT,
  ReticleTool.QUERY,
  ReticleTool.INSPECT,
  ReticleTool.COVERAGE,
  ReticleTool.VERIFY_CHANGE,
  ReticleTool.ACT,
  ReticleTool.ACT_SEQUENCE,
  ReticleTool.ACT_AND_WAIT,
  ReticleTool.OBSERVE,
  ReticleTool.WAIT_FOR,
  ReticleTool.ASSERT,
  ReticleTool.NETWORK,
  ReticleTool.CONSOLE,
  ReticleTool.ANIMATIONS,
  ReticleTool.BASELINE, // merged save/list/diff — save+diff are live reads
  ReticleTool.RECORD, // merged start/stop — both live
  ReticleTool.REPLAY,
  ReticleTool.CLOCK,
  ReticleTool.STATE,
  ReticleTool.STORAGE,
  ReticleTool.EXPLORE,
  ReticleTool.CRAWL,
  ReticleTool.SCROLL_TO,
  ReticleTool.NAVIGATE,
]);

/**
 * Tools that carry a `sessionId` arg but are NOT live-session-health tools — they read/write
 * disk (capabilities/contract/flow/project), drain a buffer, or steer session lifecycle. They are
 * exempt from the health splice ON PURPOSE. Kept explicit so the guard test can force every new
 * `sessionId`-bearing tool to be classified into exactly one set (bound XOR exempt).
 */
export const SESSION_EXEMPT_TOOLS: ReadonlySet<string> = new Set([
  ReticleTool.CAPABILITIES, // has a fromDisk mode with no live session
  ReticleTool.CONTRACT_SAVE, // persists the registry to disk
  ReticleTool.FLOW_SAVE, // sessionId only scopes the write to the app's flow subdir; disk-side
  ReticleTool.FLOW, // merged list/load/delete — sessionId only scopes the project; all disk-side
  ReticleTool.FLOW_REPLAY, // returns its own FlowReplayResult contract (+ auto-records a run)
  ReticleTool.FLOW_VERIFY, // returns its own SuiteVerdict contract (replays the whole suite)
  ReticleTool.FLOW_SAVE_RECORDED, // reads the recording buffer, writes disk
  ReticleTool.FLOW_HEAL, // returns its own FlowHealResult contract
  ReticleTool.PROJECT, // reads .reticle/project.json
  ReticleTool.RUN_EXPORT, // reads .reticle/runs/<id>.json (verification-run artifact)
  ReticleTool.SESSION, // merged lifecycle/human-channel family (tune/yield/end/resume/messages/review/narrate)
  ReticleTool.SCREENSHOT, // own contract; provider-driven, not a live-DOM-health read
  ReticleTool.VISUAL_DIFF, // own contract (matched/ratio/region)
  ReticleTool.NETWORK_MOCK, // own contract (applied/count); provider-driven, not a live-DOM read
  ReticleTool.VIEWPORT, // own contract (applied/width/height); provider-driven, not a live-DOM read
  ReticleTool.ANNOTATE, // annotates a recording's steps; pure disk-side metadata, no live DOM read
  ReticleTool.LEASE, // merged acquire/release — its sessionId is a pool lease id, not a live session
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The single entry point both the MCP server and the programmatic invoker call instead of
 * `tool.handler` directly. Runs the handler, then — for a live-session tool returning a plain
 * object that did not already include `session` — splices the health envelope on. Idempotent
 * (handlers that already add health are left untouched) and never alters non-object results.
 */
export async function runTool(
  tool: ToolDef,
  deps: ToolDeps,
  args: Record<string, unknown>,
): Promise<unknown> {
  // Both dispatch paths (MCP + programmatic) pass through here — the one place "which tool is mostly
  // used" can be counted. Fire-and-forget: telemetry never delays or fails a tool call.
  void getTelemetry().emit(TelemetryEventKind.TOOL, { tool: tool.name });
  const rawSessionId = asString(args['sessionId']);
  const bound = SESSION_BOUND_TOOLS.has(tool.name);

  // Resolve the session identity ONCE, up front, for a live-session tool. The lease heartbeat must
  // target the session the handler will ACTUALLY drive — which, when the agent omits sessionId, is the
  // auto-selected one, NOT the raw (undefined) arg. Touching the raw arg meant an auto-selected drive
  // never refreshed its pool lease, so the reaper could reclaim the session mid-operation. Resolve
  // before the handler so a long ACT_AND_WAIT is protected for its whole duration; on failure leave it
  // to the handler to throw the canonical no-session error.
  let session: Session | undefined;
  if (bound) {
    try {
      session = deps.sessions.resolve(rawSessionId);
    } catch {
      session = undefined;
    }
  }
  const leaseId = session?.id ?? rawSessionId;
  if (leaseId !== undefined) deps.pool?.touch(leaseId);

  const result = await tool.handler(deps, args);
  if (!bound || !isPlainObject(result)) return result;
  // Reuse the session resolved above so the health envelope describes the SAME session the handler
  // drove; only re-resolve if the up-front attempt failed but the handler somehow succeeded.
  const resolved = session ?? deps.sessions.resolve(rawSessionId);
  const envelope: Record<string, unknown> = {};
  // The health block is idempotent: add it only when the handler didn't already include a `session`.
  if (!('session' in result)) Object.assign(envelope, healthEnvelope(resolved));
  // Lease + age-warning are INDEPENDENT of the health block. Previously the `'session' in result`
  // early-return skipped them whenever a handler returned its own health (which a throttled tab always
  // does) — so a long-running backgrounded session, the case most likely to leak, never got the
  // one-time pool-lease reminder or the age cleanup nudge. Splice them regardless.
  const lease = resolved.takeSessionLease();
  if (lease !== undefined) envelope['session_lease'] = lease;
  const warning = resolved.ageWarning();
  if (warning !== undefined) envelope['session_age_warning'] = warning;
  return Object.keys(envelope).length > 0 ? { ...result, ...envelope } : result;
}
