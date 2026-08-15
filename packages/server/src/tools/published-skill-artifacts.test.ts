import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  // Line endings normalised before anything looks at the bytes. Git on Windows checks text out as
  // CRLF, so `---\r\n` failed the test below and EVERY shipped skill read as having no frontmatter:
  // green on macOS and Linux, red on Windows only, and the message accused the skills rather than
  // the parser. `.gitattributes` now pins LF in the working tree, which is the real fix; this is the
  // second lock, because a file can still arrive with CRLF from an editor or a patch.
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
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

/**
 * The frontmatter reader must not depend on which platform checked the file out.
 *
 * Git on Windows checks text out as CRLF, so `---\r\n` failed a `startsWith('---\n')` test and every
 * shipped skill read as having no frontmatter at all. The suite was green on macOS and Linux and red
 * on Windows only, and it accused the skills — "the CLI will skip it" — rather than the parser, so
 * the message pointed at ten innocent files.
 *
 * `.gitattributes` now pins LF in the working tree and is the real fix. This is the second lock: a
 * file can still arrive with CRLF from an editor, a patch, or a copy off a Windows share, and when
 * it does the guard must still read it rather than silently reporting the skill as unpublishable.
 *
 * Written against a temp file rather than the real skills, because the real ones are LF on this
 * machine by construction — a test over them could never have caught this, which is exactly why it
 * was not caught.
 */
describe('frontmatter is read whatever the line endings', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function skillWith(newline: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'reticle-skill-eol-'));
    dirs.push(dir);
    const file = join(dir, 'SKILL.md');
    writeFileSync(
      file,
      ['---', 'name: drive-desktop-app', 'description: does a thing', '---', '', '# Body'].join(
        newline,
      ),
    );
    return file;
  }

  it('reads CRLF frontmatter, the shape Windows checks out', () => {
    expect(frontmatter(skillWith('\r\n'))).toEqual({
      name: 'drive-desktop-app',
      description: 'does a thing',
    });
  });

  it('still reads LF frontmatter', () => {
    expect(frontmatter(skillWith('\n'))).toEqual({
      name: 'drive-desktop-app',
      description: 'does a thing',
    });
  });

  it('still returns null for a file with no frontmatter at all', () => {
    // The direction that must not soften: a skill genuinely missing its frontmatter is a real
    // finding, and normalising line endings must not turn it into a pass.
    const dir = mkdtempSync(join(tmpdir(), 'reticle-skill-eol-'));
    dirs.push(dir);
    const file = join(dir, 'SKILL.md');
    writeFileSync(file, '# Just a heading\r\n\r\nno frontmatter here\r\n');
    expect(frontmatter(file)).toBeNull();
  });
});
