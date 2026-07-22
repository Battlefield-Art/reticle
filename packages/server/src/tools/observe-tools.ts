/**
 * Observe / wait / assert tools — reticle_observe, reticle_wait_for, reticle_assert, reticle_network,
 * reticle_console, reticle_animations. Split out of tools.ts; assembled back via...OBSERVE_TOOLS.
 */
import { z } from 'zod';
import { ReticleCommand } from '@reticlehq/core';
import { ReticleTool } from './tool-names.js';
import { buildReactionReport } from '../events/reaction.js';
import { evaluatePredicate, waitForPredicate, PredicateSchema } from '../events/predicate.js';
import {
  matchNet,
  matchConsole,
  isConsoleEvent,
  netEmptyHint,
  consoleEmptyHint,
  reconcileNet,
  projectNetCall,
  projectConsoleLog,
} from '../events/event-filters.js';
import { applyEventBudget, costHint, withSizeCost } from '../session/output-budget.js';
import { healthEnvelope, bufferEnvelope } from '../session/session-health.js';
import type { Session } from '../session/session.js';
import { isPresenceOnlyAssertion, PRESENCE_ONLY_ADVICE } from './assert-grade.js';
import { withControl } from '../session/control-envelope.js';
import { asString, asNumber } from './tools-helpers.js';
import { type ToolDef, sessionIdShape, commandOrThrow } from './tool-kit.js';

/**
 * Evidence-completeness block: present on observe/network/console only when the ring buffer has
 * evicted events, so a "no such event" answer is distinguishable from "I dropped it" (issue #27).
 */
const bufferOutputShape = {
  buffer: z
    .object({ held: z.number(), dropped: z.number(), note: z.string() })
    .optional()
    .describe(
      'Present only when the event buffer evicted events — a negative result may then be a false negative.',
    ),
};

/**
 * Where to look when a failure has no element.
 *
 * "the signal never fired", "the request was never made", "the store did not change" have no DOM node
 * to map to a component, so the file:line that covers element failures leaves exactly the failures
 * that most need explaining with nowhere to send the agent. The handler that should have fired the
 * signal lives with the control that was clicked, and the act path captured that control's source —
 * so a failing assertion can point there instead of at nothing.
 *
 * RED only: on a pass this is noise on the path the agent walks most.
 */
function lastActSourceOnFailure(session: Session, pass: boolean): { source?: string } {
  if (pass) return {};
  const source = session.lastActSource();
  return source === undefined ? {} : { source };
}

