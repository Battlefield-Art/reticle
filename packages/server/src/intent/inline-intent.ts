import { createHash } from 'node:crypto';
import { IntentStore } from './intent-store.js';
import { sessionRoot } from '../project/session-root.js';
import type { ToolDeps } from '../tools/tool-kit.js';

/**
 * Intent declared INLINE, on the tool that is already drawing the verdict.
 *
 * `reticle_intent` is on the extended surface, so declaring intent costs an agent a discovery, a
 * decision and a round trip before it has done anything — three places the capture silently fails,
 * and it does. `reticle_act_and_wait` and `reticle_assert` are in every agent's tool list already,
 * so one optional argument there makes the declaration free and discoverable by construction.
 *
 * This is a shortcut into the EXISTING ledger, never a second one. It writes `.reticle/intent.json`
 * through `IntentStore` exactly as `reticle_intent { action: "declare" }` does, so a reviewer reads
 * one file in one vocabulary and cannot tell from the row which door the intent came in by. The
 * pattern is `flows/flow-intent.ts`, which does the same job for a saved flow.
 */

/** Namespaced like `flow:`, so an inline id never collides with one an agent chose by hand. */
const INLINE_INTENT_ID_PREFIX = 'inline:';
const ID_SEPARATOR = ':';
const SLUG_SEPARATOR = '-';
const SLUG_MAX = 48;
const HASH_LENGTH = 8;
const HASH_ALGORITHM = 'sha1';
const NON_SLUG = /[^a-z0-9]+/g;
const SLUG_EDGES = /^-+|-+$/g;

/**
 * The ledger id a piece of inline prose is declared under.
 *
 * Derived from the statement rather than minted, so the same sentence declared on five verdicts is
 * one row rather than five, and a DIFFERENT sentence is a different row rather than a false
 * amendment of the first. The slug is there because the id is what an agent later types to reference
 * the intent, and a bare digest is unreadable; the digest is there because the slug is truncated and
 * two long statements sharing a prefix must not share a row.
 */
export function inlineIntentId(statement: string): string {
  const slug = statement
    .toLowerCase()
    .replace(NON_SLUG, SLUG_SEPARATOR)
    .replace(SLUG_EDGES, '')
    .slice(0, SLUG_MAX)
    .replace(SLUG_EDGES, '');
  const digest = createHash(HASH_ALGORITHM).update(statement).digest('hex').slice(0, HASH_LENGTH);
  return `${INLINE_INTENT_ID_PREFIX}${slug}${SLUG_SEPARATOR}${digest}`;
}

/** What `provenBy` records: which tool drew the verdict, and when. */
export function inlineVerdictId(tool: string, at: number): string {
  return `${tool}${ID_SEPARATOR}${String(at)}`;
}

/**
 * Put an inline intent in the ledger and attach the predicate about to be evaluated. Returns the id
 * the verdict may later discharge, or undefined when there was no intent to record.
 *
 * `intent` carries EITHER prose OR the id of an intent already in the ledger. One field rather than
 * two because the surface is the scarce thing here and the two cases are told apart by the ledger
 * itself: a string that names an existing row is a reference, anything else is prose. A statement
 * that happens to equal an existing id is the same intent said twice, so pointing at the row is the
 * right answer there too, not a collision.
 *
 * A referenced intent is never re-declared, which would overwrite the agent's own words with an id,
 * and its binding is left alone when it already has one — a predicate bound deliberately through
 * `reticle_intent { action: "bind" }` is a stronger statement than whatever this one call asserts,
 * and quietly replacing it is exactly the narrowing the ledger exists to make visible.
 *
 * Best-effort by construction: a ledger that cannot be written is a small problem, and a verdict
 * that fails to return because of one is a large problem.
 */
export async function linkInlineIntent(
  deps: ToolDeps,
  sessionId: string | undefined,
  intent: string | undefined,
  /** The predicate this verdict will evaluate, or undefined when it proves nothing (a bare settle). */
  binding: unknown,
): Promise<string | undefined> {
  if (intent === undefined || 0 === intent.trim().length) return undefined;
  try {
    const store = new IntentStore(deps.fs, sessionRoot(deps, sessionId), { now: deps.now });
    const existing = (await store.read()).find((row) => row.id === intent);
    const id = existing?.id ?? inlineIntentId(intent);
    if (existing === undefined) await store.declare([{ id, statement: intent }]);
    if (binding !== undefined && existing?.binding === undefined) await store.bind(id, binding);
    return id;
  } catch {
    return undefined;
  }
}

/**
 * Record that this verdict proved the intent. Call only for a verdict that actually proved something.
 *
 * The ledger's own rule does the rest: `dischargeIntent` refuses an intent with no binding, so an
 * intent declared inline on a wait that asserted no consequence stays open and honest instead of
 * collecting a proof nothing earned.
 */
export async function dischargeInlineIntent(
  deps: ToolDeps,
  sessionId: string | undefined,
  id: string | undefined,
  proof: { verdictId: string; grade: string; at: number },
): Promise<void> {
  if (id === undefined) return;
  try {
    const store = new IntentStore(deps.fs, sessionRoot(deps, sessionId), { now: deps.now });
    await store.discharge(id, proof);
  } catch {
    // The verdict already stood. The proof is simply not recorded — see dischargeFlowIntent.
  }
}
