/**
 * A root `vitest run` must not collect tests from other agents' worktrees.
 *
 * Those directories are full checkouts of other branches. Their failures are real for those
 * branches and meaningless for this one. `pnpm test:unit` is safe — turbo scopes per package —
 * but `pnpm vitest run <file>` from the repo root is exactly how someone narrows to one file,
 * and without an exclude it walks every worktree and reports those failures as this checkout's.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CLAUDE_WORKTREES = '.claude/worktrees';
const PROBE_DIR = 'exclude-probe';
const PROBE_FILE = 'must-not-run.test.ts';
const PROBE_SENTINEL = 'root vitest collected a test from an agent worktree';
const ROOT_CONFIG = 'vitest.config.ts';
const CLAUDE_WORKTREE_GLOB = '**/.claude/worktrees/**';
const CURSOR_WORKTREE_GLOB = '**/.cursor/worktrees/**';
const NODE_MODULES_GLOB = '**/node_modules/**';
const PASS_WITH_NO_TESTS = '--passWithNoTests';
const VITEST_RUN = 'run';
const SPAWN_TIMEOUT_MS = 30_000;

const planted = join(REPO, CLAUDE_WORKTREES, PROBE_DIR);

afterEach(() => {
  rmSync(planted, { recursive: true, force: true });
});

describe('root vitest excludes agent worktrees', () => {
  it('does not run a failing test planted in a Claude worktree', () => {
    mkdirSync(planted, { recursive: true });
    writeFileSync(
      join(planted, PROBE_FILE),
      `import { it } from 'vitest';\nit('must not be collected', () => { throw new Error(${JSON.stringify(PROBE_SENTINEL)}); });\n`,
    );

    const result = spawnSync(
      'pnpm',
      ['exec', 'vitest', VITEST_RUN, PASS_WITH_NO_TESTS, CLAUDE_WORKTREES],
      { cwd: REPO, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS },
    );
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    expect(result.status, output).toBe(0);
    expect(output).not.toContain(PROBE_SENTINEL);
  });

  it('keeps vitest defaults and names both in-repo agent worktree trees', async () => {
    const mod = (await import(pathToFileURL(join(REPO, ROOT_CONFIG)).href)) as {
      default: { test?: { exclude?: string[] } };
      AGENT_WORKTREE_GLOBS: readonly string[];
    };
    const exclude = mod.default.test?.exclude ?? [];
    expect(mod.AGENT_WORKTREE_GLOBS).toEqual([CLAUDE_WORKTREE_GLOB, CURSOR_WORKTREE_GLOB]);
    expect(exclude).toEqual(
      expect.arrayContaining([...mod.AGENT_WORKTREE_GLOBS, NODE_MODULES_GLOB]),
    );
  });
});