export const OBSERVE_TOOLS: ToolDef[] = [
  {
    name: ReticleTool.OBSERVE,
    description:
      'Return the timeline of everything the app did in a window (DOM/network/route/console/animation/signal), with a summary. Use after an action. Pass `max_events` to cap the timeline to the most recent N (older events are dropped and counted in cost.droppedOldest). Every result carries a `cost:{events,bytes}` hint so you can self-budget your next call.',
    inputSchema: {
      window_ms: z
        .number()
        .optional()
        .describe('Time window to look back. Default: 2000ms. Ignored when `since` is provided.'),
      since: z
        .number()
        .optional()
        .describe(
          'Cursor from a prior reticle_act or reticle_observe call. Scopes the event window to exactly that span.',
        ),
      until: z
        .number()
        .optional()
        .describe('Upper cursor bound. With `since`, returns the span "between action A and B".'),
      actionId: z
        .string()
        .optional()
        .describe('Keep only events attributed to this action — answers "what did action N cause".'),
      filters: z
        .array(z.string())
        .optional()
        .describe(
          'Event type allowlist: dom | net | route | console | animation | signal. Omit to return all types.',
        ),
      max_events: z
        .number()
        .optional()
        .describe(
          'Cap the timeline to the most recent N events. Older events are counted in cost.droppedOldest.',
        ),
      ...sessionIdShape,
    },
    outputSchema: {
      events: z.array(z.unknown()),
      summary: z.object({
        total: z.number(),
        network: z.number(),
        domAdded: z.number(),
        domRemoved: z.number(),
        domChanged: z.number(),
        routeChanges: z.number(),
        consoleErrors: z.number(),
        animations: z.number(),
        signals: z.number(),
      }),
      cost: z.object({
        events: z.number(),
        bytes: z.number(),
        droppedOldest: z.number().optional(),
        recommendation: z
          .string()
          .optional()
          .describe(
            'Present when the timeline is large — scope your next call (filters/max_events).',
          ),
      }),
      session: z
        .object({ lastSeenMs: z.number(), throttled: z.boolean(), focused: z.boolean() })
        .optional(),
      ...bufferOutputShape,
    },
    handler: async (deps, args) => {
      const session = deps.sessions.resolve(asString(args['sessionId']));
      const explicitSince = asNumber(args['since']);
      const windowMs = asNumber(args['window_ms']) ?? 2000;
      // Explicit since wins; else look back one window. Journal-backed so it survives buffer eviction.
      const since = explicitSince ?? Math.max(0, session.elapsed() - windowMs);
      const events = await session.queryEvents({
        since,
        until: asNumber(args['until']),
        actionId: asString(args['actionId']),
      });
      const filters = Array.isArray(args['filters']) ? (args['filters'] as string[]) : undefined;
      const filtered =
        filters === undefined ? events : events.filter((e) => filters.includes(e.type));
      // Output budget: cap to the most recent N (no silent caps — droppedOldest is surfaced in cost).
      const { events: budgeted, droppedOldest } = applyEventBudget(
        filtered,
        asNumber(args['max_events']),
      );
      const report = buildReactionReport(budgeted, windowMs);
      // carry session health — a throttled tab means the observed timeline may be incomplete.
      return withControl(session, {
        ...report,
        cost: costHint(report, budgeted.length, droppedOldest),
        ...healthEnvelope(session),
        ...bufferEnvelope(session),
      });
    },
  },
  {
    name: ReticleTool.WAIT_FOR,
    description:
      'Block until a predicate is satisfied (or already true in the recent buffer), else time out. Returns matching evidence or a near-miss diagnosis. By default it only counts events since your last act, so a signal buffered BEFORE the action can never fake a pass; pass `since` (an observe/act cursor) to widen or narrow that window explicitly.',
    inputSchema: {
      predicate: PredicateSchema.describe(
        'Predicate to wait for: { signal }, { net }, { element }, { kind: "state", store, path, equals } (assert a registered store\'s value directly — the source of truth no DOM read can reach; equals takes a literal or { $gte | $contains | $length } pattern), { kind: "settled", quietMs } (deterministic network + DOM idle — prefer this over a fixed sleep), or a combination via allOf/anyOf.',
      ),
      timeout_ms: z.number().optional().describe('Maximum wait in milliseconds. Default: 4000.'),
      since: z
        .number()
        .optional()
        .describe('Cursor from a prior reticle_act — scopes the wait to events after that act.'),
      ...sessionIdShape,
    },
    outputSchema: {
      pass: z.boolean(),
      evidence: z.unknown().optional(),
      failureReason: z.string().optional(),
      session: z
        .object({ lastSeenMs: z.number(), throttled: z.boolean(), focused: z.boolean() })
        .optional(),
      buffer: z
        .object({ held: z.number(), dropped: z.number(), note: z.string() })
        .optional()
        .describe(
          'Present ONLY when the ring buffer evicted events during this window. A passing assertion — especially an absence one — may then be a false negative: the evidence that would have failed it could have been dropped. Absence of this block means the buffer was intact and the verdict is trustworthy.',
        ),
      observed: z
        .string()
        .optional()
        .describe('What was actually seen — the structured half of failureReason, for the agent rather than a log.'),
      expected: z.string().optional().describe('What the oracle required.'),
      assertion: z
        .string()
        .optional()
        .describe('Which oracle judged it, e.g. element.state — lets an agent branch on the failure KIND without parsing prose.'),
      source: z
        .string()
        .optional()
        .describe(
          'On a FAILING assertion, the `file:line` of the control last acted on — where the code that should have produced the missing signal/request/state change lives. Present only when an act preceded this assertion.',
        ),
    },
    handler: async (deps, args) => {
      const session = deps.sessions.resolve(asString(args['sessionId']));
      const predicate = PredicateSchema.parse(args['predicate']);
      // Honesty: explicit since wins; else default to the last act's cursor; else the whole buffer.
      const since = asNumber(args['since']) ?? session.lastActCursor() ?? 0;
      const verdict = await waitForPredicate(
        session,
        predicate,
        asNumber(args['timeout_ms']) ?? 4000,
        since,
      );
      // match reticle_assert — wrap with control + session health (throttle matters most while blocking)
      // and the buffer envelope, so a verdict reached over an evicted window says so.
      return withControl(session, {
        ...verdict,
        ...lastActSourceOnFailure(session, verdict.pass),
        ...healthEnvelope(session),
        ...bufferEnvelope(session),
      });
    },
  },
  {
    name: ReticleTool.ASSERT,
    description:
      'Evaluate a predicate (optionally waiting up to timeout_ms). Returns { pass, evidence, failureReason? }. The end of every verify loop. Prefer a { signal } or { net } consequence over { element }/{ text } presence — a passing presence-only assertion returns `advice` because a wrong/healed element can fake it. By default it only counts events since your last act, so a stale buffered signal can never fake a pass; pass `since` (an observe/act cursor) to set the window explicitly.',
    inputSchema: {
      predicate: PredicateSchema.describe(
        'Predicate to evaluate: { signal }, { net }, { element } or a combination.',
      ),
      timeout_ms: z
        .number()
        .optional()
        .describe(
          'If > 0, wait up to this many milliseconds before failing. Default: 0 (evaluate once).',
        ),
      since: z
        .number()
        .optional()
        .describe(
          'Cursor from a prior reticle_act — scopes the assertion to events after that act.',
        ),
      ...sessionIdShape,
    },
    outputSchema: {
      pass: z.boolean(),
      evidence: z.unknown().optional(),
      failureReason: z.string().optional(),
      advice: z
        .string()
        .optional()
        .describe('Present on a PASSING presence-only assertion — nudges toward a consequence.'),
      observed: z
        .string()
        .optional()
        .describe('What was actually seen — the structured half of failureReason, for the agent rather than a log.'),
      expected: z.string().optional().describe('What the oracle required.'),
      assertion: z
        .string()
        .optional()
        .describe('Which oracle judged it, e.g. element.state — lets an agent branch on the failure KIND without parsing prose.'),
      session: z
        .object({ lastSeenMs: z.number(), throttled: z.boolean(), focused: z.boolean() })
        .optional(),
      buffer: z
        .object({ held: z.number(), dropped: z.number(), note: z.string() })
        .optional()
        .describe(
          'Present ONLY when the ring buffer evicted events during this window. A passing assertion — especially an absence one — may then be a false negative: the evidence that would have failed it could have been dropped. Absence of this block means the buffer was intact and the verdict is trustworthy.',
        ),
      source: z
        .string()
        .optional()
        .describe(
          'On a FAILING assertion, the `file:line` of the control last acted on — where the code that should have produced the missing signal/request/state change lives. Present only when an act preceded this assertion.',
        ),
    },
    handler: async (deps, args) => {
      const session = deps.sessions.resolve(asString(args['sessionId']));
      const predicate = PredicateSchema.parse(args['predicate']);
      const timeout = asNumber(args['timeout_ms']) ?? 0;
      // Honesty: explicit since wins; else default to the last act's cursor; else the whole buffer.
      const since = asNumber(args['since']) ?? session.lastActCursor() ?? 0;
      const verdict =
        timeout > 0
          ? await waitForPredicate(session, predicate, timeout, since)
          : await evaluatePredicate(session, predicate, since);
      // A GREEN presence-only assertion is the dangerous case (a wrong element can fake it) — nudge
      // toward a consequence. Never on a failing verdict (moot) or when a signal/net is asserted.
      const advice =
        verdict.pass && isPresenceOnlyAssertion(predicate) ? { advice: PRESENCE_ONLY_ADVICE } : {};
      // A verdict reached over an evicted buffer can be a FALSE NEGATIVE: "no console error" may
      // simply mean the error aged out. reticle_console has always disclosed this on the same window;
      // the verdict path — the one an agent actually gates on — did not. Omitted when nothing dropped.
      return withControl(session, {
        ...verdict,
        ...advice,
        ...lastActSourceOnFailure(session, verdict.pass),
        ...healthEnvelope(session),
        ...bufferEnvelope(session),
      });
    },
  },
  {
    name: ReticleTool.NETWORK,
    description:
      'Filtered list of network calls. Fast path for "did POST /x return 200?". A zero-match filter returns a `hint` { totalInWindow, present[] } of the calls that DID fire, so a miss is diagnosable.',
    inputSchema: {
      since: z
        .number()
        .optional()
        .describe(
          'Cursor from a prior reticle_act — scopes the query to requests fired after that act.',
        ),
      until: z.number().optional().describe('Upper cursor bound — with `since`, the span between two acts.'),
      actionId: z
        .string()
        .optional()
        .describe('Keep only requests attributed to this action — "what did action N request".'),
      method: z
        .string()
        .optional()
        .describe('HTTP method filter: GET | POST | PUT | DELETE | PATCH etc.'),
      urlContains: z.string().optional().describe('Substring that the request URL must contain.'),
      status: z.number().optional().describe('HTTP status code filter (e.g. 200, 404, 500).'),
      limit: z
        .number()
        .optional()
        .describe(
          'Keep only the most recent N matching calls (older are dropped and counted in droppedOldest) — cuts tokens on a wide window.',
        ),
      ...sessionIdShape,
    },
    outputSchema: {
      calls: z.array(z.unknown()),
      total: z
        .number()
        .optional()
        .describe('Total matches before `limit` — present only when capped.'),
      droppedOldest: z.number().optional().describe('How many older matches `limit` dropped.'),
      hint: z.object({ totalInWindow: z.number(), present: z.array(z.string()) }).optional(),
      cost: z.object({ bytes: z.number(), tokens: z.number() }).optional(),
      ...bufferOutputShape,
    },
    handler: async (deps, args) => {
      const session = deps.sessions.resolve(asString(args['sessionId']));
      const since = asNumber(args['since']) ?? 0;
      const method = asString(args['method']);
      const urlContains = asString(args['urlContains']);
      const status = asNumber(args['status']);
      const limit = asNumber(args['limit']);
      const buffer = bufferEnvelope(session);
      // Completed calls + unresolved in-flight requests (a hung request shows as pending).
      const allNet = reconcileNet(
        await session.queryEvents({
          since,
          until: asNumber(args['until']),
          actionId: asString(args['actionId']),
        }),
      );
      const matched = allNet.filter((e) => matchNet(e, method, urlContains, status));
      // zero-match filter returns what DID fire, not a bare [].
      if (matched.length === 0 && allNet.length > 0) {
        return withSizeCost({ calls: matched, hint: netEmptyHint(allNet), ...buffer });
      }
      const { events: budgeted, droppedOldest } = applyEventBudget(matched, limit);
      const calls = budgeted.map(projectNetCall);
      return withSizeCost(
        droppedOldest > 0
          ? { calls, total: matched.length, droppedOldest, ...buffer }
          : { calls, ...buffer },
      );
    },
  },
  {
    name: ReticleTool.CONSOLE,
    description:
      'Console/error log. Fast path for "were there any errors during this flow?". When a level filter matches nothing, returns a `hint` { totalInWindow, byLevel } so 0 errors is distinguishable from a silent page.',
    inputSchema: {
      level: z
        .string()
        .optional()
        .describe('Log level filter: error | warn | info | log. Omit to return all levels.'),
      since: z
        .number()
        .optional()
        .describe(
          'Cursor from a prior reticle_act — scopes the query to log entries after that act.',
        ),
      until: z.number().optional().describe('Upper cursor bound — with `since`, the span between two acts.'),
      actionId: z
        .string()
        .optional()
        .describe('Keep only log entries attributed to this action — "what did action N log".'),
      limit: z
        .number()
        .optional()
        .describe(
          'Keep only the most recent N matching entries (older are dropped and counted in droppedOldest) — cuts tokens when a page spams the console.',
        ),
      ...sessionIdShape,
    },
    outputSchema: {
      logs: z.array(z.unknown()),
      total: z
        .number()
        .optional()
        .describe('Total matches before `limit` — present only when capped.'),
      droppedOldest: z.number().optional().describe('How many older matches `limit` dropped.'),
      hint: z.object({ totalInWindow: z.number(), byLevel: z.record(z.number()) }).optional(),
      cost: z.object({ bytes: z.number(), tokens: z.number() }).optional(),
      ...bufferOutputShape,
    },
    handler: async (deps, args) => {
      const session = deps.sessions.resolve(asString(args['sessionId']));
      const since = asNumber(args['since']) ?? 0;
      const level = asString(args['level']);
      const limit = asNumber(args['limit']);
      const buffer = bufferEnvelope(session);
      const allConsole = (
        await session.queryEvents({
          since,
          until: asNumber(args['until']),
          actionId: asString(args['actionId']),
        })
      ).filter(isConsoleEvent);
      const matched = allConsole.filter((e) => matchConsole(e, level));
      // zero matches at this level → report what levels ARE present (not a bare []).
      if (matched.length === 0 && allConsole.length > 0) {
        return withSizeCost({ logs: matched, hint: consoleEmptyHint(allConsole), ...buffer });
      }
      const { events: budgeted, droppedOldest } = applyEventBudget(matched, limit);
      const logs = budgeted.map(projectConsoleLog);
      return withSizeCost(
        droppedOldest > 0
          ? { logs, total: matched.length, droppedOldest, ...buffer }
          : { logs, ...buffer },
      );
    },
  },
  {
    name: ReticleTool.ANIMATIONS,
    description: 'Currently running + recently completed animations with targets/timing.',
    inputSchema: { ...sessionIdShape },
    outputSchema: {
      animations: z.array(z.unknown()),
    },
    handler: (deps, args) =>
      commandOrThrow(deps, asString(args['sessionId']), ReticleCommand.ANIMATIONS, {}),
  },
];
