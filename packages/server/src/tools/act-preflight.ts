/**
 * Everything refused BEFORE the action window opens.
 *
 * Both checks here share one property, and it is the reason they belong together: each is decidable
 * without touching the page, and each would otherwise be discovered only after the click had landed
 * — when the action is spent, the page has moved, and the honest answer has already been lost.
 *
 * Refusing early is not a convenience. `reticle_act_and_wait` promises a verdict, and a verdict that
 * blames the app for the caller's own mistake is the most damaging thing a verification tool can
 * produce: it sends somebody to fix code that is not broken. "Nothing was acted on" is a far better
 * outcome than "unknown".
 */
import { assertNativeInputSupported } from './act-danger.js';
import { unevaluablePredicateReason } from '../events/predicate-precheck.js';

/**
 * Throws if this call cannot honestly be driven. Call it after the args are parsed and before the
 * first dispatch — anything that depends on what is actually rendered belongs after the action.
 */
export function preflightAct(actArgs: Record<string, unknown>, until: unknown): void {
  // This path cannot honour a native-input request, and taking the argument and ignoring it told
  // the agent its trusted click had happened. See act-danger.
  assertNativeInputSupported(actArgs);
  const unevaluable = unevaluablePredicateReason(until);
  if (unevaluable !== undefined) throw new Error(unevaluable);
}
