/**
 * The sentence `status` owes the user, because `init` promised it.
 *
 * `init` closes with "run `npx @reticlehq/server status` — it confirms the app connected, or says
 * exactly why it has not". On a real install, following that instruction printed `running: false,
 * presence: "free"` and nothing else: no reason, no next step, no mention of the app. This is the last
 * checkpoint in the setup path, so a user who arrives here and learns nothing has nowhere left to go.
 *
 * Deliberately thin. The differential already exists in `nextActionFor`, which ranks these causes from
 * what the daemon knows and was rewritten this week to stop leading with a port mismatch; a second
 * differential here could disagree with the first, and two confident answers pointing different ways
 * is worse than one. This only supplies the facts the CLI has and renders the answer.
 */

import { nextActionFor } from '../session/no-session-next-action.js';

export interface StatusFacts {
  /** Is a usable daemon answering on this port? */
  running: boolean;
  /** Live browser sessions the daemon reports. */
  sessionCount: number;
  /** Has an app for this project ever connected on this port? Durable, survives a daemon restart. */
  previouslyConnected: boolean;
}

/**
 * What to do next, or `undefined` when a session is connected and there is nothing to fix.
 *
 * The success case has to stay silent: advice printed beside a working session reads as though
 * something is still wrong, which is its own kind of lie.
 */
export function statusNextAction(facts: StatusFacts): string | undefined {
  if (facts.sessionCount > 0) return undefined;

  if (!facts.running) {
    // `running: false` reads as "Reticle is broken", and it usually means the opposite: the daemon is
    // started by an agent, on demand, and idles out when nobody is driving. A user who has not
    // attached an agent yet is exactly on track, and saying so is the whole job of this branch.
    const wiring = facts.previouslyConnected
      ? 'This project has connected before, so the wiring is correct.'
      : '';
    return (
      `no daemon is running on this port, which is normal — an agent starts it when it first calls a ` +
      `Reticle tool, and it exits again when idle. ${wiring} Ask your agent to verify something, then ` +
      `run status again.`
    ).replace(/\s+/g, ' ');
  }

  // The daemon is up and no page has connected. `nextActionFor` owns the ranking; the CLI cannot see
  // listening ports or a dev command from here, so it passes what it has and lets that function say
  // what is missing rather than guessing at it.
  const next = nextActionFor({
    // The durable bit IS this side's `everConnected`. In-process the flag means "this daemon has served
    // a session", which a daemon seconds old cannot know; from the CLI the honest equivalent is "an app
    // for this project has connected on this port", which is the fact that decides whether the wiring
    // is in question at all.
    everConnected: facts.previouslyConnected,
    initialized: true,
    listening: [],
    dev: undefined,
    previouslyConnected: facts.previouslyConnected,
  });
  return next.reason;
}
