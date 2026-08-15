/**
 * A Vue or Svelte codebase must not be told to install `@reticlehq/react`.
 *
 * The reasoning was already written down in this file, for Nuxt:
 *
 *   "The framework-neutral sensor, NOT the React kit. Nuxt renders Vue, and installing a package
 *    named @reticlehq/react — with `react` in its peer dependencies — into a Vue codebase is the
 *    single thing most likely to make someone abandon the setup, whether or not it works."
 *
 * It was applied to the one framework whose NAME implies Vue, and not to the case where the same
 * thing is true and the name does not say so. A Vue app on plain Vite is `Framework.VITE`, and a
 * SvelteKit app is Svelte, and both were handed the React kit.
 *
 * Found by running `reticle init --dry-run` against a real Electron + Vue + Pinia app (MarkText, the
 * `electron-vue-pinia` fixture from #121, which nobody had ever run the installer against). The
 * output detected Vue correctly, said in as many words that React component identity is what you
 * will NOT get — and then, four lines later, told the reader to install `@reticlehq/react`.
 *
 * The UI library is detected before any of this runs, so the information was there the whole time.
 */

import { describe, expect, it } from 'vitest';
import { frameworkPackages } from './plan.js';
import { Framework, UiLibrary } from './detect.js';

const REACT_KIT = '@reticlehq/react';
const SENSOR = '@reticlehq/browser';

describe('the React kit is only installed into a React codebase', () => {
  it('gives a Vue app on Vite the framework-neutral sensor', () => {
    const packages = frameworkPackages(Framework.VITE, UiLibrary.VUE);
    expect(
      packages,
      'a Vue codebase must not be handed a package named @reticlehq/react',
    ).not.toContain(REACT_KIT);
    expect(packages).toContain(SENSOR);
  });

  it('gives a Svelte app on SvelteKit the sensor too', () => {
    const packages = frameworkPackages(Framework.SVELTEKIT, UiLibrary.SVELTE);
    expect(packages).not.toContain(REACT_KIT);
    expect(packages).toContain(SENSOR);
  });

  it('still gives a React app on Vite the React kit', () => {
    // The direction that must not regress: React identity is the thing the kit is FOR, and the
    // whole find→fix loop is weaker without component names.
    expect(frameworkPackages(Framework.VITE, UiLibrary.REACT)).toContain(REACT_KIT);
  });

  it('still gives Next the React kit, since Next is React by construction', () => {
    expect(frameworkPackages(Framework.NEXT, UiLibrary.REACT)).toContain(REACT_KIT);
  });

  it('treats Preact as React, because the adapter works through preact/compat', () => {
    // Documented behaviour elsewhere in the repo: Preact gets component identity via the React
    // adapter. Sending it the bare sensor would be a downgrade, not a fix.
    expect(frameworkPackages(Framework.VITE, UiLibrary.PREACT)).toContain(REACT_KIT);
  });

  it('keeps the React kit when the UI library cannot be determined', () => {
    // Unknown is not evidence of Vue. The kit is harmless in a React-ish app and the build plugin
    // needs a peer; guessing "sensor" on no evidence would silently drop component identity from
    // apps that should have it.
    expect(frameworkPackages(Framework.VITE, UiLibrary.UNKNOWN)).toContain(REACT_KIT);
  });

  it('still gives Nuxt the sensor, which is where this rule was already right', () => {
    expect(frameworkPackages(Framework.NUXT, UiLibrary.VUE)).not.toContain(REACT_KIT);
  });
});
