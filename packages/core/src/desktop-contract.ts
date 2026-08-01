/**
 * The desktop wiring contract — the single source of truth for the strings that let an Electron
 * app's three worlds recognise each other.
 *
 * Those worlds cannot share a module graph. A sandboxed Electron preload is CommonJS and cannot load
 * the ESM SDK build; the daemon runs in a separate process entirely. So these values were previously
 * hand-copied into six files, and a rename in any one of them broke desktop SILENTLY — IPC stopped
 * being observed, or screenshots stopped working, and every test still passed.
 *
 * They live here because `@reticlehq/core` is where anything crossing the browser ↔ bridge ↔ agent
 * boundary is defined. The CommonJS side does not copy them: `scripts/gen-desktop-contract.mjs`
 * emits `dist/desktop-contract.cjs` from THIS file at build time, so the preload requires the same
 * values it would have imported. One definition, two module systems, no drift possible.
 */

/**
 * The `window` property the Electron preload exposes and the renderer-side SDK reads.
 *
 * Namespaced and underscore-prefixed so it cannot collide with an app's own globals.
 */
export const RETICLE_IPC_GLOBAL = '__reticleIpc';

/** The ipcMain channel the capture helper answers, invoked by the preload on the SDK's behalf. */
export const RETICLE_CAPTURE_CHANNEL = '__reticle:capture';

/**
 * Filename prefix for a screenshot the main process writes to the OS temp directory.
 *
 * The daemon refuses to read a capture whose path does not sit in the temp dir AND carry this
 * prefix — the path arrives from the page, and the daemon must not become a file-read oracle for
 * whatever a compromised renderer names.
 */
export const RETICLE_CAPTURE_FILE_PREFIX = 'reticle-capture-';

/**
 * Every value the generated CommonJS shim must expose, as `name → value`.
 *
 * The generator walks THIS record rather than a hand-written list, so adding a constant above and
 * exporting it here is all it takes for the preload to see it — there is no second place to update.
 */
export const DESKTOP_CONTRACT = {
  RETICLE_IPC_GLOBAL,
  RETICLE_CAPTURE_CHANNEL,
  RETICLE_CAPTURE_FILE_PREFIX,
} as const;
