import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The published skills and the Claude Code plugin are shipped artifacts nothing else checks.
 *
 * Two failures, both silent, both already shipped:
 *
 * A skill with no frontmatter is not a skill. `npx skills add reticlehq/reticle` answered "No valid
 * skills found. Skills require a SKILL.md with name and description" for as long as the only
 * SKILL.md in the repo was the paste-URL copy at root — the registry route was dead on arrival and
 * nothing said so, because no gate has an opinion about a markdown file's first ten lines.
 *
 * And `.claude-plugin` sat at 2.7.0 through the 2.8.0 release. A plugin version is what a user's
 * `/plugin` UI shows and what decides whether an update is offered, so a stale one silently pins
 * everybody who installed it. Release tooling does not know the file exists.
 *
 * Both are one-line mistakes that survive every other gate in this repo, which is the whole argument
 * for checking them here.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..');
const SKILLS = join(REPO, 'skills');

/** `name:` and `description:` out of a SKILL.md's YAML frontmatter, or null when there is none. */
function frontmatter(
  file: string,
): { name: string | undefined; description: string | undefined } | null {
  const text = readFileSync(file, 'utf8');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (-1 === end) return null;
  const block = text.slice(4, end);
  const read = (key: string): string | undefined =>
    block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim();
  return { name: read('name'), description: read('description') };
}

function publishedSkills(): string[] {
  return readdirSync(SKILLS).filter((entry) => statSync(join(SKILLS, entry)).isDirectory());
}

describe('every published skill is one the registry can actually install', () => {
  it('finds skills to check', () => {
    expect(publishedSkills().length).toBeGreaterThan(0);
  });

  for (const skill of publishedSkills()) {
    it(`${skill} declares the name and description the skills CLI requires`, () => {
      const meta = frontmatter(join(SKILLS, skill, 'SKILL.md'));
      expect(
        meta,
        `skills/${skill}/SKILL.md has no YAML frontmatter — the CLI will skip it`,
      ).not.toBe(null);
      expect(meta?.name, `skills/${skill} declares no name`).toBeTruthy();
      expect(meta?.description, `skills/${skill} declares no description`).toBeTruthy();
      // The directory is the install path and the name is what a user types. Disagreeing means
      // `--skill <name>` misses a skill that is plainly there.
      expect(meta?.name, `skills/${skill} declares name "${meta?.name ?? ''}"`).toBe(skill);
    });
  }

  /**
   * A description is this channel's entire shopfront: registry search is semantic over this field,
   * and it is the only text an agent reads before deciding whether the skill fits the task. The
   * top of the leaderboard is uniformly a sentence about WHEN to use the skill, not a product name.
   */
  it('every description says when to use the skill, not just what it is', () => {
    const thin: string[] = [];
    for (const skill of publishedSkills()) {
      const description = frontmatter(join(SKILLS, skill, 'SKILL.md'))?.description ?? '';
      if (description.length < 120 || !/\buse\b/i.test(description)) thin.push(skill);
    }
    expect(
      thin,
      `these descriptions are too thin to match a search — name the situations that should trigger them:\n${thin.join('\n')}`,
    ).toEqual([]);
  });
});

/** The release version out of the root `package.json`, narrowed rather than trusted. */
function releaseVersion(): string | null {
  const parsed: unknown = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  if ('object' !== typeof parsed || null === parsed || !('version' in parsed)) return null;
  return 'string' === typeof parsed.version ? parsed.version : null;
}

describe('the Claude Code plugin ships the version everything else ships', () => {
  const release = releaseVersion();

  it('reads a release version to compare against', () => {
    expect(release, 'root package.json declares no version').not.toBe(null);
  });

  for (const file of ['plugin.json', 'marketplace.json']) {
    it(`${file} is on the release version`, () => {
      const text = readFileSync(join(REPO, '.claude-plugin', file), 'utf8');
      const versions = [...text.matchAll(/"version":\s*"([^"]+)"/g)].map((m) => m[1]);
      expect(versions.length, `${file} declares no version`).toBeGreaterThan(0);
      for (const version of versions) expect(version, `${file} is stale`).toBe(release);
    });
  }
});
