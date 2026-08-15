import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A test that builds thousands of DOM nodes must declare its own timeout.
 *
 * Vitest's default is 5 000 ms, and a default timeout is the same statement CLAUDE.md already
 * forbids in assertions — "a statement about the machine … fails only under parallel load, i.e.
 * only in CI". Observed on a Windows runner:
 *
 *   × stays bounded while a list renders and discards thousands of rows  7410ms
 *     → Test timed out in 5000ms.
 *
 * The assertion had not failed. The bound held. The runner was slow, and 5 000 rows of
 * `attachShadow` took longer than a number nobody chose for this test.
 *
 * `refs.test.ts` is the same shape — two tests at 20 000 iterations — and it flaked three separate
 * times tonight under full-monorepo load. I first guessed that one was GC-dependent; it is not, and
 * this is what it actually was.
 *
 * A generous timeout cannot make a broken test pass: the bound is still asserted, and a registry
 * that grew without limit would still fail. It only stops the suite reporting the runner.
 *
 * Coarse by design, in two ways worth stating rather than discovering later:
 *
 *  1. It checks that a file with a heavy loop declares SOME explicit timeout, not that the right
 *     `it()` carries it. A precise version would need to parse the file, and the failure this
 *     guards against is someone deleting the timeout wholesale, not moving it.
 *  2. The loop pattern only sees a literal or `CONST * n` bound. `refs.test.ts` hides its heaviest
 *     loop behind a `fill(n)` helper — ~20 000 elements APPENDED to the document — and this rule
 *     would not have found it. I found it by reading, and gave it a timeout too. A guard that
 *     cannot see indirection should say so instead of implying coverage it does not have.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..');
/**
 * Scanned from the SERVER package, not the browser one, because `@reticlehq/browser` may not import
 * Node builtins — it runs in the DOM, and the lint rule that says so is a real architectural
 * boundary rather than a nuisance. Every other source-scanning guard in this repo lives here for
 * the same reason (see e2e-surface-drift.test.ts).
 */
/**
 * EVERY package's sources, not only the browser's.
 *
 * Scoped to `packages/browser/src` originally because that is where the incident happened. The
 * identical failure then arrived in `packages/server/src`: a test timed out at vitest's 5s default
 * on Windows CI and nowhere else, which reads as a product failure and is a statement about the
 * machine. Guarding one directory against a repo-wide failure mode is a mistake this repo has now
 * made three times in one day, in three different guards.
 *
 * Widening cost exactly one annotation, which is the argument for having done it at the start.
 */
const PACKAGES = join(REPO, 'packages');

/** A loop big enough that the default timeout is a coin flip on a loaded runner. */
const HEAVY_LOOP = /for \([^)]*<\s*(?:\d{4,}|[A-Z_]+ \* \d)/;

/**
 * The second shape, which no count-based rule can see: real IO inside a loop.
 *
 * `project-tools.test.ts` timed out at the 5s default on Windows CI and nowhere else. It loops
 * **40** times — nothing like the thousands the pattern above looks for — and writes a run record
 * through the real filesystem port on each pass. That is milliseconds on macOS and Linux and much
 * slower on a Windows runner, so the file is heavy because of what is INSIDE the loop, not because
 * of how many times it goes round.
 *
 * Deliberately narrow rather than "every loop containing await": it has to be a file that also
 * creates a real temp directory, which is what makes the awaited work touch a disk. Measured across
 * `packages/**` when this was written, that combination matched six files. A blanket rule over
 * awaited loops would have matched a large share of the suite and taught everyone to ignore it.
 *
 * It cannot see indirection any better than the rule above — a helper that does the IO one call away
 * is invisible here. Same honesty caveat, same remedy: read the file.
 */
const MAKES_TEMP_DIR = /\bmkdtemp(Sync)?\b|\btmpdir\(\)/;

