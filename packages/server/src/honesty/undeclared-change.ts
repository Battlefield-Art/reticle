import { NO_EDITS_OBSERVED } from '@reticlehq/core';

/**
 * Did code change since the last verdict, with nothing saying what it was for?
 *
 * Declaring intent is opt-in, and nothing has ever noticed that a change landed and nobody said what
 * it was supposed to make true. That is the moment it matters: a change with no declared intent can
 * only be verified against itself, which is the definition of a false green.
 *
 * ## The whole gate lives here, on purpose
 *
 * Three separate conditions have to hold, and each of them is a place this could become a nag. Split
 * across the two verdict paths they would drift, and the first drift makes the finding fire on every
 * response — which is how a findings channel dies. So the paths pass facts in and read a boolean out.
 *
 *  - **An edit was actually OBSERVED.** The epoch degrades to `NO_EDITS_OBSERVED` outside Vite, and
 *    that means "no edits observed", never "no edits happened" — a finding built on an absence
 *    Reticle cannot see would be a fabrication.
 *  - **It moved since the last verdict.** One nudge per change, not one per verdict. An agent
 *    re-verifying five times after one edit has been told already.
 *  - **The ledger holds nothing undischarged.** An open intent IS the declaration; silence is the
 *    correct response to it.
 *
 * ## Why "covers the work" is answered as "anything open at all"
 *
 * The tempting answer is to match the intent's `surface` against the files that changed. Reticle
 * cannot do that honestly: it observes that an epoch advanced, not WHAT advanced — the hot-update
 * channel reports a counter, not a diff — so any file-level matching would be inference dressed as a
 * fact, and it would fire on an agent that had declared its intent perfectly well. Over-reporting on
 * a correct agent is the direction of error that trains it to stop reading findings.
 *
 * So the question asked is the coarse one, and it is asked honestly: has the agent declared anything
 * that is still outstanding? If it has, it is working to a stated purpose and this stays quiet.
 */

export interface EditEpochWindow {
  /** The epoch the session is under now. Undefined when the page never stamped one. */
  current: number | undefined;
  /** The epoch the previous verdict on this session was drawn under. Undefined before the first. */
  atLastVerdict: number | undefined;
}

/**
 * `openIntents` is a thunk rather than a list because reading the ledger touches disk, and this
 * returns false without it in every ordinary case — the epoch condition is met at most once per hot
 * update, so a verdict on an unchanged epoch pays nothing.
 */
export async function isChangeUndeclared(
  epoch: EditEpochWindow,
  openIntents: () => Promise<readonly unknown[]>,
): Promise<boolean> {
  const current = epoch.current;
  if (undefined === current || NO_EDITS_OBSERVED === current) return false;
  if (current === epoch.atLastVerdict) return false;
  return 0 === (await openIntents()).length;
}
