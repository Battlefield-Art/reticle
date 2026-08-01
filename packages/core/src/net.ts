/**
 * Network-call vocabulary shared by the browser SDK and the server. Split out of constants.ts to
 * keep that file under the size cap.
 */

/**
 * What issued a network-shaped call. Desktop apps (Electron, Tauri) reach their backend over IPC
 * rather than HTTP, so an IPC call is recorded as a request with `initiator: 'ipc'` — that keeps
 * `reticle_network`, settle-waiting and `assert { net }` working on desktop with no new wire shape.
 */
export const NetInitiator = {
  FETCH: 'fetch',
  XHR: 'xhr',
  BEACON: 'beacon',
  IPC: 'ipc',
} as const;
export type NetInitiator = (typeof NetInitiator)[keyof typeof NetInitiator];

/**
 * Synthetic URL scheme for an IPC call, so a channel/command name occupies the `url` field the way a
 * real endpoint does: `ipc://get_user`. Agents filter and assert on it with the ordinary net tools.
 */
export const IPC_URL_SCHEME = 'ipc://';

/**
 * IPC has no status code, but every existing filter and assertion in Reticle keys on one
 * (`reticle_network { status: 500 }`, "did POST /x return 200?"). Mapping a settled IPC call onto
 * these two synthetic codes is what makes a FAILED main-process handler or Rust command visible to
 * the tools an agent already uses — without it, an IPC failure is unqueryable and the desktop story
 * is a false green by construction. `ok` is still emitted alongside and is the authoritative field.
 */
export const IpcStatus = {
  OK: 200,
  ERROR: 500,
} as const;
