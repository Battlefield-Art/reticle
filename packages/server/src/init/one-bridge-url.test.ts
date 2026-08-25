import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bridgeWsUrl, RETICLE_CLIENT_HOST } from '@reticlehq/core';
import { craDevModuleFile } from './cra.js';
import { astroManual, nextReticleDevFile } from './snippets.js';

/**
 * One place builds the bridge URL, and that is the whole point of `bridgeWsUrl`.
 *
 * Its own doc says so — "the wire string can never drift across the four call sites" — and three
 * generators had drifted from it anyway. CRA emitted `ws://127.0.0.1:…` while every other stack
 * emitted `ws://localhost:…`; the Astro helper and the Next plugin each spelled the host out. Same
 * endpoint today, and a difference with no reason behind it is the kind that becomes a real one the
 * first time somebody edits half of them.
 *
 * A default argument is not a single source of truth if it can be bypassed by typing the value, so
 * this scans the generators for a hand-written host instead of trusting that nobody will write one.
 */
const GENERATOR_DIR = new URL('.', import.meta.url).pathname;

/** Files that legitimately name both hosts: CSP advice must allow whatever the USER wrote. */
const ALLOWED = new Set(['csp-check.ts', 'desktop-doctor.ts', 'one-bridge-url.test.ts']);

describe('every generated connect URL comes from bridgeWsUrl', () => {
  it('emits one host across every stack', () => {
    const urls = [
      craDevModuleFile(4400, 'p'),
      astroManual(4400, 'p', 'src/layouts/Layout.astro'),
      nextReticleDevFile(4400, 'p'),
    ];
    for (const generated of urls) {
      const hosts = [...generated.matchAll(/ws:\/\/([^:/]+):/g)].map((m) => m[1]);
      for (const host of hosts) expect(host).toBe(RETICLE_CLIENT_HOST);
    }
  });

  it('CRA no longer disagrees with everyone else', () => {
    expect(craDevModuleFile(4400, 'p')).toContain(bridgeWsUrl(4400));
    expect(craDevModuleFile(4400, 'p')).not.toContain('127.0.0.1');
  });

  /**
   * The structural half: a generator that hand-writes `ws://<host>:` bypasses the constant even when
   * it happens to type the right value today.
   */
  it('no init generator hand-writes a bridge URL', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(GENERATOR_DIR)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || ALLOWED.has(file)) continue;
      const path = join(GENERATOR_DIR, file);
      if (!statSync(path).isFile()) continue;
      const source = readFileSync(path, 'utf8');
      // A literal host between `ws://` and `:` — an interpolated `${…}` is the constant doing its job.
      if (/ws:\/\/[a-z0-9.]+:/i.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
