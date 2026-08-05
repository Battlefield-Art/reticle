import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Every integration we SHIP has an app that exercises it, and a gate that runs that app.
 *
 * This is the rule `apps/` never stated, which is why it accumulated: apps arrived for a reason and
 * then nothing recorded whether that reason was still being served. Two of them — the Astro and Remix
 * examples — wire the SDK for real (Astro even connects a different way, because it SSRs its own HTML
 * and the plugin's index.html injection never fires there) and NOTHING runs either. Astro or Remix
 * support could be broken right now and every gate would still be green.
 *
 * The failure mode this prevents is shipping a broken integration, and discipline does not prevent it
 * — a red build does. Adding `packages/svelte` with no app and no spec fails here, at the moment the
 * package is added, rather than in a user's bug report.
 *
 * A thin app is CORRECT for this job: `electron-smoke` is 290 lines because its job is to prove the
 * wiring works, not to be an application. Size is not the measure; coverage is.
 */

/** Integration packages: ones a USER installs to wire Reticle into their app. */
const INTEGRATIONS = ['react', 'next', 'vite-plugin', 'babel-plugin', 'electron', 'tauri'] as const;

/**
 * Which app proves each integration, and which gate runs that app. `null` = a known, deliberate hole
 * — it must be listed WITH its reason, never left implicit, so the gap is visible in review.
 */
const COVERAGE: Record<
  string,
  { app: string; gate: string } | { app: string; gate: null; why: string }
> = {
  react: { app: 'apps/bench-app', gate: 'apps/e2e/specs/real-world-tests.mjs' },
  'vite-plugin': { app: 'apps/bench-app', gate: 'apps/e2e/specs/real-world-tests.mjs' },
  'babel-plugin': { app: 'apps/bench-app', gate: 'apps/e2e/specs/real-world-tests.mjs' },
  next: { app: 'apps/next-smoke', gate: 'apps/e2e/specs/next-smoke-test.mjs' },
  electron: { app: 'apps/electron-smoke', gate: 'apps/e2e/specs/electron-desktop-test.mjs' },
  tauri: { app: 'apps/tauri-smoke', gate: 'apps/e2e/specs/tauri-desktop-test.mjs' },
};

function shippedPackages(): string[] {
  return readdirSync(join(REPO, 'packages')).filter((p) =>
    existsSync(join(REPO, 'packages', p, 'package.json')),
  );
}

describe('every shipped integration is covered by an app AND a gate', () => {
  it('finds the packages directory', () => {
    expect(shippedPackages().length).toBeGreaterThan(5);
  });

  it.each(INTEGRATIONS)('%s has a covering app that exists on disk', (pkg) => {
    const entry = COVERAGE[pkg];
    expect(entry, `no coverage declared for packages/${pkg}`).toBeDefined();
    expect(existsSync(join(REPO, entry?.app ?? '')), `${entry?.app} is missing`).toBe(true);
  });

  it.each(INTEGRATIONS)('%s has a gate that actually runs its app', (pkg) => {
    const entry = COVERAGE[pkg];
    if (entry !== undefined && 'why' in entry && entry.gate === null) {
      // A declared hole is allowed to exist, but not to be silent.
      expect(
        entry.why.length,
        `packages/${pkg} declares a coverage hole with no reason`,
      ).toBeGreaterThan(20);
      return;
    }
    expect(existsSync(join(REPO, entry?.gate ?? '')), `${entry?.gate} is missing`).toBe(true);
  });

  /**
   * A new integration package must not be able to arrive without coverage. This is the half that
   * makes the rest self-maintaining: the list above cannot silently fall behind `packages/`.
   */
  it('has no shipped integration package missing from the coverage map', () => {
    const known = new Set<string>([
      ...INTEGRATIONS,
      // Not integrations: the contract, the SDK itself, the daemon, and dev tooling.
      'core',
      'browser',
      'server',
      'test',
      'eslint-plugin',
    ]);
    const unmapped = shippedPackages().filter((p) => !known.has(p));
    expect(
      unmapped,
      'a package was added without declaring how it is covered — add it to COVERAGE with an app and a gate, or to the non-integration list',
    ).toEqual([]);
  });

  /**
   * The promise that must not break: what `SKILL.md` offers a USER.
   *
   * SKILL.md is the public skill people paste into their own repo, and it asks "what framework is
   * this app?" with a fixed list. Every option on that list is a claim of support. Measured: it offers
   * **Vue, Svelte and SvelteKit**, and there is no app and no gate for any of them — while
   * `examples/astro` exists for a framework the skill never offers. Promise and proof were out of sync
   * in both directions, and nothing said so.
   *
   * This pins the CURRENT gap rather than asserting it is empty. Closing one (an app + a spec) makes
   * this test fail, and the fix is to move that framework out of the gap list — a deliberate edit that
   * records the coverage arriving, instead of a silent pass.
   */
  const UNPROVEN_FRAMEWORKS = ['SvelteKit', 'Vite + Svelte', 'Vite + Vue', 'Remix'] as const;

  it('the frameworks SKILL.md offers with no app and no gate are exactly the known gap', () => {
    const skill = readFileSync(join(REPO, 'SKILL.md'), 'utf8');
    const offered = [
      'Vite + React',
      'Next.js',
      'Vite + Vue',
      'Vite + Svelte',
      'SvelteKit',
      'Remix',
    ];
    const missingFromSkill = offered.filter((f) => !skill.includes(f));
    expect(missingFromSkill, 'SKILL.md changed its framework list — update this guard').toEqual([]);

    const specDir = join(REPO, 'apps/e2e/specs');
    const specs = readdirSync(specDir)
      .map((f) => readFileSync(join(specDir, f), 'utf8').toString())
      .join('\n');
    const HAS_APP: Record<string, string> = {
      'Vite + React': 'bench-app',
      'Next.js': 'next-smoke',
      Remix: 'examples/remix',
    };
    const unproven = offered.filter((f) => {
      const app = HAS_APP[f];
      return app === undefined || !specs.includes(app);
    });
    expect(
      unproven.sort(),
      'a framework offered to users gained or lost coverage — update UNPROVEN_FRAMEWORKS deliberately',
    ).toEqual([...UNPROVEN_FRAMEWORKS].sort());
  });
});
