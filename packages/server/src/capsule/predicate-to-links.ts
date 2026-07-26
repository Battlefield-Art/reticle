import type { Predicate } from '../events/predicate.js';
import type { ExpectedLink } from './divergence.js';

/**
 * Convert a mustHold predicate into the ordered ExpectedLinks the divergence capsule walks. Only the
 * consequence kinds (signal/net/state) become links — a presence check (element/text) can't diverge in a
 * dataflow sense. allOf/anyOf flatten in order; other kinds are skipped. Pure; feeds the capsule on red.
 */
export function predicateToExpectedLinks(predicate: Predicate): ExpectedLink[] {
  switch (predicate.kind) {
    case 'signal':
      return predicate.name === undefined ? [] : [{ kind: 'signal', name: predicate.name }];
    case 'net':
      return predicate.urlContains === undefined
        ? []
        : [
            {
              kind: 'net',
              urlContains: predicate.urlContains,
              ...(predicate.status === undefined ? {} : { status: predicate.status }),
            },
          ];
    case 'state': {
      const name = predicate.store ?? predicate.path;
      return [{ kind: 'state', name }];
    }
    case 'allOf':
    case 'anyOf':
      return predicate.predicates.flatMap(predicateToExpectedLinks);
    default:
      return [];
  }
}
