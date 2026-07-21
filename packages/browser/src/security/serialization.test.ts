import { describe, expect, it } from 'vitest';
import { REDACTED_VALUE, TRANSPORT_LIMITS } from '@reticlehq/core';
import {
  isSensitiveKey,
  safeStringify,
  sanitizeForTransport,
  scrubKnownSecrets,
} from './serialization.js';

describe('isSensitiveKey — session/jwt/pwd/sid coverage without substring false positives', () => {
  it('matches common session identifiers and short credential keys', () => {
    for (const k of [
      'sessionid',
      'session_id',
      'session-id',
      'jwt',
      'pwd',
      'sid',
      'JWT',
      'accessToken',
    ]) {
      expect(isSensitiveKey(k)).toBe(true);
    }
  });
  it('does NOT redact benign keys that merely CONTAIN those letters', () => {
    for (const k of ['president', 'consider', 'outside', 'rapid', 'valid', 'jwtxCount', 'upward']) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });
});

describe('scrubKnownSecrets — high-confidence shapes, no prose corruption', () => {
  it('redacts JWTs and provider key prefixes regardless of surrounding key', () => {
    expect(scrubKnownSecrets('token is eyJhbGciOi.eyJzdWIiOi.abc123XYZ done')).toContain(
      REDACTED_VALUE,
    );
    expect(scrubKnownSecrets('key sk_live_abcd1234efgh5678')).toBe(`key ${REDACTED_VALUE}`);
    expect(scrubKnownSecrets('aws AKIAIOSFODNN7EXAMPLE here')).toContain(REDACTED_VALUE);
  });
  it('leaves ordinary prose untouched', () => {
    const prose = 'The quick brown fox jumps over the lazy dog, again and again.';
    expect(scrubKnownSecrets(prose)).toBe(prose);
  });
});

describe('transport serialization', () => {
  it('redacts sensitive keys at every depth', () => {
    expect(
      sanitizeForTransport({
        password: 'open-sesame',
        nested: { apiKey: 'key-123', value: 1 },
      }),
    ).toEqual({
      password: REDACTED_VALUE,
      nested: { apiKey: REDACTED_VALUE, value: 1 },
    });
  });

  it('redacts auth tokens but NOT compound design-token fields', () => {
    expect(
      sanitizeForTransport({
        accessToken: 'secret-abc',
        authToken: 'secret-def',
        token: 'secret-ghi',
        // design fields — must survive (the old /token/ regex falsely redacted these)
        colorToken: '--accent',
        backgroundToken: '--surface',
        tokenCount: 17,
        offTheme: true,
      }),
    ).toEqual({
      accessToken: REDACTED_VALUE,
      authToken: REDACTED_VALUE,
      token: REDACTED_VALUE,
      colorToken: '--accent',
      backgroundToken: '--surface',
      tokenCount: 17,
      offTheme: true,
    });
  });

  it('handles BigInt and cycles without throwing', () => {
    const value: Record<string, unknown> = { count: 2n };
    value['self'] = value;
    expect(() => safeStringify(value)).not.toThrow();
    expect(JSON.parse(safeStringify(value))).toEqual({
      count: '2',
      self: '[CIRCULAR]',
    });
  });

  it('omits undefined object properties and preserves array positions', () => {
    expect(
      JSON.parse(
        safeStringify({
          omitted: undefined,
          items: [undefined, () => undefined, Symbol('value')],
        }),
      ),
    ).toEqual({ items: [null, null, null] });
  });

  it('contains hostile proxy failures', () => {
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('blocked');
        },
      },
    );
    expect(safeStringify(proxy)).toBe('"[UNSERIALIZABLE]"');
  });

  it('bounds long strings and collections', () => {
    const result = sanitizeForTransport({
      text: 'x'.repeat(TRANSPORT_LIMITS.MAX_STRING_LENGTH + 100),
      items: Array.from({ length: TRANSPORT_LIMITS.MAX_COLLECTION_ITEMS + 10 }, (_, i) => i),
    }) as { text: string; items: unknown[] };
    expect(result.text.length).toBeLessThanOrEqual(TRANSPORT_LIMITS.MAX_STRING_LENGTH);
    expect(result.text.endsWith('[TRUNCATED]')).toBe(true);
    expect(result.items).toHaveLength(TRANSPORT_LIMITS.MAX_COLLECTION_ITEMS);
  });
});

/**
 * The server reports match counts from the `count` field rather than `elements.length`, because the
 * array is capped in transit while the count is not. That fix is only sound if `count` actually
 * survives a payload big enough to exhaust the node budget — and it survives for a non-obvious
 * reason: `matchQuery` emits `count` BEFORE `elements`, and the sanitizer spends its budget in key
 * order. Reordering those two keys would silently turn the count into "[TRUNCATED]" and put the
 * wrong-number bug straight back. This test is the thing that would go red if that happened.
 */
describe('scalar counts survive a payload that exhausts the node budget', () => {
  function queryShapedResult(matches: number): unknown {
    return {
      matched: matches > 0,
      count: matches,
      elements: Array.from({ length: matches }, (_v, i) => ({
        ref: `e${String(i)}`,
        role: 'button',
        name: `row ${String(i)} action`,
        testid: `row-${String(i)}`,
        visible: true,
      })),
    };
  }

  it('keeps count exact when the elements array is truncated', () => {
    const wire = sanitizeForTransport(queryShapedResult(5000)) as {
      count: unknown;
      elements: unknown[];
    };
    expect(wire.count).toBe(5000);
    expect(wire.elements.length).toBeLessThan(5000);
  });

  it('keeps count exact even when it is declared AFTER the huge array', () => {
    // The order-independent version of the test above. Before the sanitizer sorted scalars ahead of
    // collections, this shape lost its count to the node budget — so a producer that happened to
    // write `elements` first silently reintroduced the wrong-number bug.
    const wire = sanitizeForTransport({
      elements: Array.from({ length: 5000 }, (_v, i) => ({
        ref: `e${String(i)}`,
        role: 'button',
        name: `row ${String(i)} action`,
        testid: `row-${String(i)}`,
        visible: true,
      })),
      count: 5000,
    }) as { count: unknown };
    expect(wire.count).toBe(5000);
  });

  it('the truncation this guards against is real, not hypothetical', () => {
    const wire = sanitizeForTransport(queryShapedResult(5000)) as { elements: unknown[] };
    // If this ever stops truncating, the count fix is untested rather than passing.
    expect(wire.elements.length).toBeLessThanOrEqual(200);
  });
});
