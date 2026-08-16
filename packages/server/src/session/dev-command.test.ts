/**
 * The command must come from the PROJECT, never from a guess.
 *
 * "Ask the human to start it (`npm run dev`)" is in the no-session prose today and it is a guess:
 * plenty of repos have no `dev` script, and plenty use pnpm or yarn. A command that does not exist
 * is worse than no command, because the agent runs it, gets an error about the wrong thing, and
 * concludes the app is broken.
 */

import { describe, it, expect } from 'vitest';
import { detectDevCommand } from './dev-command.js';

/** A reader over an in-memory tree — the real one reads the disk. */
function reader(files: Record<string, string>): (path: string) => string | undefined {
  return (path) => files[path];
}

const PKG = '/app/package.json';

describe('detectDevCommand', () => {
  it('returns no command at all when there is no package.json', () => {
    expect(detectDevCommand('/app', reader({}))).toBeUndefined();
  });

  it('returns no command when package.json has no recognisable dev script', () => {
    const files = { [PKG]: JSON.stringify({ scripts: { build: 'tsc', test: 'vitest' } }) };
    expect(detectDevCommand('/app', reader(files))).toBeUndefined();
  });

  it('returns no command when package.json is unparseable rather than guessing one', () => {
    expect(detectDevCommand('/app', reader({ [PKG]: '{ not json' }))).toBeUndefined();
  });

  it('defaults to npm when no lockfile identifies a package manager', () => {
    const files = { [PKG]: JSON.stringify({ scripts: { dev: 'vite' } }) };
    expect(detectDevCommand('/app', reader(files))?.command).toBe('npm run dev');
  });

  it('reads pnpm from pnpm-lock.yaml', () => {
    const files = {
      [PKG]: JSON.stringify({ scripts: { dev: 'vite' } }),
      '/app/pnpm-lock.yaml': 'lockfileVersion: 9.0',
    };
    expect(detectDevCommand('/app', reader(files))?.command).toBe('pnpm run dev');
  });

  it('reads yarn from yarn.lock', () => {
    const files = {
      [PKG]: JSON.stringify({ scripts: { dev: 'vite' } }),
      '/app/yarn.lock': '# yarn lockfile v1',
    };
    expect(detectDevCommand('/app', reader(files))?.command).toBe('yarn run dev');
  });

  it('prefers pnpm over yarn when a repo carries both lockfiles', () => {
    const files = {
      [PKG]: JSON.stringify({ scripts: { dev: 'vite' } }),
      '/app/pnpm-lock.yaml': '',
      '/app/yarn.lock': '',
    };
    expect(detectDevCommand('/app', reader(files))?.command).toBe('pnpm run dev');
  });

  it('prefers `dev` over `develop` and `start`', () => {
    const scripts = { start: 'next start', develop: 'gatsby develop', dev: 'next dev' };
    const found = detectDevCommand('/app', reader({ [PKG]: JSON.stringify({ scripts }) }));
    expect(found?.script).toBe('dev');
  });

  it('falls back to `develop` before `start` — `start` is usually the PRODUCTION server', () => {
    const scripts = { start: 'next start', develop: 'gatsby develop' };
    const found = detectDevCommand('/app', reader({ [PKG]: JSON.stringify({ scripts }) }));
    expect(found?.script).toBe('develop');
  });

  it('accepts `start` when it is the only script there is', () => {
    const found = detectDevCommand(
      '/app',
      reader({ [PKG]: JSON.stringify({ scripts: { start: 'react-scripts start' } }) }),
    );
    expect(found?.command).toBe('npm run start');
  });

  it('reports the port when the script pins one with --port', () => {
    const files = { [PKG]: JSON.stringify({ scripts: { dev: 'vite --port 4311' } }) };
    expect(detectDevCommand('/app', reader(files))?.port).toBe(4311);
  });

  it('reports the port from --port=N as well as --port N', () => {
    const files = { [PKG]: JSON.stringify({ scripts: { dev: 'next dev --port=3001' } }) };
    expect(detectDevCommand('/app', reader(files))?.port).toBe(3001);
  });

  it('reports the port from a PORT= env prefix', () => {
    const files = { [PKG]: JSON.stringify({ scripts: { dev: 'PORT=8080 remix dev' } }) };
    expect(detectDevCommand('/app', reader(files))?.port).toBe(8080);
  });

  it('reports NO port when the script pins none, rather than inventing the framework default', () => {
    const files = { [PKG]: JSON.stringify({ scripts: { dev: 'vite' } }) };
    expect(detectDevCommand('/app', reader(files))?.port).toBeUndefined();
  });

  it('ignores a scripts value that is not a string', () => {
    const files = { [PKG]: JSON.stringify({ scripts: { dev: 42 } }) };
    expect(detectDevCommand('/app', reader(files))).toBeUndefined();
  });

  it('ignores an empty dev script — a command of "" is not runnable', () => {
    const files = { [PKG]: JSON.stringify({ scripts: { dev: '  ' } }) };
    expect(detectDevCommand('/app', reader(files))).toBeUndefined();
  });
});
