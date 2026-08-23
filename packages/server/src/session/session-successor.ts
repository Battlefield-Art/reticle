/**
 * The session that took over after a full-document navigation.
 *
 * Reload keeps the id (sessionStorage). A click that loads a new document often does not: the SDK
 * is torn down with the page and HELLO's back under a new id, while the agent still holds the old
 * one. `navigate` already waits for that HELLO (`awaitArrival`) and returns the new id.
 * `act_and_wait` and `assert` did not, so an MPA drive ended at the first link.
 *
 * Unique at the departed origin (and project, when known). Two live tabs at that origin is still a
 * guess, and a guess here would drive the wrong app.
 */

import type { Session } from './session.js';

export interface SessionIdentity {
  id: string;
  url: string;
  projectId?: string;
}

export interface SuccessorClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const POLL_MS = 25;

const REAL_CLOCK: SuccessorClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function identityOf(session: Session): SessionIdentity {
  return {
    id: session.id,
    url: session.url,
    ...(session.projectId === undefined ? {} : { projectId: session.projectId }),
  };
}

/**
 * The one live session that can honestly take over from `departed`, or undefined when none or more
 * than one could.
 *
 * A same-id reconnect is a successor: the id survived in sessionStorage, the document did not.
 */
export function pickDocumentSuccessor(
  live: readonly SessionIdentity[],
  departed: SessionIdentity,
): SessionIdentity | undefined {
  const origin = originOf(departed.url);
  if (origin === undefined) return undefined;
  const atOrigin = live.filter((s) => originOf(s.url) === origin);
  const sameId = atOrigin.find((s) => s.id === departed.id);
  if (sameId !== undefined) return sameId;
  const others = atOrigin.filter(
    (s) =>
      s.id !== departed.id &&
      (departed.projectId === undefined || s.projectId === departed.projectId),
  );
  if (1 !== others.length) return undefined;
  return others[0];
}

export interface SuccessorRegistry {
  get(id: string): Session | undefined;
  all(): readonly Session[];
}

/**
 * Poll until a successor of `departed` is live, or the budget runs out. Null on timeout — never
 * throws, because failing to follow is a legitimate `observation_lost`, not an error.
 */
export async function awaitDocumentSuccessor(
  sessions: SuccessorRegistry,
  departed: Session,
  timeoutMs: number,
  clock: SuccessorClock = REAL_CLOCK,
): Promise<Session | null> {
  const deadline = clock.now() + timeoutMs;
  const departedIdentity = identityOf(departed);
  for (;;) {
    const sameId = sessions.get(departed.id);
    if (sameId !== undefined && sameId !== departed) return sameId;
    // The departed session often still sits in the registry until the socket close lands. Leave it
    // out of the pick, or same-id-first would keep returning the page that just unloaded.
    const picked = pickDocumentSuccessor(
      sessions
        .all()
        .filter((s) => s !== departed)
        .map(identityOf),
      departedIdentity,
    );
    if (picked !== undefined) {
      const live = sessions.get(picked.id);
      if (live !== undefined && live !== departed) return live;
    }
    if (clock.now() >= deadline) return null;
    await clock.sleep(POLL_MS);
  }
}
