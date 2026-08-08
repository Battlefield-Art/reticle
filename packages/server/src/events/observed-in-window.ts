/**
 * What DID happen, when the thing you asserted did not.
 *
 * "signal 'x' never fired" and "no matching network call" are true and useless: a typo'd name and a
 * genuinely broken app produce the same sentence, and the agent cannot tell them apart without a
 * round trip it does not know to make. `{ kind:'state' }` already answers a bad path by naming the
 * stores that exist; this gives `signal` and `net` the same courtesy.
 *
 * It also distinguishes the two failures that matter: NOTHING happened in the window (the action did
 * not do what you thought) versus things happened but not that one (you named it wrong).
 */

/** Enough to recognise the one you meant; not so many that a chatty window floods the message. */
const MAX_LISTED = 8;

export function describeObserved(noun: string, seen: readonly string[]): string {
  const unique = [...new Set(seen.filter((s) => s.length > 0))];
  if (unique.length === 0) return `no ${noun} at all in this window`;
  const shown = unique.slice(0, MAX_LISTED);
  const rest = unique.length - shown.length;
  return `${noun} seen in this window: ${shown.join(', ')}${rest > 0 ? `, and ${String(rest)} more` : ''}`;
}
