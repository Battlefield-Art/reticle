/**
 * Pure, conservative patchers for an Astro app: the config gets the token/root `define` and the
 * raised build target, one layout gets the dev-only connect `<script>`.
 *
 * Astro was the last gated framework where `init` printed a correct recipe and applied none of it —
 * the only ⚠ left on a supported stack, and the user's first session was two hand-copied snippets
 * away. Astro is Vite-based but renders its own HTML, so the Vite plugin's injection never fires and
 * there is no entry module to wire: the connect has to live in a page or layout `<script>`, and the
 * token has to be inlined by the config because nothing else is in the page's path to inject it.
 *
 * Both patchers bail to `manual` (the printed recipe) on any shape they do not fully recognise.
 * Half-editing a build config is worse than a documented manual step.
 */

import { RETICLE_DEFAULT_PORT, bridgeWsUrl } from '@reticlehq/core';
import { PatchKind, type SourcePatch } from './patch-kind.js';

/** Present in a patched config AND in a hand-followed recipe — so both count as already wired. */
const CONFIG_MARKER = '__RETICLE_TOKEN__';
/** Present in a patched layout and in the printed recipe's script. */
const LAYOUT_MARKER = 'reticle.connect';

const DEFINE_CONFIG = /defineConfig\s*\(\s*\{/;
/** A `vite:` key already in the config — merging into one is not a text edit we can do safely. */
const EXISTING_VITE_KEY = /^\s*vite\s*:/m;
const BODY_CLOSE = '</body>';

const HELPER = `
function reticleToken() {
  const dir = process.env['RETICLE_PAIRING_TOKEN_DIR'] || join(homedir(), '.reticle');
  try { return readFileSync(join(dir, 'pairing-token'), 'utf8').trim(); } catch { return ''; }
}
`;

const HELPER_IMPORTS = `import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
`;

/**
 * The `vite:` block Astro needs. `build.target` is raised because Astro's default down-levels the
 * modern SDK bundle and dies on a destructuring transform; `__RETICLE_ROOT__` is defined because
 * without it every source pointer comes back as an absolute path from the machine that ran `init`.
 */
const VITE_BLOCK = `  vite: {
    build: { target: 'es2022' },
    optimizeDeps: { esbuildOptions: { target: 'es2022' } },
    define: {
      __RETICLE_TOKEN__: JSON.stringify(reticleToken()),
      __RETICLE_ROOT__: JSON.stringify(process.cwd()),
    },
  },
`;

export function patchAstroConfig(source: string): SourcePatch {
  if (source.includes(CONFIG_MARKER)) return { kind: PatchKind.ALREADY };
  if (EXISTING_VITE_KEY.test(source)) {
    return {
      kind: PatchKind.MANUAL,
      reason:
        'this config already has a `vite:` key — merging into it is your call, not a text edit Reticle should make',
    };
  }
  const opening = DEFINE_CONFIG.exec(source);
  if (opening?.index === undefined) {
    return { kind: PatchKind.MANUAL, reason: "couldn't find a `defineConfig({ ... })` call to extend" };
  }
  const at = opening.index + opening[0].length;
  const withBlock = `${source.slice(0, at)}\n${VITE_BLOCK}${source.slice(at)}`;
  return { kind: PatchKind.APPLY, code: `${HELPER_IMPORTS}${withBlock.trimStart()}\n${HELPER}`.trimEnd() + '\n' };
}

/** The dev-only connect that goes inside the layout's `<body>`. */
export function astroConnectScript(port: number | undefined, projectId: string | undefined): string {
  const url = port !== undefined && port !== RETICLE_DEFAULT_PORT ? `\n          url: '${bridgeWsUrl(port)}',` : '';
  const id = projectId !== undefined && projectId.length > 0 ? `\n          projectId: '${projectId}',` : '';
  return `    <script>
      if (import.meta.env.DEV) {
        const token = typeof __RETICLE_TOKEN__ !== 'undefined' ? __RETICLE_TOKEN__ : '';
        const root = typeof __RETICLE_ROOT__ !== 'undefined' ? __RETICLE_ROOT__ : '';
        const { reticle, install } = await import('@reticlehq/react');
        install();
        reticle.connect({${id}${url}
          ...(token.length > 0 ? { token } : {}),
          ...(root.length > 0 ? { root } : {}),
        });
      }
    </script>
`;
}

export function patchAstroLayout(
  source: string,
  port: number | undefined,
  projectId: string | undefined,
): SourcePatch {
  if (source.includes(LAYOUT_MARKER)) return { kind: PatchKind.ALREADY };
  const at = source.lastIndexOf(BODY_CLOSE);
  if (at < 0) {
    return {
      kind: PatchKind.MANUAL,
      reason: "couldn't find a `</body>` to place the connect script before",
    };
  }
  return {
    kind: PatchKind.APPLY,
    code: `${source.slice(0, at)}${astroConnectScript(port, projectId)}${source.slice(at)}`,
  };
}
