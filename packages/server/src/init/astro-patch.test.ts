/**
 * Astro was the last gated stack where `init` printed a correct recipe and applied none of it — the
 * only ⚠ left on a supported framework, and two hand-copied snippets before a user's first session.
 *
 * Auto-patching is only safe where the shape is unambiguous, so these pin BOTH directions: the
 * common shape is patched, and anything the patcher does not fully recognise (an existing `vite:`
 * key it would have to merge into, a layout with no `</body>`) bails to the printed recipe rather
 * than half-editing a build config.
 */

import { describe, expect, it } from 'vitest';
import { patchAstroConfig, patchAstroLayout } from './astro-patch.js';
import { PatchKind } from './patch-kind.js';

const PLAIN_CONFIG = `import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [],
});
`;

const PLAIN_LAYOUT = `---
const { title } = Astro.props;
---
<html lang="en">
  <body>
    <slot />
  </body>
</html>
`;

describe('patchAstroConfig', () => {
  it('adds the token/root define and the raised build target to the common shape', () => {
    const patch = patchAstroConfig(PLAIN_CONFIG);
    expect(patch.kind).toBe(PatchKind.APPLY);
    if (patch.kind !== PatchKind.APPLY) return;
    expect(patch.code).toContain('__RETICLE_TOKEN__');
    // Without root, source pointers come back as absolute paths from the machine that ran init.
    expect(patch.code).toContain('__RETICLE_ROOT__');
    // Astro's default target down-levels the modern SDK bundle and dies on a destructuring transform.
    expect(patch.code).toContain("target: 'es2022'");
    expect(patch.code).toContain('defineConfig');
    expect(patch.code).toContain('integrations: []'); // the user's own config survives
  });

  it('is idempotent — a second init reports ALREADY rather than defining the token twice', () => {
    const once = patchAstroConfig(PLAIN_CONFIG);
    if (once.kind !== PatchKind.APPLY) throw new Error('expected a patch');
    expect(patchAstroConfig(once.code).kind).toBe(PatchKind.ALREADY);
  });

  it('refuses to merge into an existing vite: key — a broken build config is worse than a manual step', () => {
    const withVite = `import { defineConfig } from 'astro/config';
export default defineConfig({
  vite: { build: { target: 'es2018' } },
});
`;
    const patch = patchAstroConfig(withVite);
    expect(patch.kind).toBe(PatchKind.MANUAL);
    if (patch.kind !== PatchKind.MANUAL) return;
    expect(patch.reason).toContain('vite');
  });

  it('refuses a config shape it does not recognise', () => {
    const patch = patchAstroConfig('export default {};\n');
    expect(patch.kind).toBe(PatchKind.MANUAL);
  });
});

describe('patchAstroLayout', () => {
  it('inserts the dev-only connect script before </body>', () => {
    const patch = patchAstroLayout(PLAIN_LAYOUT, undefined, undefined);
    expect(patch.kind).toBe(PatchKind.APPLY);
    if (patch.kind !== PatchKind.APPLY) return;
    expect(patch.code).toContain('reticle.connect');
    expect(patch.code).toContain('import.meta.env.DEV');
    expect(patch.code.indexOf('reticle.connect')).toBeLessThan(patch.code.indexOf('</body>'));
    expect(patch.code).toContain('<slot />'); // the user's own markup survives
  });

  it('carries a non-default port and the projectId into the connect', () => {
    const patch = patchAstroLayout(PLAIN_LAYOUT, 7331, 'shop-1a2b');
    if (patch.kind !== PatchKind.APPLY) throw new Error('expected a patch');
    expect(patch.code).toContain('7331');
    expect(patch.code).toContain('shop-1a2b');
  });

  it('is idempotent — a layout already carrying a connect reports ALREADY', () => {
    const once = patchAstroLayout(PLAIN_LAYOUT, undefined, undefined);
    if (once.kind !== PatchKind.APPLY) throw new Error('expected a patch');
    expect(patchAstroLayout(once.code, undefined, undefined).kind).toBe(PatchKind.ALREADY);
  });

  it('refuses a layout with no </body> rather than guessing where the script goes', () => {
    const patch = patchAstroLayout('<slot />\n', undefined, undefined);
    expect(patch.kind).toBe(PatchKind.MANUAL);
  });
});
