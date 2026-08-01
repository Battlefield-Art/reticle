'use strict';
/**
 * Reticle's Electron preload shim. Add ONE line at the top of your preload, before you expose
 * anything:
 *
 *     require('@reticlehq/electron/preload');
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
// The ONE definition of these strings, generated from @reticlehq/core's TypeScript source so a CJS
// preload and the ESM renderer cannot drift apart. Previously hand-copied into six files.
const {
  RETICLE_IPC_GLOBAL,
  RETICLE_CAPTURE_CHANNEL,
} = require('@reticlehq/core/desktop-contract');

/**
 * Renderer-side subscribers, keyed by a token.
 *
 * A Map rather than one slot, and a token rather than the callback itself, for two reasons. A single
 * slot meant a second `connect()` in the same renderer silently STOLE the first one's subscription —
 * and "unsubscribing" was really "overwrite with a no-op", so an SDK teardown left the app in a
 * different state than it found it. Tokens rather than function identity because a callback crosses
 * `contextBridge` as a proxy, so the reference the preload holds is not the one the renderer passes
 * back and `delete(callback)` would never match.
 *
 * Empty until a renderer subscribes, so records before `connect()` are dropped rather than queued —
 * the SDK only wants activity from the moment it is watching.
 */
const sinks = new Map();
let sinkToken = 0;
let seq = 0;

function report(record) {
  for (const sink of sinks.values()) {
    try {
      sink(record);
    } catch {
      /* a renderer sink is best-effort; it must never break the app's IPC call */
    }
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

contextBridge.exposeInMainWorld(RETICLE_IPC_GLOBAL, {
  /** Start receiving records. Returns a token to hand back to `unsubscribe`. */
  subscribe(callback) {
    if (typeof callback !== 'function') return -1;
    sinkToken += 1;
    sinks.set(sinkToken, callback);
    return sinkToken;
  },
  /**
   * Stop receiving records. A real removal, so an SDK teardown leaves the app as it found it.
   *
   * The `ipcRenderer.invoke` patch itself is deliberately NOT reverted: it is a pass-through with no
   * observable effect once no sinks remain, and un-patching it mid-flight would strand any call that
   * had already started inside the wrapper.
   */
  unsubscribe(token) {
    sinks.delete(token);
  },
  /**
   * Screenshot this window. Resolves to a base64 PNG, or null when the app did not install the
   * main-process helper (`@reticlehq/electron/main`) — there is no handler to answer, and a
   * missing screenshot must read as missing, never as a blank image.
   *
   * Uses the ORIGINAL invoke: this is Reticle's own plumbing, and recording it as an app IPC call
   * would put `ipc://__reticle:capture` in the agent's own network evidence.
   */
  capture() {
    return originalInvoke(RETICLE_CAPTURE_CHANNEL).catch(() => null);
  },
});
