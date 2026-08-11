import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DOCS = join(REPO, 'docs');

/**
 * `docs/` serves two audiences — users (published to reticle.sh via mint.json) and contributors
 * (not published) — and for a long time nothing recorded which was which. Twenty-five files sat in
 * one flat directory, six of them invisible to the docs site, and the only way to find out where a
 * page belonged was to open it.
 *
 * `docs/README.md` is the index that fixes that. An index is worth exactly as much as its accuracy,
 * and an index maintained by discipline is one that is wrong within two months — so the rule is a
 * red build rather than a convention, the same way `integration-coverage.test.ts` holds `apps/`.
 *
 * Two directions, because both failures are silent:
 *   - a page nobody indexed is a page nobody finds;
 *   - a page listed in mint.json that does not exist is a 404 on the published site.
 */

const INDEX = 'README.md';

/** Docs that are deliberately not prose pages and so are not indexed as ones. */
const NOT_A_PAGE = new Set(['mint.json', 'fixtures-dispatch-receiver.yml']);

const docsIndex = () => readFileSync(join(DOCS, INDEX), 'utf8');

const markdownPages = () =>
  readdirSync(DOCS)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => f !== INDEX)
    .filter((f) => !NOT_A_PAGE.has(f));

describe('docs/README.md indexes every doc', () => {
  it('every markdown page under docs/ is linked from the index', () => {
    const index = docsIndex();
    const unlisted = markdownPages().filter((page) => !index.includes(`(${page})`));

    expect(
      unlisted,
      `These docs exist but are not in docs/README.md, so nobody will find them: ${unlisted.join(', ')}. ` +
        `Add each to the user table or the contributor table — the point of the index is that the ` +
        `two audiences are told apart.`,
    ).toEqual([]);
  });

  it('every page mint.json publishes actually exists', () => {
    const mint = JSON.parse(readFileSync(join(DOCS, 'mint.json'), 'utf8')) as {
      navigation: { group: string; pages: string[] }[];
    };
    const published = mint.navigation.flatMap((group) => group.pages);
    const missing = published.filter((page) => !existsSync(join(DOCS, `${page}.md`)));

    expect(
      missing,
      `mint.json publishes pages with no file behind them — each is a 404 on reticle.sh: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every page mint.json publishes is indexed as a user doc, not a contributor one', () => {
    const index = docsIndex();
    const [, userSection = '', contributorSection = ''] = index.split(/^## /m);
    const mint = JSON.parse(readFileSync(join(DOCS, 'mint.json'), 'utf8')) as {
      navigation: { group: string; pages: string[] }[];
    };
    const published = mint.navigation.flatMap((group) => group.pages);

    const misfiled = published.filter(
      (page) =>
        contributorSection.includes(`(${page}.md)`) && !userSection.includes(`(${page}.md)`),
    );

    expect(
      misfiled,
      `These pages are published to users but the index files them under contributor docs: ${misfiled.join(', ')}`,
    ).toEqual([]);
  });
});
