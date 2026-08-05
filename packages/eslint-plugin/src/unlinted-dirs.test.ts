import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noInternalTags } from './no-internal-tags.js';
import { PLUGIN_NAME } from './constants.js';

const RULE = 'no-internal-tags';

/**
 * House rule 10 — no internal tracking tags — where the linter cannot reach.
 *
 * The rule is an error across `packages/*`, and an audit once found that every LINT-ENFORCED house
 * rule sat at ~100% compliance while every PROSE-ONLY one was violated systematically. That is the
 * whole argument for this file: `apps/e2e/**` is in eslint's global `ignores` (its specs are plain
 * `.mjs` and deliberately outside the TypeScript gate) and `bench/**` is only reached by the
 * untyped block, so neither has ever been checked. Both were violated — `F1`/`F2`/`F4`/`F5` in the
 * status-honesty spec's own check descriptions, `N3`/`N4`/`N5`/`P2` in four more, `Q1/Q5` in a bench
 * harness — sitting in the strings a reader sees in the battery's output.
 *
 * Runs the SHIPPED rule rather than a regex approximation: a hand-rolled matcher flags `V8` and the
 * `[A-Z][A-Z0-9_]*` inside a regex literal, and a guard that cries wolf gets deleted.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

async function tagViolations(patterns: string[]): Promise<string[]> {
  const eslint = new ESLint({
    cwd: REPO,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.mjs'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        // The typescript-eslint RuleModule and ESLint's own RuleDefinition are structurally compatible but
        // nominally distinct; this cast is the documented way to hand one to a flat config.
        plugins: {
          [PLUGIN_NAME]: { rules: { [RULE]: noInternalTags } } as unknown as ESLint.Plugin,
        },
        rules: { [`${PLUGIN_NAME}/${RULE}`]: 'error' },
      },
    ],
  });
  const results = await eslint.lintFiles(patterns);
  return results.flatMap((r) =>
    r.messages.map((m) => `${r.filePath.replace(REPO, '')}:${String(m.line)} ${m.message}`),
  );
}

describe('house rule 10 holds in the directories eslint does not lint', () => {
  it('finds files to check (a passing scan over zero files proves nothing)', async () => {
    const eslint = new ESLint({ cwd: REPO, overrideConfigFile: true, overrideConfig: [{}] });
    const found = await eslint.lintFiles(['apps/e2e/**/*.mjs']);
    expect(found.length).toBeGreaterThan(10);
  });

  it('e2e specs carry no internal tracking tags', async () => {
    const bad = await tagViolations(['apps/e2e/**/*.mjs']);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('bench harnesses carry no internal tracking tags', async () => {
    const bad = await tagViolations(['bench/**/*.mjs']);
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
