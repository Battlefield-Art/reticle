/**
 * Node-side questions about what is actually installed in the app.
 *
 * All three answer "what is on disk right now" rather than "what does the plugin do", and each exists
 * because guessing was wrong in a way that reached a user: a declared-but-absent dependency logs a
 * resolve failure on every boot, an unnoticed SDK change leaves stale code in the browser, and an
 * unreported version makes a skewed pair surface as a bare -32000.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

/** The React kit the host app imports the SDK from. Mirrors the constant in index.ts. */
const RETICLE_PACKAGE = '@reticlehq/react';

/**
 * Whether a package can be resolved from this process. Used to avoid declaring an optimizeDeps entry
 * for something the app does not have, which Vite reports as a resolve failure on every boot.
 */
export function isResolvable(specifier: string): boolean {
  try {
    createRequire(import.meta.url).resolve(specifier);
    return true;
  } catch {
    return false;
  }
}
/**
 * A fingerprint of the installed SDK build, mixed into `optimizeDeps` so Vite re-bundles when the
 * SDK changes.
 *
 * Vite's dep-optimizer cache is keyed on the `optimizeDeps` config and the lockfile — NOT on the
 * contents of the packages it bundled. Upgrade the SDK in place (a patched dist, a linked checkout,
 * an overlay) and the version in `package.json` can stay the same, so Vite keeps serving the OLD
 * pre-bundled copy out of `node_modules/.vite` across dev-server restarts. The fix you just shipped
 * is simply not in the browser, and it looks like the fix does not work. That cost a real
 * false-negative during this bug hunt, and every user upgrading in place hits the same thing.
 *
 * Size+mtime is enough: it changes whenever the bundle does and costs one `stat`.
 */
/** The installed SDK's package version, for the HELLO's `sdkVersion`. Node-side only. */
export function sdkPackageVersion(): string {
  const require_ = createRequire(import.meta.url);
  // Preferred: the package exports its own manifest. Newer SDKs do.
  try {
    const pkg = require_(`${RETICLE_PACKAGE}/package.json`) as { version?: string };
    if (typeof pkg.version === 'string') return pkg.version;
  } catch {
    // Falls through — see below.
  }
  // Fallback, and it is load-bearing rather than defensive: an OLDER SDK has no `./package.json`
  // in its exports map, and an older SDK is precisely the skew we are trying to name. Resolve the
  // main entry instead and walk up to the manifest beside it.
  try {
    let dir = dirname(require_.resolve(RETICLE_PACKAGE));
    for (let up = 0; up < 5; up++) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string };
        if (typeof parsed.version === 'string') return parsed.version;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Unresolvable (not installed yet, exotic layout) — report nothing rather than guessing.
  }
  return '';
}

export function sdkBuildFingerprint(): string {
  try {
    const entry = createRequire(import.meta.url).resolve(RETICLE_PACKAGE);
    const { size, mtimeMs } = statSync(entry);
    return `${String(size)}-${String(Math.trunc(mtimeMs))}`;
  } catch {
    // Unresolvable (not installed yet, exotic layout) — a constant is still correct, just inert.
    return 'unknown';
  }
}
