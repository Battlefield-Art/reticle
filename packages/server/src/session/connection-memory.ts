/**
 * One durable bit: has an app ever connected to Reticle on this port, for this project?
 *
 * `SessionManager.everConnected()` answers a narrower question than every reader of it assumed — it
 * is scoped to the CURRENT PROCESS. Daemons are short-lived by design (they idle out and respawn),
 * so a diagnosis built on that boolean tells a user whose app connected a minute ago that this
 * install has never worked, and sends them looking for a missing config file that was always there.
 * Reported repeatedly, and the confident phrasing is what made it expensive: "never seen one" reads
 * as evidence about the install, not as a fact about a process that booted four seconds ago.
 *
 * Deliberately tiny: one JSON file per port under the daemon's state home, holding the set of
 * projectIds that have connected. It is a HINT, so every failure mode here degrades to "we do not
 * know" rather than throwing — a diagnostic that can crash the tool it is diagnosing is worse than
 * no diagnostic at all.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Sessions from an SDK old enough not to stamp a projectId still count, under this key. */
const UNTAGGED = '(untagged)';

/**
 * Cap on remembered projects per port.
 *
 * A shared 4400 on a busy machine sees many projects over a week and this file is never garbage
 * collected, so the set is bounded and oldest-out. The bit it answers is only ever used to soften a
 * diagnosis, so losing the tail costs nothing.
 */
const MAX_REMEMBERED_PROJECTS = 32;

function memoryPath(stateDir: string, port: number): string {
  return join(stateDir, `connected-${String(port)}.json`);
}

/** The remembered project ids for a port. Empty on absent, unreadable, or malformed state. */
function read(stateDir: string, port: number): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(memoryPath(stateDir, port), 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => 'string' === typeof entry);
  } catch {
    return [];
  }
}

/**
 * Record that a session connected. Best-effort — a daemon must never fail to serve a session
 * because it could not write a hint about it.
 */
export function rememberConnected(
  stateDir: string,
  port: number,
  projectId: string | undefined,
): void {
  const key = projectId ?? UNTAGGED;
  const known = read(stateDir, port);
  if (known.includes(key)) return;
  const next = [...known, key].slice(-MAX_REMEMBERED_PROJECTS);
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(memoryPath(stateDir, port), JSON.stringify(next), 'utf8');
  } catch {
    // An unwritable state home is already reported elsewhere; it must not break the session path.
  }
}

/**
 * Whether an app has connected on this port before, for this project.
 *
 * An absent `projectId` asks the weaker question — "has ANY app connected on this port" — because
 * that is the honest reading when the caller cannot name a project: the alternative is to answer
 * "no" for a daemon that plainly has served apps, which is the same over-confident claim this file
 * exists to remove.
 */
export function hasConnectedBefore(
  stateDir: string,
  port: number,
  projectId: string | undefined,
): boolean {
  const known = read(stateDir, port);
  if (projectId === undefined) return known.length > 0;
  return known.includes(projectId);
}
