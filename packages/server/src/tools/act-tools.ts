/**
 * Action tools — reticle_act, reticle_act_sequence, reticle_act_and_wait — plus the native-input machinery
 * (asBox / tryRealInput). Split out of tools.ts to keep that file under the line cap; assembled back
 * into the tool list there via...ACT_TOOLS.
 */
import { z } from 'zod';
import { captureAct, compileSequenceStep } from '../flows/replay.js';
import {
  ActionType,
  ActionWarning,
  DEFAULT_ASSERT_TIMEOUT_MS,
  InputMode,
  InputModeReason,
  ReticleCommand,
} from '@reticlehq/core';
import type { Session } from '../session/session.js';
import type { ElementBox, RealInputArgs } from '../input/real-input.js';
import { isPointerAction } from '../input/real-input.js';
import { leanActResult, mutatedWithin } from './act-view.js';
import { ReticleTool } from './tool-names.js';
import { buildReactionReport, summarizeReaction } from '../events/reaction.js';
import { causalSummary } from '../capsule/causal-summary.js';
import { findContradictions } from '../events/contradictions.js';
import { decideVerified } from '../honesty/verified.js';
import { saveFailedAssertCapsule } from './act-capsule.js';
import { buildDivergenceCapsule } from '../capsule/capsule.js';
import { predicateToExpectedLinks } from '../capsule/predicate-to-links.js';
import { buildHonestyBlock } from '../honesty/honesty.js';
import {
  buildCoverageStatement,
  blindSpotsFromState,
  impeachesCapture,
} from '../honesty/blind-spots.js';
import { hasAcceptedWrite } from '../honesty/accepted-write.js';
import { hasUnreadWriteOutcome } from '../honesty/unread-outcome.js';
import { assertDragNotDestructive, assertNotDestructive } from './act-danger.js';
import {
  evaluatePredicate,
  waitForPredicate,
  provenExpectedLinks,
  PredicateSchema,
} from '../events/predicate.js';
import { healthEnvelope, refuseIfThrottled } from '../session/session-health.js';
import { pausedShortCircuit, pausedOutputShape, withControl } from '../session/control-envelope.js';
import { asString, asNumber, asRecord, sourceOf } from './tools-helpers.js';
import { type ToolDef, type ToolDeps, sessionIdShape, commandOrThrow } from './tool-kit.js';
import { asActionType, asBox, gradeOf } from './act-helpers.js';

interface RealActResult {
  /** Defined only on a successful native action; `undefined` means the synthetic path runs. */
  result: unknown;
  settled: boolean;
  /** Set when a provider was available but threw — surfaces the fallback to the agent. */
  fellBack?: boolean;
  /** Why we went synthetic despite a configured provider (field bug #2: never a silent fallback). */
  reason?: InputModeReason;
}

/** Synthetic outcome with a diagnostic reason (provider configured but native input skipped). */
function synthetic(reason?: InputModeReason): RealActResult {
  return reason === undefined
    ? { result: undefined, settled: false }
    : { result: undefined, settled: false, reason };
}

/**
 * Attempt to drive a pointer action via native input. Returns a synthetic outcome (with a
 * `reason` when a provider is configured) whenever the synthetic path should run — no matching
 * page, unresolvable box, declined, etc. A throw inside the provider becomes a synthetic fallback
 * flagged with `fellBack`. `result` is defined only on a real success.
 */