/** True when some `for`/`while` body in the source awaits something. */
function awaitsInsideALoop(text: string): boolean {
  const loop = /\b(?:for|while)\s*\(/g;
  for (let m = loop.exec(text); m !== null; m = loop.exec(text)) {
    const body = loopBody(text, m.index);
    if (body !== null && /\bawait\b/.test(body)) return true;
  }
  return false;
}

/**
 * The braced body following a loop header, by brace matching.
 *
 * Substring windows were the obvious cheap version and are wrong in both directions: too short and a
 * long body hides its await, too long and the NEXT function's await counts as this loop's. Returns
 * null for a brace-less single-statement loop, which cannot contain enough to matter here.
 */
function loopBody(text: string, from: number): string | null {
  const open = text.indexOf('{', from);
  if (-1 === open) return null;
  // A `{` further away than the end of the header line is a different construct, not this body.
  if (text.slice(from, open).includes('\n')) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if ('{' === ch) depth++;
    else if ('}' === ch) {
      depth--;
      if (0 === depth) return text.slice(open, i);
    }
  }
  return null;
}

function doesRealIoInALoop(text: string): boolean {
  return MAKES_TEMP_DIR.test(text) && awaitsInsideALoop(text);
}
/**
 * `}, 60_000);` or `}, HEAVY_DOM_TIMEOUT_MS);` — an explicit per-test timeout.
 *
 * A NAMED constant counts, and must: this repo's convention is that a magic number gets a name, so a
 * rule that only accepted a literal would push the fix toward worse style. My first version did
 * exactly that and failed against its own remedy.
 *
 * Whitespace-tolerant because prettier splits the call once it grows:
 *
 *     },
 *     HEAVY_DOM_TIMEOUT_MS,
 *   );
 *
 * A single-line pattern matched neither of the two files it was written for. A guard has to match
 * what the formatter actually emits, not what the author typed.
 */
const EXPLICIT_TIMEOUT = /\},\s*(?:\d[\d_]{3,}|[A-Z][A-Z0-9_]*_MS)\s*,?\s*\)/;

/**
 * A file-level bound, which is the right unit for the real-IO rule.
 *
 * The loop rule above is about ONE outlier test in a file, so a per-`it()` timeout fits it. Real IO
 * in a loop is a property of the whole file — the six that matched have the same fixture writing
 * through the same filesystem port in three or four tests each, and annotating every one of them is
 * twenty edits that a reader then has to keep in sync. `vi.setConfig({ testTimeout })` states it once
 * and covers every test in the file, including the next one somebody adds.
 */
const FILE_LEVEL_TIMEOUT = /vi\.setConfig\(\{[^}]*testTimeout/;

function declaresATimeout(text: string): boolean {
  return EXPLICIT_TIMEOUT.test(text) || FILE_LEVEL_TIMEOUT.test(text);
}

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(full));
    else if (entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('heavy tests do not rely on the default timeout', () => {
  const all = testFiles(PACKAGES).map((file) => ({ file, text: readFileSync(file, 'utf8') }));
  const heavy = all.filter(({ text }) => HEAVY_LOOP.test(text));
  const io = all.filter(({ text }) => doesRealIoInALoop(text));

  it('finds the heavy files at all — a vacuous rule is not a rule', () => {
    // Guards the guard: if the pattern stops matching, everything below passes for free.
    expect(heavy.length).toBeGreaterThan(0);
  });

  it('finds the real-IO-in-a-loop files at all', () => {
    expect(io.length).toBeGreaterThan(0);
  });

  it('every file that builds thousands of nodes declares an explicit timeout', () => {
    const missing = heavy
      .filter(({ text }) => !EXPLICIT_TIMEOUT.test(text))
      .map(({ file }) => relative(PACKAGES, file));
    expect(missing).toEqual([]);
  });

  it('every file doing real filesystem work in a loop declares an explicit timeout', () => {
    // The message is the point: a reader who hits this needs to know it is about what the loop DOES,
    // not how many times it runs, or they will go looking for an iteration count that is not there.
    const missing = io
      .filter(({ text }) => !declaresATimeout(text))
      .map(({ file }) => relative(PACKAGES, file));
    expect(
      missing,
      'these tests await real filesystem work inside a loop, which is milliseconds here and much ' +
        'slower on a Windows runner. Give the `it()` an explicit timeout — a generous BOUND, never a ' +
        'duration assertion.',
    ).toEqual([]);
  });
});
