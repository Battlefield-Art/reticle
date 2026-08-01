import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The desktop wiring is a contract spelled out in FIVE files that never import each other:
 *
 *   electron-preload.cjs   (CJS, runs in the Electron preload world)
 *   electron-main.cjs      (CJS, runs in the Electron main process)
 *   src/observers/ipc.ts   (ESM, runs in the renderer)
 *   src/dom/desktop-capture.ts (ESM, runs in the renderer)
 *   ../server/.../visual-tools.ts (Node, runs in the daemon)
 *
 * They agree only by three hand-copied strings. Nothing imports anything, because a sandboxed CJS
 * preload cannot load the ESM SDK build and the daemon shares no module graph with the renderer. So
 * a rename in any one file breaks desktop SILENTLY: IPC stops being observed, or screenshots stop
 * working, and every unit test still passes.
 *
 * This repo has been burned by exactly this class before — a tool rename left four e2e specs dead
 * across a whole framework because the drift was invisible to the fast gate. This test is the fast
 * gate for the desktop contract: it reads the files as text and asserts they still say the same
 * thing. It costs milliseconds and it fails the moment the strings diverge.
 */

// This guard lives in the SERVER package, not the browser one: the browser package forbids Node
// builtins (it runs in the DOM), and reading files is exactly what this check must do. Vitest runs
// with cwd at the package root, so the browser package is a sibling.
const BROWSER_PKG = join(process.cwd(), '..', 'browser');
const read = (relative: string): string => readFileSync(join(BROWSER_PKG, relative), 'utf8');

/** Pull `const NAME = '<value>'` out of a source file, whatever module system it is written in. */
function constant(source: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*=\\s*'([^']+)'`).exec(source)?.[1];
}

const preload = read('electron-preload.cjs');
const main = read('electron-main.cjs');
const observer = read('src/observers/ipc.ts');
const capture = read('src/dom/desktop-capture.ts');
const visualTools = readFileSync(
  join(process.cwd(), 'src', 'visual', 'visual-tools.ts'),
  'utf8',
);

describe('desktop contract — strings shared across files that cannot import each other', () => {
  it('agrees on the window global the preload exposes and the renderer reads', () => {
    const fromPreload = constant(preload, 'RETICLE_IPC_GLOBAL');
    expect(fromPreload, 'electron-preload.cjs must define RETICLE_IPC_GLOBAL').toBeDefined();
    expect(constant(observer, 'RETICLE_IPC_GLOBAL')).toBe(fromPreload);
    expect(constant(capture, 'RETICLE_IPC_GLOBAL')).toBe(fromPreload);
  });

  it('agrees on the capture IPC channel between preload and main process', () => {
    const fromMain = constant(main, 'CAPTURE_CHANNEL');
    expect(fromMain, 'electron-main.cjs must define CAPTURE_CHANNEL').toBeDefined();
    expect(constant(preload, 'CAPTURE_CHANNEL')).toBe(fromMain);
  });

  /**
   * The daemon refuses to read a capture whose path does not carry this prefix — a guard so a
   * compromised renderer cannot point it at an arbitrary file. If the two sides disagree, every
   * desktop screenshot fails with a bare "capture-failed" and nothing says why.
   */
  it('agrees on the capture temp-file prefix between the main process and the daemon', () => {
    const fromMain = constant(main, 'CAPTURE_FILE_PREFIX');
    expect(fromMain, 'electron-main.cjs must define CAPTURE_FILE_PREFIX').toBeDefined();
    expect(constant(visualTools, 'CAPTURE_FILE_PREFIX')).toBe(fromMain);
  });

  it('still exposes both halves of the contract from the preload', () => {
    // `subscribe` feeds the IPC observer; `capture` feeds reticle_screenshot. Losing either is silent.
    expect(preload).toMatch(/subscribe\s*\(/);
    expect(preload).toMatch(/capture\s*\(\)/);
  });

  it('keeps the preload patching invoke BEFORE the app can capture its own reference', () => {
    // If `exposeInMainWorld` ran first the app would hold the unpatched invoke and every IPC call
    // would be invisible — the shim would load, do nothing, and report no error.
    // Match the CALL, not the prose: the file's own doc comment names exposeInMainWorld near the
    // top, and matching that made this assert the opposite of what it means to check.
    expect(preload.indexOf('ipcRenderer.invoke =')).toBeLessThan(
      preload.indexOf('contextBridge.exposeInMainWorld(RETICLE_IPC_GLOBAL'),
    );
  });

  it('keeps both desktop entry points published from package.json', () => {
    const pkg = JSON.parse(read('package.json')) as {
      exports: Record<string, unknown>;
      files: string[];
    };
    // Absent from `exports` → `require(...)` throws ERR_PACKAGE_PATH_NOT_EXPORTED at app startup.
    expect(Object.keys(pkg.exports)).toEqual(
      expect.arrayContaining(['./electron-preload', './electron-main']),
    );
    // Absent from `files` → published tarball omits them and desktop breaks only for real users.
    expect(pkg.files).toEqual(
      expect.arrayContaining(['electron-preload.cjs', 'electron-main.cjs']),
    );
  });
});
