/**
 * How one anchored step is turned into a live action.
 *
 * Split out of flow-replay.ts when adding the role+name runner pushed that file past the size cap.
 * These three share one shape — resolve an anchor to a ref, then dispatch — and the sharing is the
 * point: the action window must open and close identically no matter which anchor found the element,
 * or a step's events land in the wrong window depending on how it was addressed.
 */
import {
  AnchorKind,
  DriftReason,
  QueryBy,
  ReticleCommand,
  type FlowAnchor,
  type FlowStep,
  type FlowStepResult,
} from '@reticlehq/core';
import { ReticleTool } from '../tools/tool-names.js';
import { replayActionArgs } from './replay.js';
import type { FlowReplaySession, Sleep } from './flow-replay.js';
import { componentLabel, componentQueryArgs, resolveQuery } from './flow-replay.js';
import { nearestRoleName, type RoleCandidate } from './role-anchor-nearest.js';

/** Query args for a NAMED role anchor — the handle that identifies an instance, not a JSX site. */
function roleQueryArgs(
  anchor: Extract<FlowAnchor, { kind: typeof AnchorKind.ROLE }>,
): Record<string, unknown> {
  return {
    by: QueryBy.ROLE,
    value: anchor.role,
    ...(anchor.name === undefined ? {} : { name: anchor.name }),
  };
}

/** Run one role+name-anchored step: re-resolve via QUERY by:'role', ACT on the live ref, else drift. */
/**
 * The controls actually on the page, as role + name, for the nearest-match scan.
 *
 * Reads the interactive snapshot rather than a second query per candidate: one round trip, and it is
 * the same view the coverage tool uses, so "what is on this page" has one definition.
 */
async function nearestRoleNameOnPage(
  session: FlowReplaySession,
  anchor: { role: string; name?: unknown },
): Promise<string | null> {
  const wanted = typeof anchor.name === 'string' ? anchor.name : undefined;
  if (wanted === undefined) return null;
  try {
    // Straight off the QUERY result: resolveQuery reduces to refs, and the NAMES are what this needs.
    const result = await session.command(ReticleCommand.QUERY, {
      by: QueryBy.ROLE,
      value: anchor.role,
    });
    const payload = result.result;
    const elements =
      typeof payload === 'object' && payload !== null
        ? (payload as { elements?: unknown }).elements
        : undefined;
    if (!Array.isArray(elements)) return null;
    const candidates: RoleCandidate[] = elements
      .map((element) =>
        typeof element === 'object' && element !== null
          ? (element as { name?: unknown }).name
          : undefined,
      )
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
      .map((name) => ({ role: anchor.role, name }));
    return nearestRoleName(anchor.role, wanted, candidates);
  } catch {
    // A drift report must never fail because the suggestion lookup did.
    return null;
  }
}

export async function runRoleStep(
  session: FlowReplaySession,
  step: FlowStep,
  index: number,
  anchor: Extract<FlowAnchor, { kind: typeof AnchorKind.ROLE }>,
  confirmDangerous: boolean,
  sleep: Sleep,
): Promise<FlowStepResult> {
  const label = `${anchor.role} "${String(anchor.name)}"`;
  const { refs } = await resolveQuery(session, roleQueryArgs(anchor), sleep);
  const ref = refs[0];
  if (ref === undefined) {
    // `nearest` used to be the literal null, so heal answered "no nearest match cleared the
    // confidence floor" for EVERY role-anchored drift — a structural limit reported as a judgement
    // about candidates, when nothing had looked. It looks now, and it is deliberately stricter than
    // the testid path: a role name is user-visible text, so a near-match is far more likely to be a
    // different control than a renamed one. A candidate here is INFORMATION for the agent; heal
    // still refuses to rebind a role anchor on its own.
    const nearest = await nearestRoleNameOnPage(session, anchor);
    return {
      step: index,
      tool: step.tool,
      anchor: label,
      ok: false,
      drift: {
        reasonKind: DriftReason.COMPONENT_NOT_FOUND,
        reason:
          nearest === null
            ? `role anchor ${label} not found, and no surviving ${anchor.role} has a similar name — anchor this step to a data-testid`
            : `role anchor ${label} not found; the closest surviving ${anchor.role} is "${nearest}" — confirm it is the same control before rebinding, or add a data-testid`,
        anchor: label,
        nearest,
      },
    };
  }
  return await actOnResolvedRef(session, step, index, label, ref, confirmDangerous);
}

/**
 * Dispatch one already-resolved step. Shared so every anchor kind runs the action the same way —
 * including the action window, whose open/close must not depend on which anchor found the element.
 */
export async function actOnResolvedRef(
  session: FlowReplaySession,
  step: FlowStep,
  index: number,
  label: string,
  ref: string,
  confirmDangerous: boolean,
): Promise<FlowStepResult> {
  session.beginAction?.(ReticleTool.FLOW_REPLAY, { ref, action: step.action ?? '' });
  let act;
  try {
    act = await session.command(ReticleCommand.ACT, {
      ref,
      action: step.action ?? '',
      args: replayActionArgs(step.args, confirmDangerous),
    });
  } finally {
    session.finishAction?.();
  }
  const result: FlowStepResult = { step: index, tool: step.tool, anchor: label, ok: act.ok };
  if (!act.ok) result.error = act.error ?? 'command failed';
  return result;
}

/** Run one component-anchored step: re-resolve via QUERY by:'component', ACT on the live ref, else drift. */
export async function runComponentStep(
  session: FlowReplaySession,
  step: FlowStep,
  index: number,
  anchor: Extract<FlowAnchor, { kind: typeof AnchorKind.COMPONENT }>,
  confirmDangerous: boolean,
  sleep: Sleep,
): Promise<FlowStepResult> {
  const label = componentLabel(anchor);
  const { refs } = await resolveQuery(session, componentQueryArgs(anchor), sleep);
  if (refs.length === 0) {
    return {
      step: index,
      tool: step.tool,
      anchor: label,
      ok: false,
      drift: {
        reasonKind: DriftReason.COMPONENT_NOT_FOUND,
        reason: `component anchor "${label}" not found`,
        anchor: label,
        nearest: null,
      },
    };
  }
  const ref = refs[0] ?? '';
  // Attribute the step's effects to the step. Without this window they arrive with no actionId and are
  // learned as ambient churn on the very regions the flow exercises.
  session.beginAction?.(ReticleTool.FLOW_REPLAY, { ref, action: step.action ?? '' });
  let act;
  try {
    act = await session.command(ReticleCommand.ACT, {
      ref,
      action: step.action ?? '',
      args: replayActionArgs(step.args, confirmDangerous),
    });
  } finally {
    // Close on every exit so a throwing step cannot leak the window onto the next step's events.
    session.finishAction?.();
  }
  const result: FlowStepResult = { step: index, tool: step.tool, anchor: label, ok: act.ok };
  if (!act.ok) result.error = act.error ?? 'command failed';
  return result;
}