async function tryRealInput(
  deps: ToolDeps,
  session: Session,
  ref: string,
  action: ActionType,
  args: Record<string, unknown>,
): Promise<RealActResult> {
  const provider = deps.realInput;
  if (provider === undefined) return synthetic(); // real input not configured — no diagnostic
  if (!isPointerAction(action)) return synthetic(InputModeReason.NOT_POINTER); // fill/type stay synthetic

  const inner = asRecord(args['args']);
  // "Don't click, run the code": a click/dblclick runs the occlusion-honest SYNTHETIC path by default
  // even with a provider configured — no coordinate gesture to be intercepted by the HUD or missed
  // off-screen. Opt into a trusted native click with args.native:true (file pickers, clipboard,
  // isTrusted-gated handlers). hover/drag genuinely need native pointer state, so they stay real.
  if ((action === ActionType.CLICK || action === ActionType.DBLCLICK) && inner['native'] !== true) {
    return synthetic(InputModeReason.SYNTHETIC_CLICK_PREFERRED);
  }

  if (!(await provider.isAvailableFor(session.url)))
    return synthetic(InputModeReason.PAGE_NOT_CORRELATED);

  const inspected = await commandOrThrow(deps, session.id, ReticleCommand.INSPECT, { ref });
  assertNotDestructive(action, inner, inspected);
  const box = asBox(inspected);
  if (box === undefined) return synthetic(InputModeReason.ELEMENT_NOT_LOCATABLE);

  let toBox: ElementBox | undefined;
  if (action === ActionType.DRAG) {
    const toRef = asString(inner['toRef']);
    if (toRef === undefined) return synthetic(InputModeReason.DRAG_TARGET_UNRESOLVED);
    const targetInspected = await commandOrThrow(deps, session.id, ReticleCommand.INSPECT, {
      ref: toRef,
    });
    // A drag is judged on BOTH ends: dropping onto "Trash" is destructive however innocent the
    // thing being dragged looks.
    assertDragNotDestructive(inner, inspected, targetInspected);
    toBox = asBox(targetInspected);
    if (toBox === undefined) return synthetic(InputModeReason.DRAG_TARGET_UNRESOLVED);
  }

  const performArgs: RealInputArgs = {};
  const value = asString(inner['value']);
  if (value !== undefined) performArgs.value = value;
  const text = asString(inner['text']);
  if (text !== undefined) performArgs.text = text;
  if (toBox !== undefined) performArgs.toBox = toBox;

  try {
    const performed = await provider.perform(session.url, action, box, performArgs);
    if (!performed.performed) return synthetic(InputModeReason.PROVIDER_DECLINED);
    return { result: { performed: true, center: performed.center, action }, settled: true };
  } catch {
    return {
      result: undefined,
      settled: false,
      fellBack: true,
      reason: InputModeReason.PROVIDER_ERROR,
    };
  }
}

/**
 * Narrow the wire's `action` to a real ActionType, or undefined.
 *
 * It used to be `asString(args['action']) ?? ''`, so an unknown or missing action became the empty
 * string and travelled on — reaching the browser as a command it could not perform, and reported back
 * as a generic failure rather than "that is not an action". Validate at the boundary, per the project's
 * unknown-plus-narrowing rule, so a typo is rejected where it can still be explained.
 */

