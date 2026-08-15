/**
 * A guard that reads another package's files must be invalidated by them.
 *
 * Eleven tests in this package scan the repo outside their own directory: browser sources, the docs
 * site, `apps/`, `bench/`, the skills, the plugin manifests. Turbo's cache key for
 * `@reticlehq/server#test:unit` is, by default, this package plus its dependency graph — and
 * `@reticlehq/server` does not depend on `@reticlehq/browser` at all. So a change anywhere in those
 * trees left the key untouched and the guards replayed a pass recorded against different files.
 *
 * Reproduced before this was written: edit `packages/browser/src/dom/refs.ts`, run `pnpm test:unit`,
 * and `@reticlehq/server:test:unit` reports `cache hit, replaying logs`. The guard did not run.
 *
 * That is a false green in the gate itself, which is worse than the defects these guards catch: the
 * whole value of a source-scanning guard is that it fails locally, before CI. It surfaced when a
 * heavy browser test was added, the full local gate went green, and CI then failed on macos, windows
 * and verify at once — the signature of a real failure rather than a flake. The person running it
 * did nothing wrong; `pnpm test:unit` said success, and the guard is what is supposed to stop that.
 *
 * The fix is `inputs` on that one task using `$TURBO_ROOT$`, which turbo 2.x supports and which
 * [#282](https://github.com/reticlehq/reticle/issues/282) doubted would work. It does; it was
 * measured. That beats `globalDependencies` (busts every task's cache on any browser change) and
 * beats moving the guards to a new tooling package (a bigger change for the same result).
 *
 * This test exists because the fix is a config file nobody reads. The next cross-package guard will
 * be written by someone who does not know turbo.json is load-bearing, and it would be silently
 * uncached from the day it lands — indistinguishable from working.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = join(HERE, '..');
const REPO = join(HERE, '..', '..', '..', '..');

/** The task whose cache key has to cover everything these guards read. */
const TASK = '@reticlehq/server#test:unit';

interface TurboConfig {
  tasks?: Record<string, { inputs?: string[] }>;
}

function declaredInputs(): string[] {
  const config = JSON.parse(readFileSync(join(REPO, 'turbo.json'), 'utf8')) as TurboConfig;
  return config.tasks?.[TASK]?.inputs ?? [];
}

/** This file's own name, so its example strings are not read as real reads. */
const SELF = 'guards-are-cache-invalidated.test.ts';

function sourceFiles(dir: string = SERVER_SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if ('node_modules' === entry || 'dist' === entry || entry === SELF) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Repo-root paths this package's tests read, as written.
 *
 * Matched on `join(REPO, '<name>'` because that is the one spelling every cross-package guard here
 * uses to escape its own directory — they all derive `REPO` by walking up from `import.meta.url`.
 * A guard that reached out some other way would be missed, which is a real limit and is why the
 * message below says what to do rather than only what is wrong.
 */
function repoPathsRead(): Set<string> {
  const paths = new Set<string>();
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/join\(\s*REPO,\s*'([^']+)'/g)) {
      const first = match[1];
      if (first !== undefined) paths.add(first);
    }
  }
  return paths;
}

/**
 * Does any declared input cover this repo-root path?
 *
 * Prefix matching in BOTH directions, because the two are written at different granularities: a test
 * reading `apps/e2e/specs` is covered by an input of `apps` plus a wildcard tail, and a test reading
 * `packages` is covered by an input that names a wildcard package and its `src`. Neither is an exact
 * string match, and requiring one would demand an input entry per directory a guard happens to name.
 *
 * (Those globs are described rather than written out: a literal star-slash inside a block comment
 * ends it, which is exactly how this file first failed to parse.)
 *
 * `packages/server/...` is this package's own tree, already covered by `$TURBO_DEFAULT$`, so it is
 * never a gap.
 */
function isCovered(path: string, inputs: readonly string[]): boolean {
  if (path.startsWith('packages/server')) return true;
  const segments = (p: string): string[] => p.split('/').filter((s) => '' !== s && '**' !== s);
  const want = segments(path);
  return inputs.some((input) => {
    if (!input.startsWith('$TURBO_ROOT$/')) return false;
    const have = segments(input.replace('$TURBO_ROOT$/', ''));
    // One covers the other when every segment they share matches, wildcards included.
    const shared = Math.min(have.length, want.length);
    for (let i = 0; i < shared; i++) {
      if (have[i] !== '*' && have[i] !== want[i]) return false;
    }
    return true;
  });
}

describe('cross-package guards are cache-invalidated by what they scan', () => {
  it('declares inputs for the task at all', () => {
    expect(
      declaredInputs().length,
      `${TASK} has no \`inputs\` in turbo.json, so its cache key is this package plus its ` +
        `dependency graph — and the guards here read trees this package does not depend on. ` +
        `Without \`$TURBO_ROOT$\` inputs they replay a pass recorded against different files.`,
    ).toBeGreaterThan(1);
  });

  it('keeps $TURBO_DEFAULT$, so the package’s own sources still count', () => {
    // Listing `inputs` REPLACES the default set. Dropping this would mean a change to the server's
    // own source no longer invalidated its own tests, which is a far bigger hole than the one this
    // is fixing and would look identical from the outside.
    expect(declaredInputs()).toContain('$TURBO_DEFAULT$');
  });

  it('covers every repo-root path these tests actually read', () => {
    const inputs = declaredInputs();
    const missing = [...repoPathsRead()].filter((path) => !isCovered(path, inputs)).sort();

    expect(
      missing,
      `These tests read repo-root paths that no declared input covers, so a change to them leaves ` +
        `the cache key untouched and the guard replays an old pass. Add ` +
        `"$TURBO_ROOT$/<path>/**" to the \`inputs\` of ${TASK} in turbo.json:\n` +
        missing.map((p) => `  $TURBO_ROOT$/${p}`).join('\n'),
    ).toEqual([]);
  });
});
