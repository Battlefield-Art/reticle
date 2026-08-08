/**
 * The honest envelope for a navigation nobody can confirm.
 *
 * `window.location.assign(url)` returns before the page moves, and the SDK that would report on the
 * new document is destroyed by the navigation itself. So a successful NAVIGATE means the browser
 * accepted the instruction — not that anything arrived. Driven against a dead URL it returned
 * `{"ok":true}` while the session died, which is the worst combination available: the agent believes
 * it navigated, is looking at nothing, and has lost Reticle.
 *
 * `reticle_act` already draws this line — `dispatched` (sent) versus `settled` (a frame flushed).
 * This gives navigate the same honesty without changing what it does.
 */
export function navigateResult(result: {
  ok?: unknown;
  url?: unknown;
  reason?: unknown;
}): Record<string, unknown> {
  const ok = true === result.ok;
  const base: Record<string, unknown> = {
    ok,
    ...('string' === typeof result.url ? { url: result.url } : {}),
    ...('string' === typeof result.reason ? { reason: result.reason } : {}),
  };
  // A refusal is conclusive: the page never moved, so there is nothing unconfirmed to report.
  if (!ok) return base;
  return {
    ...base,
    confirmed: false,
    note:
      'ok means the navigation was DISPATCHED, not that the page arrived — the SDK is torn down by ' +
      'the navigation itself, so nothing here can see the new document. Call reticle_sessions to ' +
      'confirm a session reconnected at the new URL before acting; if none appears, the page did ' +
      'not load or is not instrumented.',
  };
}
