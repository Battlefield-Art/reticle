import { ContradictionKind, EventType, type ReticleEvent } from '@reticlehq/core';
import type { Contradiction } from './contradictions.js';

/**
 * A write that returned OK and quietly did not apply part of what it was asked to.
 *
 * Measured on a desktop preferences write: the request asked for `{density:'compact', locale:'fr'}`,
 * the response echoed `{"ok":true,"saved":{"density":"compact","locale":"en"}}`, the UI said
 * "Preferences saved", and every channel agreed. `locale` was silently discarded. Nothing above the
 * payload can see this — the status is 200, the body reports no failure, the UI advanced, the page
 * settled. It is a false green with the evidence already in hand.
 *
 * The shape is ordinary in real backends: a field not in the UPDATE statement, a schema that strips
 * unknown keys, a PATCH that honours a subset, an enum that falls back to a default.
 *
 * ## Why this is narrow on purpose
 *
 * Servers legitimately transform what they echo — trimming, lower-casing, rounding, canonicalising,
 * filling defaults, assigning ids and timestamps. A rule that flagged every echoed field that differs
 * would fire on healthy APIs constantly, and a contradiction kind that cries wolf gets filtered out
 * by the agents reading it, taking the true positives with it. So:
 *
 *  - only keys the request actually SENT are considered;
 *  - only scalars, since deep structural diffing is where the false positives live;
 *  - values are compared NORMALISED (trimmed, case-folded, numbers as numbers), so `FR` vs `fr` and
 *    `1` vs `1.0` stay silent while `fr` vs `en` speaks;
 *  - if the key appears anywhere in the response carrying the requested value, it is treated as
 *    applied — an envelope that echoes both the old and the new value is not a dropped write.
 *
 * The residue after those filters is a field the caller set, the server echoed back, and the echoed
 * value is a genuinely different value. That is worth one line of an agent's attention.
 */

/** Bodies larger than this are skipped — a diff over a huge payload is neither cheap nor legible. */
const MAX_ECHO_KEYS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Any JSON value, not just an object. An HTTP write sends an object; an IPC call sends its ARGUMENT
 * LIST, so `savePrefs({locale})` arrives as `[{"locale":"fr"}]`. Requiring a top-level object here
 * silently excluded every desktop write from this check — the exact platform the finding came from.
 */
function parse(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Comparable form of a scalar. Non-scalars return undefined and are never compared. */
function normalize(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === 'boolean') return String(value);
  return undefined;
}

/**
 * Every scalar value the response carries for each key, at any depth.
 *
 * Depth matters because the echo is usually nested — `{ok:true, saved:{...}}`, `{data:{...}}`,
 * `{result:{...}}` — and demanding the same path as the request would miss nearly every real API.
 * Collecting ALL values for a key is what makes the "echoes both old and new" case safe.
 */
function scalarsByKey(
  body: unknown,
  into: Map<string, Set<string>> = new Map(),
  depth = 0,
): Map<string, Set<string>> {
  if (depth > 6 || into.size > MAX_ECHO_KEYS) return into;
  if (Array.isArray(body)) {
    for (const item of body) scalarsByKey(item, into, depth + 1);
    return into;
  }
  if (!isRecord(body)) return into;
  for (const [key, value] of Object.entries(body)) {
    const scalar = normalize(value);
    if (scalar === undefined) {
      scalarsByKey(value, into, depth + 1);
      continue;
    }
    const seen = into.get(key) ?? new Set<string>();
    seen.add(scalar);
    into.set(key, seen);
  }
  return into;
}

const OK_MIN = 200;
const OK_MAX = 300;

/** Contradictions for writes whose response echoes a different value than the request asked for. */
export function findEchoMismatches(events: readonly ReticleEvent[]): Contradiction[] {
  const found: Contradiction[] = [];
  for (const event of events) {
    if (event.type !== EventType.NET_REQUEST) continue;
    // IPC reports `ok` rather than a status; HTTP reports a status. Either must say success — a write
    // that already failed is a different (and louder) finding than one that half-applied.
    const status = event.data['status'];
    const httpOk = typeof status === 'number' && status >= OK_MIN && status < OK_MAX;
    if (!httpOk && event.data['ok'] !== true) continue;

    const request = parse(event.data['requestBody']);
    const response = parse(event.data['responseBody']);
    if (request === undefined || response === undefined) continue;

    const echoed = scalarsByKey(response);
    const asked = scalarsByKey(request);
    const dropped: string[] = [];
    for (const [key, wanted] of asked) {
      // More than one requested value for a key (a before/after pair, a list of items) makes "what
      // was asked for" ambiguous, and a guess here is exactly how this kind would earn a reputation
      // for crying wolf.
      if (wanted.size !== 1) continue;
      const values = echoed.get(key);
      // Not echoed at all = no evidence either way. Only a key the server chose to report back can
      // contradict the request, and silence is not a contradiction.
      if (values === undefined || values.size === 0) continue;
      const [want] = [...wanted];
      if (want !== undefined && !values.has(want))
        dropped.push(`${key}: asked ${want}, got ${[...values].join('/')}`);
    }
    if (dropped.length === 0) continue;

    const url = typeof event.data['url'] === 'string' ? event.data['url'] : '';
    const method = typeof event.data['method'] === 'string' ? event.data['method'] : '';
    found.push({
      kind: ContradictionKind.WRITE_FIELD_IGNORED,
      claim: 'the write returned success and the page treated it as saved',
      counter: `its own echo shows ${String(dropped.length)} field(s) NOT applied — ${dropped.join('; ')}`,
      detail: `${method} ${url} — the server answered OK and returned a different value than it was asked to set, so the write half-applied; the UI has no way to know and will show the value the user typed`,
    });
  }
  return found;
}
