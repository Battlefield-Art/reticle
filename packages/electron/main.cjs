'use strict';
/**
 * Reticle's Electron MAIN-process helper — the screenshot half of desktop support.
 *
 *     const { installReticleCapture } = require('@reticlehq/electron/main');
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
const { writeFile, readdir, unlink } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
// Generated from @reticlehq/core's TypeScript source, so the main process, the preload and the
// daemon agree by construction rather than by three people copying the same string.
const {
  RETICLE_CAPTURE_CHANNEL,
  RETICLE_CAPTURE_FILE_PREFIX,
} = require('@reticlehq/core/desktop-contract');

let captureSeq = 0;
/** One ipcMain handler serves every window — the channel is global, so registration is once-only. */
let registered = false;
/** Windows this app registered, so a capture survives its requester being destroyed. */
const windows = new Set();

/** The webContents to photograph: the requester if it is alive, else any window we know of. */
function usableContents(sender) {
  if (sender !== null && sender !== undefined && !sender.isDestroyed()) return sender;
  for (const win of windows) {
    const contents = win?.webContents;
    if (contents !== undefined && !contents.isDestroyed()) return contents;
  }
  return null;
}

/**
 * Delete this process's earlier captures before writing a new one.
 *
 * The daemon unlinks a capture after reading it, but only if it ever reads: a session that died, a
 * command that timed out, or a path the daemon rejected all leave a ~300KB PNG in the temp directory
 * forever. Sweeping our own prefix on each capture bounds that to one file at a time, with no timer
 * to leak and no cleanup handler to forget. Best-effort — a failed sweep must never fail a capture.
 */
async function sweepOldCaptures(dir, keepFile) {
  const mine = `${RETICLE_CAPTURE_FILE_PREFIX}${String(process.pid)}-`;
  try {
    const entries = await readdir(dir);
    await Promise.all(
      entries
        .filter((name) => name.startsWith(mine) && join(dir, name) !== keepFile)
        .map((name) => unlink(join(dir, name)).catch(() => undefined)),
    );
  } catch {
    /* the temp dir is unreadable; a capture is still worth attempting */
  }
}

/**
 * Let Reticle screenshot this window. Safe to call for several windows; the handler is registered
 * once and answers for whichever window asked, so a multi-window app needs no extra wiring.
 */
function installReticleCapture(win) {
  if (win === null || win === undefined) return;
  // Remembered so a capture can still resolve if the requesting webContents has gone (a window
  // closing mid-command), rather than returning null and reporting an unexplained capture failure.
  windows.add(win);
  win.on?.('closed', () => windows.delete(win));

  if (!registered) {
    ipcMain.handle(RETICLE_CAPTURE_CHANNEL, async (event) => {
      const contents = usableContents(event.sender);
      if (contents === null) return null;
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
          `${RETICLE_CAPTURE_FILE_PREFIX}${String(process.pid)}-${String(captureSeq)}.png`,
        );
        await writeFile(file, image.toPNG());
        await sweepOldCaptures(tmpdir(), file);
        return file;
      } catch {
        return null;
      }
    });
    registered = true;
  }
}

module.exports = { installReticleCapture };
