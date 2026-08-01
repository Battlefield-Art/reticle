'use strict';
/**
 * Reticle's Electron preload shim. Add ONE line at the top of your preload, before you expose
 * anything:
 *
 *     require('@reticlehq/browser/electron-preload');
 *
 * ...and every `ipcRenderer.invoke` your app makes becomes a Reticle-visible request
 * (`ipc://<channel>`), so net assertions and settle-waiting cover the main-process hop.
 *
 * Why a preload shim and not renderer-side patching, like every other Reticle observer:
 * `contextBridge.exposeInMainWorld` hands the renderer a DEEPLY FROZEN object, installed on `window`
 * as non-writable AND non-configurable. Neither assignment nor defineProperty can replace a method on
 * it — verified, not assumed. The renderer physically cannot instrument an app's IPC surface. The
 * preload is the last point where the functions are still ordinary and writable.
 *
 * This file is hand-written CommonJS on purpose: a sandboxed Electron preload is CJS-only and cannot
 * load the ESM SDK build.
 *
 * Dev-only, like the rest of Reticle. Gate the require behind your dev check so it never ships.
 */
const { contextBridge, ipcRenderer } = require('electron');

/** Channel the renderer-side SDK looks for. Must match RETICLE_IPC_GLOBAL in src/observers/ipc.ts. */
const RETICLE_IPC_GLOBAL = '__reticleIpc';

/** Set by the renderer through `subscribe`. Until then, records are dropped — connect() runs later. */
let sink = null;
let seq = 0;

function report(record) {
  if (sink === null) return;
  try {
    sink(record);
  } catch {
    /* the renderer's sink is best-effort; it must never break the app's IPC call */
  }
}

/** Wrap one invoke-style function so each call reports a start and an end. */
function observe(original, channelFromArg, name) {
  return function reticleObservedIpc(...args) {
    const id = `i${String(++seq)}`;
    const channel = channelFromArg && typeof args[0] === 'string' ? args[0] : name;
    const startedAt = Date.now();
    report({ phase: 'start', id, channel });
    const finish = (ok, error) => {
      report({
        phase: 'end',
        id,
        channel,
        ok,
        durationMs: Date.now() - startedAt,
        ...(error === undefined ? {} : { error }),
      });
    };
    let result;
    try {
      result = original.apply(this, args);
    } catch (err) {
      finish(false, String(err && err.message ? err.message : err));
      throw err;
    }
    if (result === null || typeof result !== 'object' || typeof result.then !== 'function') {
      finish(true);
      return result;
    }
    return result.then(
      (value) => {
        finish(true);
        return value;
      },
      (err) => {
        finish(false, String(err && err.message ? err.message : err));
        throw err;
      },
    );
  };
}

// Patch ipcRenderer.invoke itself. Every contextBridge API is ultimately a thin wrapper around this
// one function, so patching here covers the app's whole IPC surface no matter what it named things —
// and it happens before the app's own `exposeInMainWorld` captures the reference.
const originalInvoke = ipcRenderer.invoke.bind(ipcRenderer);
ipcRenderer.invoke = observe(originalInvoke, true, 'invoke');

/** Channel the main-process helper answers. Must match CAPTURE_CHANNEL in electron-main.cjs. */
const CAPTURE_CHANNEL = '__reticle:capture';

contextBridge.exposeInMainWorld(RETICLE_IPC_GLOBAL, {
  subscribe(callback) {
    sink = typeof callback === 'function' ? callback : null;
  },
  /**
   * Screenshot this window. Resolves to a base64 PNG, or null when the app did not install the
   * main-process helper (`@reticlehq/browser/electron-main`) — there is no handler to answer, and a
   * missing screenshot must read as missing, never as a blank image.
   *
   * Uses the ORIGINAL invoke: this is Reticle's own plumbing, and recording it as an app IPC call
   * would put `ipc://__reticle:capture` in the agent's own network evidence.
   */
  capture() {
    return originalInvoke(CAPTURE_CHANNEL).catch(() => null);
  },
});
