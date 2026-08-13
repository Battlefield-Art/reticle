/**
 * A Chromium hint you can satisfy by following it.
 *
 * `npx playwright install chromium` looks obviously right and is quietly wrong. `npx` resolves the
 * LATEST playwright, which pins a different browser revision than the playwright the daemon actually
 * bundles — so the command downloads ~90 MiB of a build the daemon will not use, and the check still
 * says missing afterwards. Reported from the field by an agent whose machine already had five
 * chromium builds, none of them the wanted one, with no way to learn which one was wanted.
 *
 * Two things fix it, and they are the same two things any unsatisfiable check needs: pin the command
 * to the version doing the asking, and say what was probed. A check that reports only its verdict
 * cannot be argued with — the reader has no way to tell a missing browser from a bad lookup.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

/** What the check found, gathered by the caller so this stays pure and testable. */
export interface ChromiumProbe {
  /** Executable path the daemon's own playwright resolves to; undefined when playwright is absent. */
  executablePath?: string | undefined;
  /** Whether that path exists on disk. */
  exists: boolean;
  /** Version of the playwright the DAEMON bundles — not whatever `npx` would fetch. */
  playwrightVersion?: string | undefined;
}

/**
 * The install command, pinned when we know what to pin to.
 *
 * Unpinned is still the right fallback: a wrong-revision download is a bad outcome, but no command
 * at all is a worse one.
 */
export function chromiumInstallCommand(playwrightVersion?: string): string {
  const pin = playwrightVersion === undefined ? 'playwright' : `playwright@${playwrightVersion}`;
  return `npx ${pin} install chromium`;
}

/**
 * Ask the playwright THIS process would use, not the one `npx` would fetch.
 *
 * Both halves matter: `executablePath()` resolves the revision the daemon will actually launch, and
 * the bundled package version is what makes the suggested command install that same revision.
 */
export async function probeChromium(): Promise<ChromiumProbe> {
  try {
    const { chromium } = await import('playwright');
    const executablePath = chromium.executablePath();
    return {
      executablePath,
      exists: existsSync(executablePath),
      playwrightVersion: bundledPlaywrightVersion(),
    };
  } catch {
    // Playwright itself is absent — a different problem from a missing browser, and the hint says so.
    return { exists: false };
  }
}

/** The bundled playwright's version, or undefined if it cannot be read (the hint then goes unpinned). */
export function bundledPlaywrightVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg: unknown = require('playwright/package.json');
    if ('object' === typeof pkg && null !== pkg && 'version' in pkg) {
      const { version } = pkg;
      if ('string' === typeof version) return version;
    }
  } catch {
    /* an unreadable package.json is not worth failing a diagnostic over */
  }
  return undefined;
}

/** The doctor line for the Chromium check — verdict, what was probed, and how to satisfy it. */
export function chromiumHint(probe: ChromiumProbe): string {
  if (probe.exists) return '✓ installed';
  const command = chromiumInstallCommand(probe.playwrightVersion);
  // Naming the path is what turns "missing" from a verdict into evidence: a reader with browsers on
  // disk can see immediately whether this is a missing install or a lookup pointed somewhere else
  // (PLAYWRIGHT_BROWSERS_PATH, a different browsers root, a revision bump).
  const probed =
    probe.executablePath === undefined
      ? 'the playwright package is not installed'
      : `looked for ${probe.executablePath}`;
  return `✗ missing — ${probed}; run: ${command}`;
}
