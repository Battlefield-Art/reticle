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
const { writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

/** Channel the preload shim invokes. Must match CAPTURE_CHANNEL in electron-preload.cjs. */
const CAPTURE_CHANNEL = '__reticle:capture';

/**
 * Temp-file name prefix for a capture. The server only reads paths inside the OS temp dir whose
 * basename starts with this, so a compromised renderer cannot point the daemon at an arbitrary file.
 */
const CAPTURE_FILE_PREFIX = 'reticle-capture-';
let captureSeq = 0;

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
        if (image.isEmpty()) return null;
        // Write to a temp FILE and return its path, rather than base64 over the bridge. The SDK's
        // transport sanitizer caps every string at 64KB, so a real screenshot came back silently
        // truncated — an invalid PNG that still reported `saved: true`. The daemon and the app are
        // always on the same machine here (the bridge is loopback), so a path is the honest channel:
        // no size cap, no chunking, and nothing large on the event wire.
        captureSeq += 1;
        const file = join(
          tmpdir(),
          `${CAPTURE_FILE_PREFIX}${String(process.pid)}-${String(captureSeq)}.png`,
        );
        await writeFile(file, image.toPNG());
        return file;
      } catch {
        return null;
      }
    });
    installReticleCapture._registered = true;
  }
}

installReticleCapture._registered = false;

module.exports = { installReticleCapture, CAPTURE_CHANNEL, CAPTURE_FILE_PREFIX };
