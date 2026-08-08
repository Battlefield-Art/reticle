import { healthEnvelope } from '../session/session-health.js';
import { TelemetryActor, TelemetryEventKind } from '@reticlehq/core';
import { getSessionMetrics } from '../telemetry/session-metrics.js';
import { getTelemetry } from '../telemetry/telemetry.js';
import { takeUpdateNudge } from '../update/update-nudge.js';
import { takeVersionSkew } from '../version-nudge.js';
import { noteToolCall } from '../daemon-usefulness.js';
import { bugsInResult } from '../telemetry/bug-found.js';
import { verificationOf } from '../telemetry/verification-of.js';
import { asString } from './tools-helpers.js';
import { ReticleTool } from './tool-names.js';
import { takeFeedbackPrompt } from './feedback-tools.js';
import type { Session } from '../session/session.js';
import { span } from '../trace.js';
import type { ToolDef, ToolDeps } from './tools.js';

/**
 * The live-session tools whose result MUST carry the
 * session-health envelope. Owned in ONE place — not retrofitted per handler — so a throttled tab
 * can never return a healthy-looking result from any of these. `runTool` is the single choke point
 * (mcp.ts + tool-invoker.ts) that splices health on; the guard test asserts the set is exhaustive.
 */
/**
 * Tools that DRIVE the page. An action with no verdict after it is the signature of the loop
 * breaking mid-task — see `abandonedActions`. `act_and_wait` is one of these AND a verification, so
 * it settles its own action, which is exactly right: it is the tool that does both.
 */
const ACTION_TOOLS: ReadonlySet<string> = new Set([
  ReticleTool.ACT,
  ReticleTool.ACT_SEQUENCE,
  ReticleTool.ACT_AND_WAIT,
]);

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
  // Reads the live page as well as the event window, so a throttled tab can make it compare a stale
  // render against fresh data — exactly the case the health envelope exists to disclose.
  ReticleTool.RECONCILE,
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
  // Its sessionId only enriches the report with the tab's runtime/engine, and it must stay callable
  // when NO session exists — "nothing ever connected" is feedback we especially want.
  ReticleTool.FEEDBACK,
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return 'object' === typeof value && value !== null && !Array.isArray(value);
}

/**
 * Emit `verification_completed` when a verification tool produced a verdict.
 *
 * Read off the RESULT here rather than emitted from `decideVerified`, which is where the verdict is
 * actually decided: that function is pure, and the repo's rules keep clocks, IO and side effects out
 * of pure logic for good reason. Reading the result also means all the verification tools are covered
 * by one site instead of N handler edits, and the next one is covered the moment it joins the set.
 *
 * The RULE itself lives in verification-of.ts, because getting it wrong is silent and it feeds the
 * one number shown to investors — see that file for the two ways it was wrong.
 */
function recordVerification(
  toolName: string,
  result: Record<string, unknown>,
  durationMs: number,
): void {
  const verification = verificationOf(toolName, result, durationMs);
  if (verification === undefined) return;
  getSessionMetrics().recordVerification();
  void getTelemetry().emit(TelemetryEventKind.VERIFICATION_COMPLETED, {
    actor: TelemetryActor.AGENT,
    verification,
  });
}

/**
 * Emit one `bug_found` per defect in a tool result, and count it into the session.
 *
 * The outcome metric: everything else measures whether Reticle is used, this measures whether it
 * works. Discrete events rather than only a counter, because the KIND distribution is the argument —
 * "we found 4,000 bugs" is a claim, "1,200 were greens that lied" is evidence.
 */
function reportBugsFound(toolName: string, result: Record<string, unknown>): void {
  const bugs = bugsInResult(toolName, result);
  if (0 === bugs.length) return;
  const metrics = getSessionMetrics();
  for (const bug of bugs) {
    // `recordBug` answers whether this kind is new to the session, which is the only thing that
    // separates "another defect" from "the same defect again". Counting instances as defects is how
    // a published number inflates itself.
    const first = metrics.recordBug(bug.kind);
    void getTelemetry().emit(TelemetryEventKind.BUG_FOUND, {
      actor: TelemetryActor.AGENT,
      bug: { ...bug, repeat: !first },
    });
  }
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
  // used" can be counted. This used to EMIT an event per call; it now increments an in-process counter
  // that leaves once, with the session summary. A verification loop is 50–200 calls, and PostHog bills
  // per event — so the old design made the telemetry bill scale with how hard people used the product,
  // to answer a question the histogram answers better. Counting is also free: no network, no promise,
  // nothing to fail on a tool call's hot path.
  // Started/settled as a pair rather than a bare counter: several agents can be inside runTool at
  // once, so a single "last start" field would attribute one tool's duration to another. The returned
  // closure carries this call's own identity, which is also what makes peak-concurrency measurable.
  // A daemon that has served even one tool call is doing a job for somebody; see daemon-usefulness.
  noteToolCall();
  // An ACTION is what gets abandoned. Counted here, against verifications, so "the agent drove the
  // page and then wandered off" becomes a number instead of an impression.
  if (ACTION_TOOLS.has(tool.name)) getSessionMetrics().recordAction();
  const settleTiming = getSessionMetrics().startToolCall(tool.name, args);
  const startedAt = Date.now();
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

  let raw: unknown;
  try {
    // The one dispatch point every tool call passes through, so it is where the trace's root span
    // belongs: with RETICLE_TRACE on, every stage that runs underneath inherits this call's id and
    // nests under it. Free when off — see trace.ts.
    raw = await span('tool.handler', { tool: tool.name, session: session?.id }, () =>
      tool.handler(deps, args),
    );
  } finally {
    // In a `finally` so a THROWN call still settles: otherwise every failing tool would leak a
    // concurrency slot and peakConcurrentTools would climb forever on an unhealthy session.
    settleTiming(Date.now() - startedAt);
  }
  // The human-feedback ask rides out on the first VERIFICATION that completes — the one moment the
  // experience is fresh and there is something concrete to react to. It is spliced BEFORE the
  // session-bound early return, because two of the four verification tools (flow_verify,
  // verify_change) are session-EXEMPT and would otherwise never carry it.
  if (isPlainObject(raw)) {
    recordVerification(tool.name, raw, Date.now() - startedAt);
    reportBugsFound(tool.name, raw);
  }
  const prompt = isPlainObject(raw) ? takeFeedbackPrompt(tool.name) : undefined;
  // Same one-shot channel as the feedback ask: the agent is mid-task, so anything it would have to go
  // and ASK for is something it will never ask for. Spliced on ANY tool result, not just a
  // verification, because an out-of-date install is worth mentioning whatever the agent is doing.
  const update = isPlainObject(raw) ? takeUpdateNudge() : undefined;
  // Same one-shot channel, for the same reason. Skew was only ever reported in
  // reticle_sessions.versionSkew and a CLI log line — two places an agent driving a flow never
  // looks — so it could work a whole session against a mismatched pair and never learn the one fact
  // that explains the behaviour. It rides out here on whatever tool it happens to be calling.
  const skew = isPlainObject(raw) ? takeVersionSkew() : undefined;
  const result =
    prompt === undefined && update === undefined && skew === undefined
      ? raw
      : {
          ...(raw as object),
          ...(prompt !== undefined ? { feedback_prompt: prompt } : {}),
          ...(update !== undefined ? { update_available: update } : {}),
          ...(skew !== undefined ? { version_skew: skew } : {}),
        };
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
