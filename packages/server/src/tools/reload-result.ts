/**
 * What `navigate { reload: true }` reports.
 *
 * It answered a bare `{ ok: true }`, while the URL branch of the same tool returns `confirmed: false`
 * plus a note — because `ok` means the browser accepted the instruction, not that the page arrived.
 * Identical semantics, one branch disclosing them and one not, and the silent one is the path most
 * likely to need the caveat: a reload tears the SDK down, and a caller that acts on `ok: true` hits
 * the window before it comes back.
 *
 * The permanent session loss reported alongside this is fixed separately — session-continuity.ts
 * remembers the id in sessionStorage so a reload rejoins the SAME session instead of appearing as a
 * new one. This is the remaining half: saying that the page is not back yet.
 */

/** The reload's own disclosure — the same shape and the same advice the URL branch gives. */
export const RELOAD_NOTE =
  'ok means the reload was DISPATCHED, not that the page came back — the SDK is torn down by the ' +
  'reload itself, so nothing here can see the new document yet. Call reticle_sessions to confirm ' +
  'the session reconnected before acting; the session id is preserved across a reload, so it will ' +
  'be the same one.';

export function reloadResult(): Record<string, unknown> {
  return { ok: true, confirmed: false, note: RELOAD_NOTE };
}