export const ACT_TOOLS: ToolDef[] = [
  {
    name: ReticleTool.ACT,
    example: { ref: 'e42', action: 'fill', args: { value: 'hello' } },
    description:
      'Execute one action against a ref: click|dblclick|hover|focus|fill|type|clear|select|check|uncheck|submit|press|scrollIntoView. Returns immediately with a `since` cursor — observe the reaction with reticle_observe. Carries effect:{dispatched,targetMatched,visible,enabled,focusMoved,valueChanged,domMutatedWithin,occluded,occludedBy,scrolledIntoView} to tell "action missed" from "app didn\'t react"; dispatched=landed, settled=a real frame flushed, and a settle timeout never fails the tool. Fields at their uninformative default are OMITTED so a clean action collapses to its consequence: an absent dispatched/targetMatched/visible/enabled means true, an absent occluded/scrolledIntoView/valueChanged/defaultPrevented means false, an absent focusMoved/occludedBy means null. occluded=true means the click point is covered by another element (a real user could not click it) — synthetic dispatch still delivered the event; scrolledIntoView=true means an off-viewport target was scrolled in first. inputMode is "real" (native CDP, no synthetic effect block) or "synthetic"; clicks default to the occlusion-honest synthetic path even when CDP is configured — pass args.native:true to force a trusted native click (file pickers, clipboard). inputModeReason explains any real→synthetic choice so it is never silent. Full model (real-input, throttled tabs, `reticle drive`): docs/usage.md §18.',
    inputSchema: {
      ref: z
        .string()
        .describe(
          `Element ref (e.g. 'e42') from reticle_snapshot/reticle_query — stable until the element leaves the DOM, so no re-snapshot between actions.`,
        ),
      action: z
        .string()
        .describe(
          'Action to perform: click | dblclick | hover | focus | fill | type | clear | select | check | uncheck | submit | press | scrollIntoView',
        ),
      args: z
        .record(z.unknown())
        .optional()
        .describe(
          'Action-specific arguments: { value } for fill/select, { text } for type/press, { native: true } to force a trusted native click, { confirmDangerous: true } to allow a potentially destructive control.',
        ),
      refuseWhenThrottled: z
        .boolean()
        .optional()
        .describe(
          'Throw instead of silently sending synthetic events when the tab is throttled/backgrounded. Default: false (synthetic events are still sent).',
        ),
      ...sessionIdShape,
    },
    outputSchema: {
      since: z
        .number()
        .describe(
          'Cursor — pass to reticle_observe/reticle_wait_for/reticle_assert to scope reaction queries to this act.',
        ),
      dispatched: z.boolean(),
      settled: z.boolean().nullable(),
      inputMode: z.string(),
      // Diagnostic fields the handler splices — declared so schema-strict clients keep them.
      effect: z.unknown().optional(),
      settleReason: z.unknown().nullable().optional(),
      inputModeReason: z.string().optional(),
      warning: z.string().optional(),
      result: z.unknown().optional(),
      session: z
        .object({ lastSeenMs: z.number(), throttled: z.boolean(), focused: z.boolean() })
        .optional(),
      // This tool short-circuits to pausedShortCircuit while the human has paused; declare its fields
      // or the whole pause payload — including drained-once guidance — is stripped on validating clients.
      ...pausedOutputShape,
    },
    handler: async (deps, args) => {
      // Validate the REQUEST before touching a session: a malformed action is the caller's error and
      // should be reported as such, not after resolving a session and marking an act cursor.
      const action = asActionType(args['action']);
      if (action === undefined) {
        throw new Error(
          `unknown action '${String(args['action'])}' — expected one of: ${Object.values(ActionType).join(', ')}`,
        );
      }
      const session = deps.sessions.resolve(asString(args['sessionId']));
      // Live-control: refuse to drive the page while the human has paused us (before any work).
      const paused = pausedShortCircuit(session);
      if (paused !== undefined) return paused;
      refuseIfThrottled(session, args['refuseWhenThrottled']);
      const since = session.elapsed();
      session.lastAct.markCursor(since); // honesty: wait_for/assert default their floor to this cursor
      // Cleared up front: a throw between here and the result must not leave the PREVIOUS act's
      // measurement standing, which would judge this window with the last one's evidence.
      session.lastAct.markEffect(asString(args['action']), undefined);
      const ref = asString(args['ref']) ?? '';

      // Open the journal's action-attribution window BEFORE dispatching, so it covers the native path
      // too. It used to open only on the synthetic path, and the native path returned above it — so a
      // hover, a drag or any native:true click produced events with no actionId. Session.pushEvent
      // treats an unattributed ref-bearing event as ambient background churn, so an action's OWN
      // effects were learned as noise; past the ambient threshold the settle oracle then filtered that
      // region out entirely and reported settled while the app was still working. A false green
      // manufactured by the machinery that exists to prevent false greens.
      session.beginAction(ReticleTool.ACT, asRecord(args));
      let settledOutcome: boolean | undefined;
      try {
        // drive native pointer input when a provider is available; otherwise fall back.
        const real = await tryRealInput(deps, session, ref, action, args);
        if (real.result !== undefined) {
          captureAct(deps.recordings, args, real.result);
          settledOutcome = real.settled ?? undefined;
          return withControl(session, {
            since,
            inputMode: InputMode.REAL,
            dispatched: true,
            settled: real.settled,
            settleReason: null,
            result: leanActResult(real.result),
            ...healthEnvelope(session),
          });
        }

        const result = await session.command(ReticleCommand.ACT, {
          ref: args['ref'],
          action: args['action'],
          args: args['args'] ?? {},
        });
        if (!result.ok) throw new Error(result.error ?? 'act failed');
        captureAct(deps.recordings, args, result.result);
        // lift dispatch/settle status to the envelope (a settle timeout is NOT a failure).
        const r = asRecord(result.result);
        if (typeof r['settled'] === 'boolean') settledOutcome = r['settled'];
        // Keep what only this call measured, so the observe that judges this window can ask whether
        // anything happened INSIDE the target — the one fact that separates a dead control from a
        // page that was merely busy with something else.
        session.lastAct.markEffect(asString(args['action']), mutatedWithin(r));
        return withControl(session, {
          since,
          inputMode: InputMode.SYNTHETIC,
          // #2: never a silent real→synthetic fallback — say WHY (unless real input isn't configured).
          ...(real.reason !== undefined ? { inputModeReason: real.reason } : {}),
          dispatched: r['dispatched'] ?? true,
          settled: r['settled'] ?? null,
          settleReason: r['settleReason'] ?? null,
          result: leanActResult(result.result),
          ...(real.fellBack === true ? { warning: ActionWarning.REAL_INPUT_FELL_BACK } : {}),
          ...healthEnvelope(session),
        });
      } finally {
        // Close the window on every exit (settle or throw), recording the action + settle outcome.
        session.finishAction(
          undefined,
          settledOutcome,
          settledOutcome === true ? session.elapsed() - since : undefined,
        );
      }
    },
  },
  {
    name: ReticleTool.ACT_SEQUENCE,
    description:
      'Run multiple actions in order (fill -> fill -> submit) in one round-trip. Returns per-step effects[] (see reticle_act).',
    inputSchema: {
      steps: z
        .array(z.record(z.unknown()))
        .describe(
          'Ordered list of { ref, action, args? } objects. Each step is equivalent to one reticle_act call; put confirmDangerous:true in a destructive step args object.',
        ),
      ...sessionIdShape,
    },
    outputSchema: {
      since: z.number(),
      dispatched: z.boolean(),
      result: z.unknown().optional(),
      session: z
        .object({ lastSeenMs: z.number(), throttled: z.boolean(), focused: z.boolean() })
        .optional(),
      // Short-circuits to pausedShortCircuit while paused — declare its fields (drained-once guidance).
      ...pausedOutputShape,
    },
    handler: async (deps, args) => {
      const session = deps.sessions.resolve(asString(args['sessionId']));
      // Live-control: refuse to drive the page while the human has paused us (before any work).
      const paused = pausedShortCircuit(session);
      if (paused !== undefined) return paused;
      const since = session.elapsed();
      session.lastAct.markCursor(since); // honesty: a later wait_for/assert floors at this cursor
      session.beginAction(ReticleTool.ACT_SEQUENCE, asRecord(args));
      try {
        const result = await session.command(ReticleCommand.ACT_SEQUENCE, { steps: args['steps'] });
        if (!result.ok) throw new Error(result.error ?? 'act_sequence failed');
        if (deps.recordings.active().length > 0) {
          deps.recordings.capture(compileSequenceStep(args, result.result));
        }
        const r = asRecord(result.result); // per-step settle status lives in result.steps[]
        return withControl(session, {
          since,
          dispatched: r['count'] !== undefined,
          result: leanActResult(result.result),
          ...healthEnvelope(session),
        });
      } finally {
        // Per-step settle lives in steps[]; the sequence action records without a single settle bool.
        session.finishAction();
      }
    },
  },
  {
    name: ReticleTool.ACT_AND_WAIT,
    example: { ref: 'e42', action: 'click', until: { kind: 'signal', name: 'todos:loaded' } },
    description:
      'Act on a ref, then wait for a predicate to hold — one hop for the act->observe->assert loop. ' +
      'Omit `until` to wait for the page to settle (network + DOM idle) — use this instead of a fixed sleep. ' +
      'Returns { effect } (the action result), { verdict } (predicate pass/evidence/near-miss), ' +
      '{ trace } (a digest — window_ms + summary counts of what the app did), and { since } (the act ' +
      'cursor; pass it to reticle_observe for the full per-event timeline when the counts are not enough). ' +
      'timeout_ms 0 evaluates the predicate once without waiting.',
    inputSchema: {
      ref: z
        .string()
        .describe(
          `Element ref (e.g. 'e42') from reticle_snapshot/reticle_query — stable until the element leaves the DOM, so no re-snapshot between actions.`,
        ),
      action: z
        .string()
        .describe(
          'Action to perform: click | dblclick | hover | focus | fill | type | clear | select | check | uncheck | submit | press | scrollIntoView',
        ),
      args: z
        .record(z.unknown())
        .optional()
        .describe(
          'Action-specific arguments: { value } for fill/select, { text } for type/press, { confirmDangerous: true } for a potentially destructive control.',
        ),
      until: PredicateSchema.optional().describe(
        'Predicate to wait for after the action completes (same shape as reticle_assert). OMIT to wait for the page to SETTLE — network + DOM idle — the deterministic default instead of a sleep. To assert a consequence AND settle, allOf them: { kind: "allOf", predicates: [<your predicate>, { kind: "settled" }] }.',
      ),
      timeout_ms: z
        .number()
        .optional()
        .describe(
          'Maximum wait time in milliseconds. 0 = evaluate once without waiting. Default: 4000.',
        ),
      refuseWhenThrottled: z
        .boolean()
        .optional()
        .describe('Throw if the tab is throttled. Default: false.'),
      ...sessionIdShape,
    },
    outputSchema: {
      effect: z
        .unknown()
        .describe('The reticle_act result (dispatched, settled, inputMode, etc.).'),
      verdict: z.object({
        pass: z.boolean(),
        evidence: z.unknown().optional(),
        failureReason: z.string().optional(),
        // The STRUCTURED cause — observed / expected / assertion — is what the repair literature ranks
        // above the prose failureReason (structured feedback beat narrative by 10.5pp) and above a bare
        // pointer. `verdict` is `await waitForPredicate(...)`, whose EvalResult carries these on a
        // failure; without declaring them here the strict object schema silently dropped them from
        // structuredContent on the validating `full` profile — reticle_assert declares them (it spreads
        // the verdict at top level), so act_and_wait was losing the highest-value signal that assert kept.
        observed: z.string().optional(),
        expected: z.string().optional(),
        assertion: z.string().optional(),
      }),
      trace: z
        .unknown()
        .describe(
          'Reaction digest: { window_ms, summary } of what the app did (DOM/network/route/console/signal counts). The full per-event timeline is one reticle_observe { since } away.',
        ),
      summary: z
        .unknown()
        .describe(
          'Bounded causal summary: net {total,errors,headline}, consoleErrors, statePathsChanged, storageKeysChanged, stateDiffs [{path,from,to}], storageDiffs [{key,from,to}], route, signals, layoutShift, longTasks — real before→after diffs (capped), not just readings.',
        ),
      // Promoted out of `effect` on RED only — the file:line the failure came from, the first thing a
      // repair wants. Undeclared, it was stripped on the validating profile exactly like the structured
      // cause above was, losing the highest-value pointer on the one path (a failed verdict) that has it.
      source: z
        .string()
        .optional()
        .describe('Present only on a FAILED verdict: `file:line` of the acted element.'),
      capsule: z
        .unknown()
        .optional()
        .describe(
          'Present only on a FAILED verdict: the divergence capsule { summary, firstDivergence (declared vs observed), blastRadius (undeclared side effects) } — the fault, located, no re-exploration needed.',
        ),
      capsuleSaved: z
        .string()
        .optional()
        .describe(
          'Present only on a FAILED verdict when the fail-to-pass capsule was persisted: its id, replayable as a regression flow once the bug goes green.',
        ),
      verified: z
        .string()
        .describe(
          'THE field to gate on: "yes" | "no" | "unknown". Read this first and read `because` for the reason. "unknown" is NOT failure — it means the evidence could not decide (dirty capture, nothing asserted at a real grade, or the page never settled), which calls for a better check rather than a code change. Everything else on this result is the evidence this was derived from.',
        ),
      because: z.string().describe('One sentence naming the deciding evidence behind `verified`.'),
      contradictions: z
        .array(z.unknown())
        .optional()
        .describe(
          'Channels that DISAGREE about this action — the UI advanced while its write failed, a success signal fired over a failed request, a response changed nothing, a duplicate fired, a request never settled. OMITTED when clean. Treat any entry as a finding even when the verdict is green: a passing assertion and a contradicted channel is exactly the false green this exists to catch.',
        ),
      honesty: z
        .unknown()
        .describe(
          'The verdict trust block { grade, attribution, coverage, integrity, envelope? } — a green never looks stronger than this. Gate on grade ≥ net AND integrity.clean. Fields that were not measured are OMITTED rather than reported as zero, so treat an absent `envelope` as "not sampled", never as a failure.',
        ),
      since: z
        .number()
        .describe(
          'Cursor for this act — pass to reticle_observe/reticle_assert for the full timeline.',
        ),
      session: z
        .object({ lastSeenMs: z.number(), throttled: z.boolean(), focused: z.boolean() })
        .optional(),
      // Short-circuits to pausedShortCircuit while paused — declare its fields (drained-once guidance).
      ...pausedOutputShape,
    },
    handler: async (deps, args) => {
      const session = deps.sessions.resolve(asString(args['sessionId']));
      // Live-control: refuse to drive the page (no act, no predicate eval) while paused.
      const paused = pausedShortCircuit(session);
      if (paused !== undefined) return paused;
      refuseIfThrottled(session, args['refuseWhenThrottled']);
      // Omitting `until` waits for the page to settle (idle) — the deterministic default vs a sleep.
      const until =
        args['until'] !== undefined
          ? PredicateSchema.parse(args['until'])
          : ({ kind: 'settled' } as const);
      const timeout = asNumber(args['timeout_ms']) ?? DEFAULT_ASSERT_TIMEOUT_MS;

      const since = session.elapsed();
      // `dropped` is cumulative for the SESSION, so comparing against a pre-action reading is what
      // asks "did the buffer lose anything while THIS action was observed?" — the question the
      // honesty block means. Reading the raw total pinned every later verdict to `unknown` after a
      // single early eviction (measured on the Next.js demo at dropped:51, windows intact).
      const droppedBefore = session.bufferHealth().dropped;
      session.lastAct.markCursor(since);
      // The attribution window stays open across the settle wait below, so post-dispatch async events
      // (the whole point of act_and_wait) attribute to this action. finishAction fires after the wait.
      session.beginAction(ReticleTool.ACT_AND_WAIT, asRecord(args));
      let settledOutcome: boolean | undefined;
      try {
        const actResult = await session.command(ReticleCommand.ACT, {
          ref: args['ref'],
          action: args['action'],
          args: args['args'] ?? {},
        });
        if (!actResult.ok) throw new Error(actResult.error ?? 'act failed');
        captureAct(deps.recordings, args, actResult.result);

        // Honesty: floor the predicate at this act's cursor so a stale buffered event can't satisfy it.
        const verdict =
          timeout > 0
            ? await waitForPredicate(session, until, timeout, since)
            : await evaluatePredicate(session, until, since);

        const r = asRecord(actResult.result);
        if (typeof r['settled'] === 'boolean') settledOutcome = r['settled'];
        // Where the acted element is written. Captured at act time alongside the anchor, so it is
        // available even when the action unmounted its own target.
        const actedSource = sourceOf(r['source']);
        // Remembered on the session so a LATER assertion can name a file even when its failure has no
        // element to point at — a signal that never fired, a request that was never made.
        session.lastAct.markSource(
          actedSource === undefined ? undefined : `${actedSource.file}:${String(actedSource.line)}`,
        );
        const windowEvents = session.eventsSince(since);
        const trace = summarizeReaction(
          buildReactionReport(windowEvents, session.elapsed() - since),
        );
        // The bounded Tier-1 causal summary — net/console/state/storage diffs the trace's counts miss.
        // ponytail: Layer B validation of this result-shape change is pending — additive + bounded.
        // On RED only, attach the Tier-2 divergence capsule (first-divergence + blast radius). Red-only,
        // so the common green path — what the loop optimizes — is unchanged; on red, diagnosis is the point.
        const links = predicateToExpectedLinks(until);
        const capsule = verdict.pass ? undefined : buildDivergenceCapsule(links, windowEvents);
        // Grade from what the verdict PROVED, not what it declared. A green anyOf holds on one branch, so
        // grading off `links` (every branch) would let a presence-only OR report grade `signal` — a false
        // green in the gate itself. `provenExpectedLinks` narrows a green to the branch that actually held;
        // on red we keep the declared links (the capsule wants the full expected surface).
        const gradedLinks = verdict.pass ? await provenExpectedLinks(session, until, since) : links;
        // Honesty: the grade this verdict actually proved + capture integrity — a green never looks
        // stronger than this block. Grade from the strongest asserted consequence; integrity from evictions.
        // Coverage: cross-origin frames / other blind spots the SDK reported during this window mean the
        // verdict didn't see everything — say so, never imply full coverage.
        const spots = blindSpotsFromState(session.blindSpots());
        const coverage = buildCoverageStatement(spots);
        // Only a spot that IMPEACHES the capture belongs in integrity — see impeachesCapture. A
        // structural boundary (virtualized rows, a cross-origin frame) is reported as coverage and
        // must not downgrade a verdict about what WAS observed.
        const impeaching = buildCoverageStatement(spots.filter((s) => impeachesCapture(s.kind)));
        const honesty = buildHonestyBlock({
          grade: gradeOf(gradedLinks),
          attribution: 'window',
          truncated: session.bufferHealth().dropped > droppedBefore,
          coveragePartial: coverage.coverage === 'partial',
          ...(impeaching.note === undefined ? {} : { blindSpots: [impeaching.note] }),
        });
        const capsuleSaved = await saveFailedAssertCapsule({
          deps,
          verdict,
          capsule,
          links,
          args,
          actResult,
          ...(actedSource === undefined ? {} : { actedSource }),
        });
        // Pass the action: an EMPTY window then reads as "the target does not react" rather than as a
        // clean run — `settled` is satisfied by a page that did nothing, i.e. by a click that missed.
        const acted = asString(args['action']);
        const contradictions = findContradictions(windowEvents, {
          action: acted,
          ...session.lastAct.effect(),
        });
        // The single field an agent reads. Everything below it is the evidence it was derived from;
        // this is the only one that has to be interpreted, and now it interprets itself.
        const outcomePending = hasAcceptedWrite(windowEvents);
        const outcomeUnread = hasUnreadWriteOutcome(windowEvents);
        const decision = decideVerified({
          pass: verdict.pass,
          honesty,
          contradictions,
          ...(outcomePending ? { outcomePending } : {}),
          ...(outcomeUnread ? { outcomeUnread } : {}),
          // `settled` is genuinely optional: a wait that declared no predicate never measured it, and
          // passing `false` there would report "never settled" about something never asked to settle.
          ...(settledOutcome === undefined ? {} : { settled: settledOutcome }),
        });
        return withControl(session, {
          ...decision,
          effect: leanActResult(actResult.result),
          verdict,
          // Promoted out of `effect` on red only. On green nobody needs it and it is noise; on red it
          // is the first thing the agent wants, and burying a file:line inside the effect block is
          // most of the way to not reporting it at all.
          ...(verdict.pass || actedSource === undefined
            ? {}
            : { source: `${actedSource.file}:${String(actedSource.line)}` }),
          trace,
          ...(capsuleSaved === undefined ? {} : { capsuleSaved }),
          summary: causalSummary(windowEvents),
          // Cross-channel disagreement, reported WITH the action that caused it.
          //
          // This is the one finding here a human structurally cannot make — they watch one channel,
          // the screen, so a UI that advanced while its write failed looks like success to them and
          // always will. It ran only inside reticle_observe, which means it was found only when the
          // agent already suspected something and thought to go looking. That inverts the value: the
          // whole point is catching what NOBODY suspected. It now travels with the action, so an
          // agent cannot miss it by not asking. Omitted entirely when clean, so a healthy action
          // pays nothing.
          ...(contradictions.length > 0 ? { contradictions } : {}),
          honesty,
          ...(capsule === undefined ? {} : { capsule }),
          since,
          ...healthEnvelope(session),
        });
      } finally {
        session.finishAction(
          undefined,
          settledOutcome,
          settledOutcome === true ? session.elapsed() - since : undefined,
        );
      }
    },
  },
];
