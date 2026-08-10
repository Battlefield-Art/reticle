import { describe, expect, it } from 'vitest';
import { cjsDepIncludes } from './index.js';
import { OPTIMIZER_OPTIONS_KEY, optimizerOptionsKey, optimizerOptions } from './installed.js';

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

/**
 * Where `define` goes, per bundler.
 *
 * esbuild reads it from the top level of its options; rolldown rejects it there outright and reads
 * `transform.define`. Vite 8 printed the refusal on every dev boot with Reticle's name on it:
 *
 *   Warning: Invalid input options (1 issue found)
 *   - For the "define". Invalid key: Expected never but received "define".
 *
 * The app still booted, so the only cost was a warning that blamed us and an optimizer cache key
 * that had quietly stopped including the SDK build fingerprint. Reported by a user on vite@8.0.16.
 */
describe('the optimizer define goes where the bundler will take it', () => {
  const FINGERPRINT = { __RETICLE_SDK_BUILD__: '"abc-123"' };

  it('esbuild takes define at the top level', () => {
    const options = optimizerOptions(OPTIMIZER_OPTIONS_KEY.ESBUILD, {}, FINGERPRINT);
    expect(options['define']).toEqual(FINGERPRINT);
    expect(options['transform']).toBeUndefined();
  });

  it('rolldown takes it under transform, and never at the top level', () => {
    const options = optimizerOptions(OPTIMIZER_OPTIONS_KEY.ROLLDOWN, {}, FINGERPRINT);
    // The whole bug: a top-level `define` here is what Vite 8 refuses.
    expect(options['define']).toBeUndefined();
    expect(options['transform']).toEqual({ define: FINGERPRINT });
  });

  it("keeps the app's own define, moving it rather than dropping it, on rolldown", () => {
    const options = optimizerOptions(
      OPTIMIZER_OPTIONS_KEY.ROLLDOWN,
      { define: { THEIRS: '"x"' }, target: 'es2020' },
      FINGERPRINT,
    );
    expect(options['define']).toBeUndefined();
    expect(options['transform']).toEqual({ define: { THEIRS: '"x"', ...FINGERPRINT } });
    // Everything that was not `define` is passed through untouched.
    expect(options['target']).toBe('es2020');
  });

  it("merges into an app's existing transform.define without clobbering it", () => {
    const options = optimizerOptions(
      OPTIMIZER_OPTIONS_KEY.ROLLDOWN,
      { transform: { define: { THEIRS: '"x"' }, target: 'es2020' } },
      FINGERPRINT,
    );
    expect(options['transform']).toEqual({
      define: { THEIRS: '"x"', ...FINGERPRINT },
      target: 'es2020',
    });
  });

  it("keeps the app's own define on esbuild too", () => {
    const options = optimizerOptions(
      OPTIMIZER_OPTIONS_KEY.ESBUILD,
      { define: { THEIRS: '"x"' } },
      FINGERPRINT,
    );
    expect(options['define']).toEqual({ THEIRS: '"x"', ...FINGERPRINT });
  });
});
