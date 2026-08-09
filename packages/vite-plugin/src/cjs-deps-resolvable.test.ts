import { describe, expect, it } from 'vitest';
import { cjsDepIncludes } from './index.js';
import { OPTIMIZER_OPTIONS_KEY, optimizerOptionsKey } from './installed.js';

/**
 * Only name a dependency Vite can actually resolve — which, under a strict layout, means the BARE
 * specifier and not a nested `a > b > c` chain.
 *
 * The plugin's own comment already stated the rule ("a name Vite cannot resolve is worse than no
 * name: it prints `Failed to resolve dependency: …, present in optimizeDeps.include` and forces a
 * full re-optimization on EVERY cold boot") and then broke it, because the guard asked the wrong
 * question. It tested NODE resolvability, walking the chain segment by segment. Under pnpm that
 * succeeds where Vite fails:
 *
 *   ['@testing-library/dom']                                          -> null
 *   ['@reticlehq/browser', '@testing-library/dom']                    -> null
 *   ['@reticlehq/react', '@reticlehq/browser', '@testing-library/dom'] -> emitted
 *
 * So on the sveltekit fixture we emitted the three-segment chain, Vite could not follow it, and the
 * boot warning the guard exists to prevent appeared anyway — pointing at Reticle, for a dependency
 * the developer has never heard of.
 *
 * Dropping the nested form is safe: the SDK itself is still pre-bundled, and Vite follows its
 * imports when it does that. The separate names were belt-and-braces for a locally-aliased SDK.
 */
describe('optimizeDeps names only what Vite can resolve', () => {
  const nothingResolves = () => false;
  const everythingResolves = () => true;

  it('emits nothing when the deps are not reachable from the app root', () => {
    // The strict-layout case: this is where the nested chain used to be emitted and Vite used to
    // fail on it.
    expect(cjsDepIncludes('/app', nothingResolves)).toEqual([]);
  });

  it('emits the bare names when they ARE reachable', () => {
    expect(cjsDepIncludes('/app', everythingResolves)).toEqual([
      '@testing-library/dom',
      'aria-query',
    ]);
  });

  it('never emits a nested chain, whatever the layout', () => {
    for (const resolver of [nothingResolves, everythingResolves]) {
      for (const entry of cjsDepIncludes('/app', resolver)) {
        expect(entry, `nested chains are not Vite-resolvable under pnpm: ${entry}`).not.toContain(
          '>',
        );
      }
    }
  });

  it('asks about each dependency by its bare specifier — never a chain', () => {
    const asked: string[] = [];
    cjsDepIncludes('/app', (dep) => {
      asked.push(dep);
      return false;
    });
    expect(asked).toEqual(['@testing-library/dom', 'aria-query']);
  });
});

/**
 * Vite 7 moved the dep optimizer to rolldown and deprecated `optimizeDeps.esbuildOptions`, warning
 * on every boot to use `rolldownOptions` instead. The warning is attributed to whichever plugin set
 * the option — us — so a user on Vite 7 sees Reticle nagging them about Reticle's own config.
 *
 * Unknown versions keep the older key on purpose: a deprecation notice is a far smaller failure than
 * handing an installed Vite an option it has never heard of.
 */
describe('the optimizer options key follows the installed Vite', () => {
  it.each([
    [7, OPTIMIZER_OPTIONS_KEY.ROLLDOWN],
    [8, OPTIMIZER_OPTIONS_KEY.ROLLDOWN],
    [6, OPTIMIZER_OPTIONS_KEY.ESBUILD],
    [5, OPTIMIZER_OPTIONS_KEY.ESBUILD],
  ])('vite %i uses %s', (major, expected) => {
    expect(optimizerOptionsKey(major)).toBe(expected);
  });

  it('falls back to the older key when the version cannot be read', () => {
    expect(optimizerOptionsKey(null)).toBe(OPTIMIZER_OPTIONS_KEY.ESBUILD);
  });
});
