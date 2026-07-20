import { EventType, REDACTED_VALUE } from '@reticlehq/core';
import { isSensitiveKey } from '../security/serialization.js';
import type { Emit, Teardown } from './types.js';

/** The three readable client-side storage areas. httpOnly cookies are invisible to JS by design. */
export interface StorageSnapshot {
  local: Record<string, string>;
  session: Record<string, string>;
  cookies: Record<string, string>;
}

/** Accessing localStorage/sessionStorage throws in a sandboxed iframe / disabled-storage context. */
function safeArea(get: () => Storage): Storage | null {
  try {
    return get();
  } catch {
    return null;
  }
}

function readArea(storage: Storage | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (storage === null) return out;
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key === null) continue;
    // Redact credential-bearing keys (token/session/password/…) so auth state never leaks verbatim.
    out[key] = isSensitiveKey(key) ? REDACTED_VALUE : (storage.getItem(key) ?? '');
  }
  return out;
}

function readCookies(): Record<string, string> {
  const out: Record<string, string> = {};
  // Reading document.cookie can throw (SecurityError) in a sandboxed / cookie-disabled context — guard
  // it the same way safeArea guards localStorage, so one bad area never crashes the whole STORAGE read.
  let raw = '';
  try {
    raw = typeof document !== 'undefined' ? document.cookie : '';
  } catch {
    return out;
  }
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === '') continue;
    if (isSensitiveKey(key)) {
      out[key] = REDACTED_VALUE;
      continue;
    }
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[key] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/**
 * Read client-side storage on demand (the STORAGE_READ command). Powers `reticle_storage` — the
 * agent verifies "token persisted after login", "cart survived reload", "logout cleared the session"
 * from the app's real storage rather than inferring it from the DOM. `area` scopes to one area; omit
 * for all three. Sensitive keys are redacted; httpOnly cookies are unreadable by design (documented).
 */
export function readStorage(area?: string): StorageSnapshot | Record<string, string> {
  if (area === 'local') return readArea(safeArea(() => window.localStorage));
  if (area === 'session') return readArea(safeArea(() => window.sessionStorage));
  if (area === 'cookies') return readCookies();
  return {
    local: readArea(safeArea(() => window.localStorage)),
    session: readArea(safeArea(() => window.sessionStorage)),
    cookies: readCookies(),
  };
}

/** Redact a value when its key is credential-bearing — the same rule the pull path applies. */
function redactFor(key: string, value: string | null): string | undefined {
  if (value === null) return undefined;
  return isSensitiveKey(key) ? REDACTED_VALUE : value;
}

/**
 * Observe storage WRITES (not just reads): patch Storage.setItem/removeItem so a token persisted, a
 * cart updated, or a session cleared emits a STORAGE_CHANGE {area, key, old?, new?} diff — the "before"
 * the pull path can never see. Fully reversible; localStorage and sessionStorage share one prototype,
 * so `this` identifies the area. Values are redacted by the same credential rule as the read path.
 */
export function installStorage(emit: Emit): Teardown {
  if (typeof Storage === 'undefined') return () => undefined;
  const proto = Storage.prototype;
  /* eslint-disable @typescript-eslint/unbound-method -- captured to re-invoke via .call(this) */
  const origSetItem = proto.setItem;
  const origRemoveItem = proto.removeItem;
  /* eslint-enable @typescript-eslint/unbound-method */

  const areaOf = (storage: Storage): 'local' | 'session' =>
    storage === safeArea(() => window.sessionStorage) ? 'session' : 'local';

  proto.setItem = function patchedSetItem(this: Storage, key: string, value: string): void {
    let old: string | null = null;
    try {
      old = this.getItem(key);
    } catch {
      /* unreadable — omit the old value */
    }
    origSetItem.call(this, key, value);
    emit(EventType.STORAGE_CHANGE, {
      area: areaOf(this),
      key,
      ...(redactFor(key, old) === undefined ? {} : { old: redactFor(key, old) }),
      new: redactFor(key, value) ?? REDACTED_VALUE,
    });
  };

  proto.removeItem = function patchedRemoveItem(this: Storage, key: string): void {
    let old: string | null = null;
    try {
      old = this.getItem(key);
    } catch {
      /* unreadable */
    }
    origRemoveItem.call(this, key);
    // No `new` field ⇒ the key was removed.
    emit(EventType.STORAGE_CHANGE, {
      area: areaOf(this),
      key,
      ...(redactFor(key, old) === undefined ? {} : { old: redactFor(key, old) }),
    });
  };

  return () => {
    proto.setItem = origSetItem;
    proto.removeItem = origRemoveItem;
  };
}
