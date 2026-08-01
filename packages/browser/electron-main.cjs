'use strict';
/**
 * Reticle's Electron MAIN-process helper — the screenshot half of desktop support.
 *
 *     const { installReticleCapture } = require('@reticlehq/browser/electron-main');
 *     const win = new BrowserWindow({ ... });
 *     installReticleCapture(win);
 *
 * ...and `reticle_screenshot` / `reticle_visual_diff` work on your app.
 *
 * Why the main process: `webContents.capturePage()` reads the window's own BACKING STORE. That makes
 * it correct while the window is behind your editor, correct while it is backgrounded, and free of
 * any screen-recording permission. Capturing a screen region instead was tried and rejected — it
 * photographs whatever is on top, which would quietly save a picture of your editor as a visual
 * baseline. Renderer-side capture is not an option either: the renderer has no access to the pixels.
 *
 * Dev-only, like the rest of Reticle. Gate the require behind your dev check so it never ships.
 */
const { ipcMain } = require('electron');

/** Channel the preload shim invokes. Must match CAPTURE_CHANNEL in electron-preload.cjs. */
const CAPTURE_CHANNEL = '__reticle:capture';

/**
 * Let Reticle screenshot this window. Safe to call for several windows; the handler is registered
 * once and answers for whichever window asked, so a multi-window app needs no extra wiring.
 */
function installReticleCapture(win) {
  if (win === null || win === undefined) return;
  if (!installReticleCapture._registered) {
    ipcMain.handle(CAPTURE_CHANNEL, async (event) => {
      const contents = event.sender;
      if (contents === null || contents === undefined || contents.isDestroyed()) return null;
      try {
        const image = await contents.capturePage();
        // An empty image means the window had nothing to compose yet; report it as no-image rather
        // than handing back a 0-byte PNG that a diff would treat as a real, blank baseline.
        return image.isEmpty() ? null : image.toPNG().toString('base64');
      } catch {
        return null;
      }
    });
    installReticleCapture._registered = true;
  }
}

installReticleCapture._registered = false;

module.exports = { installReticleCapture, CAPTURE_CHANNEL };
