/**
 * Pure, conservative patcher for a Vite config: add the `@reticlehq/vite-plugin` import and drop
 * `reticle` into the `plugins` array. Only handles the obvious, common shape — anything ambiguous
 * bails to a `manual` result so we never half-edit a build config (a broken config is worse than a
 * documented manual step).
 */

import { PatchKind, type SourcePatch } from './patch-kind.js';

export const VITE_IMPORT = "import { reticle } from '@reticlehq/vite-plugin';";
const RETICLE_MARKER = '@reticlehq/vite-plugin';

/** The `reticle...)` call — carries the bridge port so the injected connect targets it. */
function reticlePluginCall(port: number | undefined): string {
  return port === undefined ? 'reticle()' : `reticle({ port: ${String(port)} })`;
}
/** Matches the start of a `plugins: [` array literal. */
const PLUGINS_ARRAY = /plugins\s*:\s*\[/;
/** Matches an ES import statement (used to place our import after the last one). */
const IMPORT_LINE = /^import\s.+from\s+['"][^'"]+['"];?\s*$/gm;

/** Alias kept so existing call sites read in Vite terms; the vocabulary is shared (see patch-kind). */
export const VitePatchKind = PatchKind;
export type VitePatchKind = PatchKind;

type VitePatch = SourcePatch;

const NO_PLUGINS_REASON = "couldn't find a `plugins: [...]` array to extend";

function insertImport(source: string): string {
  const matches = [...source.matchAll(IMPORT_LINE)];
  const last = matches[matches.length - 1];
  if (last?.index === undefined) {
    return `${VITE_IMPORT}\n${source}`;
  }
  const end = last.index + last[0].length;
  return `${source.slice(0, end)}\n${VITE_IMPORT}${source.slice(end)}`;
}

/**
 * Insert right after the opening `[` of the plugins array, spaced the way the surrounding line is.
 *
 * A multi-line array puts a newline next, and `[reticle(), \n` leaves trailing whitespace — exactly
 * what a formatter rewrites, turning a one-line install into a diff against the user's own style. A
 * single-line array needs the space, or the result reads `[reticle(),react()]`.
 */
function insertPlugin(source: string, port: number | undefined): string {
  return source.replace(PLUGINS_ARRAY, (match, _g, offset: number) => {
    const next = source[offset + match.length] ?? '';
    const separator = next === '' || /\s/.test(next) ? '' : ' ';
    return `${match}${reticlePluginCall(port)},${separator}`;
  });
}

export function patchViteConfig(source: string, port?: number): VitePatch {
  if (source.includes(RETICLE_MARKER)) {
    return { kind: VitePatchKind.ALREADY };
  }
  if (!PLUGINS_ARRAY.test(source)) {
    return { kind: VitePatchKind.MANUAL, reason: NO_PLUGINS_REASON };
  }
  return { kind: VitePatchKind.APPLY, code: insertImport(insertPlugin(source, port)) };
}
