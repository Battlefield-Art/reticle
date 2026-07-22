import { REDACTED_VALUE, TRANSPORT_LIMITS, isSensitiveKey, scrubKnownSecrets } from '@reticlehq/core';

const TRUNCATED_VALUE = '[TRUNCATED]';
const UNSERIALIZABLE_VALUE = '[UNSERIALIZABLE]';
const OMIT_VALUE = Symbol('omit');
const MAX_KEY_LENGTH = 256;
// UTF-8 encodes at most ~3 bytes per JS (UTF-16) code unit, so /4 is a provably-safe bound that never
// exceeds the byte budget — /8 was ~1/8 of the real 1MiB wire budget and truncated legitimate state.
const MAX_TOTAL_CHARACTERS = Math.floor(TRANSPORT_LIMITS.MAX_MESSAGE_BYTES / 4);
const MAX_TOTAL_NODES = TRANSPORT_LIMITS.MAX_COLLECTION_ITEMS * 5;

interface SanitizeState {
  readonly seen: WeakSet<object>;
  remainingCharacters: number;
  nodes: number;
}

function boundedString(value: string, state: SanitizeState, max: number): string {
  const allowed = Math.max(0, Math.min(max, state.remainingCharacters));
  if (value.length <= allowed) {
    state.remainingCharacters -= value.length;
    return value;
  }
  const truncated =
    allowed <= TRUNCATED_VALUE.length
      ? TRUNCATED_VALUE.slice(0, allowed)
      : `${value.slice(0, allowed - TRUNCATED_VALUE.length)}${TRUNCATED_VALUE}`;
  state.remainingCharacters -= truncated.length;
  return truncated;
}

function sanitize(value: unknown, state: SanitizeState, depth: number, key?: string): unknown {
  if (key !== undefined && isSensitiveKey(key)) return REDACTED_VALUE;
  if (depth > TRANSPORT_LIMITS.MAX_SERIALIZE_DEPTH || state.nodes >= MAX_TOTAL_NODES) {
    return TRUNCATED_VALUE;
  }
  state.nodes += 1;

  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return boundedString(
      value,
      state,
      key?.toLowerCase() === 'error'
        ? TRANSPORT_LIMITS.MAX_ERROR_LENGTH
        : TRANSPORT_LIMITS.MAX_STRING_LENGTH,
    );
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return OMIT_VALUE;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: boundedString(value.name, state, 256),
      message: boundedString(value.message, state, TRANSPORT_LIMITS.MAX_ERROR_LENGTH),
    };
  }
  if (state.seen.has(value)) return '[CIRCULAR]';

  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      // Truncate by dropping whole ITEMS, never by corrupting them.
      //
      // The node budget used to run out mid-collection, so later items kept their shape while
      // individual fields became the string "[TRUNCATED]" — an array field turned into a string, a
      // boolean into a string. Consumers declare output schemas over these payloads, so that was not
      // a degraded answer: validation rejected the whole message and the caller received NOTHING. On
      // a page with thousands of matches that is a total loss of the query tool, in exactly the
      // conditions where it matters most.
      //
      // Stopping BEFORE an item that will not fit keeps every survivor whole and type-correct. The
      // collection's true size travels separately as a scalar (serialized first), so "how many" stays
      // exact while the sample shrinks.
      const out: unknown[] = [];
      for (const item of value.slice(0, TRANSPORT_LIMITS.MAX_COLLECTION_ITEMS)) {
        if (state.nodes >= MAX_TOTAL_NODES) break;
        // Checking only BEFORE the item is not enough: one that starts under the budget can cross it
        // partway through and come back with its tail replaced by placeholders. Serialize, then keep
        // it only if it fitted — otherwise discard it and stop, so what ships is always whole.
        const sanitized = sanitize(item, state, depth + 1);
        // `>=`, not `>`: sanitize stops AT the ceiling rather than passing it, so the budget never
        // reads as exceeded. Reaching it during this item means some field inside was replaced by a
        // placeholder, which makes the item schema-invalid — drop it and stop.
        if (state.nodes >= MAX_TOTAL_NODES) break;
        out.push(sanitized === OMIT_VALUE ? null : sanitized);
      }
      return out;
    }

    const out = Object.create(null) as Record<string, unknown>;
    // Scalars first, collections second. The node budget is spent in iteration order, so a large
    // array sitting earlier in the object would consume the whole budget and turn the scalars after
    // it into "[TRUNCATED]". Those scalars are the summary fields — a match `count`, a `total`, a
    // status — and a summary that degrades to a placeholder while its own sample survives is the
    // worst trade available: the caller keeps a partial list and loses the number that says the list
    // is partial. Ordering by cost makes that impossible regardless of how a producer writes its
    // object literal, so no caller has to know this rule to stay correct.
    const keys = Object.keys(value).slice(0, TRANSPORT_LIMITS.MAX_OBJECT_KEYS);
    const isScalar = (k: string): boolean => {
      const v = (value as Record<string, unknown>)[k];
      return v === null || typeof v !== 'object';
    };
    for (const rawKey of [...keys.filter(isScalar), ...keys.filter((k) => !isScalar(k))]) {
      const safeKey = boundedString(rawKey, state, MAX_KEY_LENGTH);
      try {
        const sanitized = sanitize(
          (value as Record<string, unknown>)[rawKey],
          state,
          depth + 1,
          rawKey,
        );
        if (sanitized !== OMIT_VALUE) out[safeKey] = sanitized;
      } catch {
        out[safeKey] = UNSERIALIZABLE_VALUE;
      }
    }
    return out;
  } finally {
    state.seen.delete(value);
  }
}

/** Convert arbitrary app state into a bounded, redacted JSON-compatible value. */
export function sanitizeForTransport(value: unknown): unknown {
  const sanitized = sanitize(
    value,
    {
      seen: new WeakSet(),
      remainingCharacters: MAX_TOTAL_CHARACTERS,
      nodes: 0,
    },
    0,
  );
  return sanitized === OMIT_VALUE ? null : sanitized;
}

/** Serialize without allowing cycles, BigInt, getters, or secrets to break the transport. */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(sanitizeForTransport(value));
  } catch {
    return JSON.stringify(UNSERIALIZABLE_VALUE);
  }
}

// Re-exported: these moved to @reticlehq/core (they are wire rules, not DOM rules).
// Kept on this module's surface so every existing importer inside the SDK is unaffected.
export { isSensitiveKey, scrubKnownSecrets };
