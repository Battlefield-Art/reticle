/**
 * Desktop screenshots, asked of the runtime that owns the window.
 *
 * A browser tab is captured through CDP. A desktop webview has no CDP endpoint, so the pixels have
 * to come from the shell — and the shell is the only party that can produce them CORRECTLY.
 *
 * Capturing a screen *region* instead was tried and rejected: it photographs the glass, so an app
 * window sitting behind the editor yields a picture of the editor, saved as a visual baseline that a
 * later diff would trust. A screenshot tool that can silently return another window's pixels is
 * worse than one that returns nothing — it manufactures exactly the false green Reticle exists to
 * eliminate. Electron's `webContents.capturePage()` reads the window's own backing store instead:
 * correct while occluded, correct while backgrounded, and needing no screen-recording permission.
 *
 * The app opts in with one line in its main process (`@reticlehq/browser/electron-main`). Absent
 * that, this returns `{ ok: false }` and the tool reports no-provider rather than guessing.
 */

/** Global the Electron preload shim exposes. Must match RETICLE_IPC_GLOBAL in electron-preload.cjs. */
const RETICLE_IPC_GLOBAL = '__reticleIpc';

interface CaptureChannel {
  capture?: () => Promise<string | null>;
}

export interface CaptureResult {
  ok: boolean;
  /** Base64 PNG, without a data: prefix. Present only when ok. */
  png?: string;
  reason?: string;
}

export async function captureDesktopWindow(): Promise<CaptureResult> {
  const channel = (window as unknown as Record<string, unknown>)[RETICLE_IPC_GLOBAL] as
    | CaptureChannel
    | undefined;
  if (typeof channel?.capture !== 'function') {
    return { ok: false, reason: 'no desktop capture helper installed' };
  }
  try {
    const png = await channel.capture();
    return typeof png === 'string' && png.length > 0
      ? { ok: true, png }
      : { ok: false, reason: 'capture returned no image' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
