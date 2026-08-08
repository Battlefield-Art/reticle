const DANGEROUS_ACTION =
  /\b(delete|remove|destroy|erase|drop|terminate|revoke|reset|logout|log out|sign out|close account|cancel subscription|purchase|buy|pay|place order|confirm order|deploy|publish|send|transfer|withdraw|refund)\b/i;

/** True only for literal loopback hosts, never lookalike DNS names such as 127.example.com. */
export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if ('localhost' === normalized || '::1' === normalized || '0:0:0:0:0:0:0:1' === normalized) {
    return true;
  }
  const octets = normalized.split('.');
  return (
    4 === octets.length &&
    '127' === octets[0] &&
    octets.every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) return false;
      const value = Number(octet);
      return value >= 0 && value <= 255;
    })
  );
}

/**
 * Page protocols that mean "this document IS a local desktop app", not a website. A packaged
 * Electron renderer loads over `file:` (or a registered `app:` protocol); a Tauri webview loads over
 * `tauri:` on macOS/Linux. None of these can be reached by a remote attacker — there is no network
 * origin to serve them from — so a page on one is as local as `http://localhost`.
 */
const LOCAL_APP_PROTOCOLS: readonly string[] = ['file:', 'app:', 'tauri:'];

/**
 * The hostname Tauri v2 uses on Windows (and Android), where the webview needs a real http origin.
 * `.localhost` is reserved for loopback by RFC 6761, so this can never resolve to a remote host.
 */
const TAURI_HTTP_HOSTNAME = 'tauri.localhost';

/**
 * True when the page is local: an ordinary loopback document, or a desktop webview.
 *
 * This is what gates the SDK on the page side. The gate's purpose is to stop a REMOTE WEBSITE from
 * driving a developer's local bridge — a desktop app's own webview is not that, and treating it as
 * remote is what made Reticle refuse to start inside a packaged Electron or Tauri app.
 */
export function isLocalPage(protocol: string, hostname: string): boolean {
  if (isLoopbackHostname(hostname)) return true;
  if (LOCAL_APP_PROTOCOLS.includes(protocol.toLowerCase())) return true;
  return hostname.toLowerCase() === TAURI_HTTP_HOSTNAME;
}

/**
 * What `URL.origin` yields for a scheme that has no tuple origin — and what a browser puts in the
 * `Origin` header for the same. Desktop webviews are the common case: `tauri://localhost` on
 * macOS/Linux, `app://.` or `file://` in a packaged Electron renderer.
 */
export const OPAQUE_ORIGIN = 'null';

/**
 * True when an Origin carries no attributable host — a desktop webview or a `file://` document.
 * Such an origin cannot be checked against `isLoopbackHostname`; callers must fall back to the
 * pairing token, exactly as they do for a request that omits `Origin` entirely.
 */
export function isOpaqueOrigin(origin: string): boolean {
  try {
    return new URL(origin).origin === OPAQUE_ORIGIN;
  } catch {
    return true;
  }
}

/** Best-effort classifier for labels and tool names that can trigger irreversible effects. */
export function isDangerousActionText(text: string): boolean {
  return DANGEROUS_ACTION.test(text.replace(/[_-]+/g, ' '));
}
