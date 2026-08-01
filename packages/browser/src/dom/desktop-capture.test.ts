import { afterEach, describe, expect, it, vi } from 'vitest';
import { RETICLE_IPC_GLOBAL, RETICLE_TAURI_CAPTURE_COMMAND } from '@reticlehq/core';
import { captureDesktopWindow } from './desktop-capture.js';

const TAURI_INTERNALS = '__TAURI_INTERNALS__';
const PNG_PATH = '/var/folders/tmp/reticle-capture-1.png';

afterEach(() => {
  Reflect.deleteProperty(window, RETICLE_IPC_GLOBAL);
  Reflect.deleteProperty(window, TAURI_INTERNALS);
});

describe('desktop capture — Electron, through the preload-installed channel', () => {
  it('returns the path the shell wrote', async () => {
    Reflect.set(window, RETICLE_IPC_GLOBAL, { capture: () => Promise.resolve(PNG_PATH) });
    await expect(captureDesktopWindow()).resolves.toEqual({ ok: true, path: PNG_PATH });
  });

  it('reports a failing helper instead of throwing into the SDK', async () => {
    Reflect.set(window, RETICLE_IPC_GLOBAL, {
      capture: () => Promise.reject(new Error('window is gone')),
    });
    await expect(captureDesktopWindow()).resolves.toMatchObject({
      ok: false,
      reason: 'window is gone',
    });
  });
});

describe('desktop capture — Tauri, through its own invoke', () => {
  /**
   * Electron installs the capture global from a preload, which runs before app code. Tauri has NO
   * preload stage, so requiring the same global would put a hand-written shim in every Tauri app —
   * and a forgotten shim reads as "this app has no screenshots" rather than as a setup mistake.
   */
  it('invokes the capture command when no preload channel exists', async () => {
    const invoke = vi.fn().mockResolvedValue(PNG_PATH);
    Reflect.set(window, TAURI_INTERNALS, { invoke });

    await expect(captureDesktopWindow()).resolves.toEqual({ ok: true, path: PNG_PATH });
    expect(invoke).toHaveBeenCalledWith(RETICLE_TAURI_CAPTURE_COMMAND);
  });

  it('reports no-provider when the app never registered the command', async () => {
    Reflect.set(window, TAURI_INTERNALS, {
      invoke: () => Promise.reject(new Error('Command reticle_capture not found')),
    });
    await expect(captureDesktopWindow()).resolves.toMatchObject({ ok: false });
  });

  it('prefers an explicitly installed channel over the invoke fallback', async () => {
    const invoke = vi.fn().mockResolvedValue('/tmp/reticle-capture-tauri.png');
    Reflect.set(window, TAURI_INTERNALS, { invoke });
    Reflect.set(window, RETICLE_IPC_GLOBAL, { capture: () => Promise.resolve(PNG_PATH) });

    await expect(captureDesktopWindow()).resolves.toEqual({ ok: true, path: PNG_PATH });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('treats a non-string invoke result as no image rather than a path', async () => {
    Reflect.set(window, TAURI_INTERNALS, { invoke: () => Promise.resolve(null) });
    await expect(captureDesktopWindow()).resolves.toMatchObject({ ok: false });
  });
});

describe('desktop capture — a plain web page', () => {
  it('reports no provider, so the tool never guesses at pixels', async () => {
    await expect(captureDesktopWindow()).resolves.toMatchObject({
      ok: false,
      reason: 'no desktop capture helper installed',
    });
  });
});
