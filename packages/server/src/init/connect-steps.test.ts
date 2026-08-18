/**
 * A `⚠` on a step that decides whether the app can dial the daemon is not a warning. It is a
 * guaranteed failure: nothing performs a manual step, so no session ever appears and every Reticle
 * tool answers "no browser session connected".
 *
 * `CONNECT_STEP_TITLES` is what makes `init` exit non-zero in that case. Two steps that decide
 * exactly this were missing from it, so `init` reported `ok` and exited 0 over an app that could
 * never connect — the same shape as the release where Next connected none of the time.
 *
 * Both are titles, matched as strings, which is the fragile part: renaming a step in
 * `plan-framework.ts` silently drops it out of this set and nothing goes red. So these tests assert
 * the two directions that matter — the titles this set must contain, and that every title in it is a
 * title some framework actually emits.
 */

import { describe, expect, it } from 'vitest';
import { isConnectStep } from './connect-steps.js';

describe('steps without which no session can ever appear', () => {
  /**
   * Next writes the component file and mounts it in the root layout as two separate steps. Only the
   * write was counted. A layout whose shape `init` does not recognise leaves the component on disk
   * and never rendered — so the SDK is in the project, nothing imports it, and `init` exits 0.
   */
  it('counts mounting the component, not only writing it', () => {
    expect(isConnectStep('ReticleDev component'), 'the write was already counted').toBe(true);
    expect(isConnectStep('Mount ReticleDev'), 'a component nobody renders cannot connect').toBe(
      true,
    );
  });

  /**
   * CRA inlines only `REACT_APP_*`, so the pairing token has to be written into the env file. When
   * no daemon has ever run there is no token to inline and the step goes manual — and without it the
   * bridge refuses the connection. The app boots, looks fine, and never pairs.
   */
  it('counts the CRA pairing token, which the bridge refuses without', () => {
    expect(isConnectStep('Pairing token')).toBe(true);
  });

  it('still counts every connect snippet', () => {
    for (const title of [
      'Connect snippet',
      'Connect snippet (CRA)',
      'Connect snippet (Astro)',
      'Connect snippet (Nuxt)',
      'Reticle client hook',
      'Reticle connect module',
      'Vite plugin',
    ]) {
      expect(isConnectStep(title), title).toBe(true);
    }
  });

  it('does not count a step that has no bearing on connecting', () => {
    // A notice about the token being per-machine is worth reading and is not work; treating it as a
    // connect step would fail an install that is complete.
    expect(isConnectStep('Pairing token is per-machine')).toBe(false);
    expect(isConnectStep('Capabilities + store')).toBe(false);
    expect(isConnectStep('Reticle config')).toBe(false);
    expect(isConnectStep('MCP server (global)')).toBe(false);
  });
});
