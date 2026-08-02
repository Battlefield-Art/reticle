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
 * Both desktop runtimes can do this, each through its own shell API — `webContents.capturePage()` on
 * Electron, and on Tauri the platform's own webview snapshot (`WKWebView.takeSnapshot`, WebView2
 * `CapturePreview`, or WebKitGTK's snapshot). None of them reads the screen, so all stay correct with
 * the window occluded, hidden, or running headless with nothing on screen at all.
 *
 * The app opts in with one line in its main process (`@reticlehq/electron/main`) or one Rust command
 * (`reticle-tauri`). Absent that, this returns `{ ok: false }` and the tool reports no-provider
 * rather than guessing.
 */

import { RETICLE_IPC_GLOBAL, RETICLE_TAURI_CAPTURE_COMMAND } from '@reticlehq/core';

interface CaptureChannel {
  capture?: () => Promise<string | null>;
}

/** Tauri's own bridge object. The SDK reads `invoke` off it; it never patches it (it is read-only). */
interface TauriInternals {
  invoke?: (command: string, args?: unknown) => Promise<unknown>;
}

const TAURI_INTERNALS_GLOBAL = '__TAURI_INTERNALS__';

/**
 * Tauri's capture path, used when no preload-installed channel exists.
 *
 * Electron can install `RETICLE_IPC_GLOBAL` from its preload, which runs before app code. Tauri has
 * no preload stage at all, so requiring the same global would mean every Tauri app hand-writing a
 * frontend shim — a setup step that silently yields "no screenshots" when forgotten. Invoking the
 * command directly removes the JavaScript side entirely: the app registers one Rust command and the
 * SDK finds it. Absent that command the invoke rejects, and this reports no-provider like any other.
 */
function tauriCapture(): (() => Promise<string | null>) | undefined {
  const internals = (window as unknown as Record<string, unknown>)[TAURI_INTERNALS_GLOBAL] as
    | TauriInternals
    | undefined;
  if (typeof internals?.invoke !== 'function') return undefined;
  const invoke = internals.invoke.bind(internals);
  return async () => {
    const path = await invoke(RETICLE_TAURI_CAPTURE_COMMAND);
    return typeof path === 'string' ? path : null;
  };
}

export interface CaptureResult {
  ok: boolean;
  /**
   * Filesystem path of the captured PNG, written by the desktop shell.
   *
   * A path, not the image bytes: the SDK's transport sanitizer caps every string at 64KB, so a
   * base64 PNG came back SILENTLY TRUNCATED and was saved as a "successful" screenshot that no
   * decoder could read. The daemon and the app always share a machine here (the bridge is loopback),
   * so handing over a path keeps the image off the event wire entirely.
   */
  path?: string;
  reason?: string;
}

export async function captureDesktopWindow(): Promise<CaptureResult> {
  const channel = (window as unknown as Record<string, unknown>)[RETICLE_IPC_GLOBAL] as
    | CaptureChannel
    | undefined;
  const capture = typeof channel?.capture === 'function' ? channel.capture : tauriCapture();
  if (capture === undefined) {
    return { ok: false, reason: 'no desktop capture helper installed' };
  }
  try {
    const path = await capture();
    return typeof path === 'string' && path.length > 0
      ? { ok: true, path }
      : { ok: false, reason: 'capture returned no image' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
