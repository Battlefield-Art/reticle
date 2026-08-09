/**
 * Which predicates can be satisfied by something that was already true before the action.
 *
 * Event-based kinds (net, signal, route, console, animation, settled) are evaluated against the
 * event buffer floored at the act's own cursor, so a stale event cannot satisfy them — that floor is
 * why `act_and_wait` can trust them at all. `state` is read through the same floored path.
 *
 * `element` and `text` read the LIVE DOM, where no floor exists. A condition that held before the
 * click holds after it and passes instantly, whatever the action did. Measured in the field: a click
 * asserted with `{ kind: 'text', contains: 'Parallel Routes' }` returned `verified: "yes"` in 478ms
 * against `routeChanges: 0`, because the predicate matched the nav link that was already on screen —
 * the real navigation landed 1.8 seconds later.
 *
 * So these are the kinds worth evaluating BEFORE the act, to find out whether the green means
 * anything.
 */
import { PredicateKind } from '@reticlehq/core';
import type { Predicate } from '../events/predicate.js';

export function readsDomState(predicate: Predicate): boolean {
  switch (predicate.kind) {
    case PredicateKind.ELEMENT:
    case PredicateKind.TEXT:
      return true;
    case PredicateKind.ALL_OF:
    case PredicateKind.ANY_OF:
      return predicate.predicates.some(readsDomState);
    case PredicateKind.NOT:
      return readsDomState(predicate.predicate);
    default:
      return false;
  }
}
