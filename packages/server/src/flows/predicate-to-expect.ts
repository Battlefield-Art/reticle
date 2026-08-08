/**
 * The assertion the agent MADE, in the shape a saved flow can keep.
 *
 * `reticle_act_and_wait { until }` is how agents assert — 12 of 14 calls in a day of telemetry
 * carried an `until`. `compileActStep` recorded only the ACTION, so a flow saved after an asserted
 * drive came back graded `assertion-free`: "performs actions but asserts no observable consequence —
 * it will pass even if the feature is broken." The agent had already said what success meant;
 * Reticle discarded it and then warned the agent that the flow asserts nothing.
 *
 * That is the regression-suite story failing at its last step. "Record once, verify forever" is only
 * worth anything if the recorded flow can go RED, and locally 32 of 39 saved flows cannot.
 *
 * The inverse of `successToPredicate`. Only the kinds FlowExpect can express are carried: `settled`
 * is a wait rather than a claim, and `route`/`animation`/`anyOf`/`not` have no representation at all.
 * Inventing one would write an assertion into the file that the agent never made, which is worse
 * than recording none — a flow that asserts something nobody chose is a false green with extra steps.
 */
import type { FlowExpect } from '@reticlehq/core';
import type { Predicate } from '../events/predicate.js';

/** Merge two partial expectations; later keys win only where the earlier one said nothing. */
function merge(into: FlowExpect, from: FlowExpect): FlowExpect {
  return { ...from, ...into };
}

export function predicateToExpect(predicate: Predicate): FlowExpect | undefined {
  switch (predicate.kind) {
    case 'signal': {
      if (predicate.name === undefined) return undefined;
      return predicate.dataMatches === undefined
        ? { signal: predicate.name }
        : { signal: predicate.name, signalData: predicate.dataMatches };
    }
    case 'net': {
      const net: NonNullable<FlowExpect['net']> = {};
      if (predicate.method !== undefined) net.method = predicate.method;
      if (predicate.urlContains !== undefined) net.urlContains = predicate.urlContains;
      if (predicate.status !== undefined) net.status = predicate.status;
      if (predicate.count !== undefined) net.count = predicate.count;
      return 0 === Object.keys(net).length ? undefined : { net };
    }
    case 'console': {
      const console_: NonNullable<FlowExpect['console']> = {};
      if (predicate.level !== undefined) console_.level = predicate.level;
      if (predicate.absent !== undefined) console_.absent = predicate.absent;
      return 0 === Object.keys(console_).length ? undefined : { console: console_ };
    }
    case 'element': {
      const element: NonNullable<FlowExpect['element']> = {};
      if (predicate.query.testid !== undefined) element.testid = predicate.query.testid;
      if (predicate.query.role !== undefined) element.role = predicate.query.role;
      if (predicate.query.name !== undefined) element.name = predicate.query.name;
      return 0 === Object.keys(element).length ? undefined : { element };
    }
    case 'state': {
      const state: NonNullable<FlowExpect['state']> = { path: predicate.path };
      if (predicate.store !== undefined) state.store = predicate.store;
      if (predicate.equals !== undefined) state.equals = predicate.equals;
      return { state };
    }
    case 'allOf': {
      // `settled` members drop out on their own by returning undefined.
      let combined: FlowExpect | undefined;
      for (const part of predicate.predicates) {
        const expect = predicateToExpect(part);
        if (expect === undefined) continue;
        combined = combined === undefined ? expect : merge(combined, expect);
      }
      return combined;
    }
    default:
      // settled | route | animation | anyOf | not — nothing FlowExpect can say honestly.
      return undefined;
  }
}

/**
 * The subset a REPLAY actually enforces today.
 *
 * `flow-replay` checks exactly two things per step: `expect.element.testid` is present after the
 * action, and `expect.state` holds. A recorded `net` or `signal` expect is graded as a consequence
 * assertion by `classifyFlowAssertions` and then never evaluated — so writing one into a flow file
 * would make it report `grade: "asserted"` while nothing checks it.
 *
 * That is a false green, in the feature whose entire purpose is preventing them, produced by the
 * change that was meant to strengthen it. So only the enforced kinds are recorded: a flow that says
 * it asserts something must actually go red when that thing breaks.
 *
 * Lifting this is worth doing — net and signal are the assertions agents most often make, and the
 * conversion above already handles them — but it requires replay to evaluate them per step (the
 * machinery exists: successToPredicate + the predicate engine). Until then, recording them would
 * trade a weak flow for a lying one.
 */
export function enforcedOnReplay(expect: FlowExpect | undefined): FlowExpect | undefined {
  if (expect === undefined) return undefined;
  const kept: FlowExpect = {};
  if (expect.element?.testid !== undefined) kept.element = expect.element;
  if (expect.state !== undefined) kept.state = expect.state;
  return 0 === Object.keys(kept).length ? undefined : kept;
}
