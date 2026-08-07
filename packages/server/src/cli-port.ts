/**
 * Port resolution for the reticle CLI. Split out so it can be unit-tested independently.
 *
 * Priority (highest → lowest):
 * 1. --port flag (parsed by parseCliArgs, already overrides defaultPort)
 * 2. RETICLE_PORT env var
 * 3..reticle.json "port" field in the cwd ← per-project isolation
 * 4. RETICLE_DEFAULT_PORT (4400)
 */

import { readFileSync } from 'node:fs';

/**
 * Ports that belong to a DEV SERVER, not to Reticle's bridge. Next defaults to 3000, Vite to 5173,
 * Astro to 4321, and so on.
 *
 * `.reticle.json`'s `port` is the bridge — the daemon ↔ SDK channel, default 4400 — and it has
 * nothing to do with the port the app is served on. Setting it to the dev-server port makes the
 * daemon try to bind the port the app already holds; what the user sees is either a bind failure or
 * a daemon that never connects, neither of which mentions the actual mistake. The old setup skill
 * asked "what port does your dev server run on?" a few lines before showing this field, which is how
 * the confusion got manufactured in the first place.
 */
export const DEV_SERVER_PORTS: ReadonlySet<number> = new Set([
  3000, 3001, 4200, 4321, 5000, 5173, 5174, 8000, 8080, 8100, 9000,
]);

export function isLikelyDevServerPort(port: number): boolean {
  return DEV_SERVER_PORTS.has(port);
}

/** The warning printed when a project pins the bridge to something that looks like its dev server. */
export function devServerPortWarning(port: number): string {
  return `[reticle] .reticle.json sets "port": ${port}, which is a common DEV-SERVER port. That field is the Reticle BRIDGE port (default 4400), not the port your app is served on — they must be different, or the daemon fights your dev server for it. Remove "port" unless you are running several apps at once.`;
}

/**
 * Read the port stored in the project's .reticle.json (written by `reticle init`).
 * Returns undefined if the file is absent, unreadable, or has no valid numeric port.
 */
export function readProjectPort(cwd: string): number | undefined {
  try {
    const raw = readFileSync(`${cwd}/.reticle.json`, 'utf8');
    const config: unknown = JSON.parse(raw);
    if (typeof config === 'object' && config !== null) {
      const p = (config as Record<string, unknown>)['port'];
      if (typeof p === 'number' && Number.isInteger(p) && p > 0 && p < 65536) return p;
    }
  } catch {
    //.reticle.json absent or unreadable — fall through to default
  }
  return undefined;
}

/**
 * Read the stable projectId stored in the project's .reticle.json (written by `reticle init`). The daemon
 * uses it as the default resolve scope so auto-selection stays within the active app. Returns
 * undefined if the file is absent/unreadable or has no non-empty string projectId.
 */
export function readProjectId(cwd: string): string | undefined {
  try {
    const raw = readFileSync(`${cwd}/.reticle.json`, 'utf8');
    const config: unknown = JSON.parse(raw);
    if (typeof config === 'object' && config !== null) {
      const id = (config as Record<string, unknown>)['projectId'];
      if (typeof id === 'string' && id.length > 0) return id;
    }
  } catch {
    //.reticle.json absent or unreadable — no default scope
  }
  return undefined;
}

/**
 * Whether the durable causal journal is enabled. On by default (the journal IS the loop); off only via
 * explicit opt-out — `.reticle.json` `"journal": false`, or `RETICLE_JOURNAL` set to `0`/`false`. The env
 * wins so CI/tests can force it off without editing the project file.
 */
export function readJournalEnabled(cwd: string, env: string | undefined): boolean {
  if (env !== undefined) {
    const v = env.trim().toLowerCase();
    if (v === '0' || v === 'false' || v === 'off') return false;
    if (v === '1' || v === 'true' || v === 'on') return true;
  }
  try {
    const raw = readFileSync(`${cwd}/.reticle.json`, 'utf8');
    const config: unknown = JSON.parse(raw);
    if (typeof config === 'object' && config !== null) {
      if ((config as Record<string, unknown>)['journal'] === false) return false;
    }
  } catch {
    //.reticle.json absent or unreadable — journaling stays on by default
  }
  return true;
}

/**
 * Resolve the daemon port from all available sources in priority order.
 * Pass `portFlag` when the user explicitly supplied --port; pass `undefined` to fall through.
 */
export function resolvePort(
  portFlag: number | undefined,
  envPort: number | undefined,
  projectPort: number | undefined,
  defaultPort: number,
): number {
  return portFlag ?? envPort ?? projectPort ?? defaultPort;
}
