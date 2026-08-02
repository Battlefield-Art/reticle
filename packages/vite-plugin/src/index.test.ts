import { afterAll, describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RETICLE_DEFAULT_PORT, ReticleDir, ReticleEnv } from '@reticlehq/core';
import {
  reticle,
  RETICLE_VITE_PLUGIN_NAME,
  RETICLE_CONNECT_MODULE,
  connectModuleSource,
} from './index.js';

// The attribute the babel plugin stamps (mirrors DATA_RETICLE_SOURCE_ATTR in core).
const SOURCE_ATTR = 'data-reticle-source';

// Point the token lookup at an empty temp dir so tests never pick up a real ~/.reticle/pairing-token.
const emptyTokenDir = mkdtempSync(join(tmpdir(), 'reticle-vite-token-'));
const savedTokenDir = process.env[ReticleEnv.PAIRING_TOKEN_DIR];
process.env[ReticleEnv.PAIRING_TOKEN_DIR] = emptyTokenDir;
afterAll(() => {
  if (savedTokenDir === undefined) delete process.env[ReticleEnv.PAIRING_TOKEN_DIR];
  else process.env[ReticleEnv.PAIRING_TOKEN_DIR] = savedTokenDir;
});

describe('reticle vite plugin', () => {
  it('only applies during serve (never ships to production builds)', () => {
    const plugin = reticle();
    expect(plugin.name).toBe(RETICLE_VITE_PLUGIN_NAME);
    expect(plugin.apply).toBe('serve');
    expect(plugin.enforce).toBe('pre');
  });

  it('stamps data-reticle-source on host elements in .tsx files', () => {
    const plugin = reticle();
    const result = plugin.transform?.('const x = <button>Hi</button>;', '/app/src/Foo.tsx');
    expect(result).not.toBeNull();
    expect(result?.code).toContain(SOURCE_ATTR);
  });

  it('skips non-jsx and node_modules and virtual ids', () => {
    const plugin = reticle();
    expect(plugin.transform?.('const x = 1;', '/app/src/util.ts')).toBeNull();
    expect(plugin.transform?.('const x = <a/>;', '/app/node_modules/pkg/Foo.tsx')).toBeNull();
    expect(plugin.transform?.('const x = <a/>;', '\0virtual:foo.tsx')).toBeNull();
  });

  it('disables stamping when sourceMapping is false', () => {
    const plugin = reticle({ sourceMapping: false });
    expect(plugin.transform?.('const x = <button>Hi</button>;', '/app/src/Foo.tsx')).toBeNull();
  });

  it('injects a script that references the connect module by src (not an inline import)', () => {
    // Regression: an inline injected <script> with a bare import is NOT run through Vite import
    // resolution, so it must be served as a real module via src.
    const plugin = reticle();
    const tags = plugin.transformIndexHtml?.('<html></html>');
    expect(tags).toHaveLength(1);
    const tag = tags?.[0];
    expect(tag?.tag).toBe('script');
    expect(tag?.attrs?.['type']).toBe('module');
    expect(tag?.attrs?.['src']).toBe(RETICLE_CONNECT_MODULE);
  });

  it('serves the connect module importing the SDK from the @reticlehq/react kit', () => {
    const plugin = reticle();
    expect(plugin.resolveId?.(RETICLE_CONNECT_MODULE)).toBe(RETICLE_CONNECT_MODULE);
    expect(plugin.resolveId?.('some/other/id')).toBeNull();
    const code = plugin.load?.(RETICLE_CONNECT_MODULE);
    // Must import from the kit, which actually exports `reticle` + `install`. Importing from
    // @reticlehq/core (the foundation, which exports neither) is the bug this asserts against.
    expect(code).toContain("from '@reticlehq/react'");
    expect(code).not.toContain("from '@reticlehq/core'");
    expect(code).toContain('install()');
    expect(code).toContain('reticle.connect(');
  });

  it('does not inject or serve the module when inject is false', () => {
    const plugin = reticle({ inject: false });
    expect(plugin.transformIndexHtml?.('<html></html>')).toEqual([]);
    expect(plugin.resolveId?.(RETICLE_CONNECT_MODULE)).toBeNull();
    expect(plugin.load?.(RETICLE_CONNECT_MODULE)).toBeNull();
  });

  it('bakes a non-default port into the connect module url', () => {
    const customPort = RETICLE_DEFAULT_PORT + 1;
    const code = reticle({ port: customPort }).load?.(RETICLE_CONNECT_MODULE);
    expect(code).toContain(String(customPort));
    expect(code).toContain('ws://localhost:');
  });

  it('omits the url for the default port (SDK default applies)', () => {
    const code = reticle().load?.(RETICLE_CONNECT_MODULE);
    expect(code).not.toContain('ws://localhost:');
  });

  it('forwards session and token when provided', () => {
    const code = reticle({ session: 'my-app', token: 'secret' }).load?.(RETICLE_CONNECT_MODULE);
    expect(code).toContain('my-app');
    expect(code).toContain('secret');
  });

  it('auto-injects the daemon pairing token from the token dir when no explicit token is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reticle-vite-hastoken-'));
    writeFileSync(join(dir, ReticleDir.PAIRING_TOKEN_FILE), 'daemon-secret-123\n');
    const prev = process.env[ReticleEnv.PAIRING_TOKEN_DIR];
    process.env[ReticleEnv.PAIRING_TOKEN_DIR] = dir;
    try {
      const code = reticle().load?.(RETICLE_CONNECT_MODULE);
      expect(code).toContain('daemon-secret-123');
      expect(code).toContain('token');
    } finally {
      process.env[ReticleEnv.PAIRING_TOKEN_DIR] = prev;
    }
  });

  it('omits the token when the daemon has not provisioned one yet (no file)', () => {
    // Env points at the empty dir from the top of the file — no token file present.
    const code = reticle().load?.(RETICLE_CONNECT_MODULE);
    expect(code).not.toContain('"token"');
  });

  it('auto-stamps a derived projectId with zero config', () => {
    const code = reticle().load?.(RETICLE_CONNECT_MODULE);
    expect(code).toContain('projectId');
    // The id this monorepo derives for the vite-plugin package starts with a slug of its name.
    expect(code).toMatch(/projectId":"[a-z0-9-]+-[0-9a-f]{8}"/);
  });

  it('an explicit projectId option overrides the derived one', () => {
    const code = reticle({ projectId: 'my-fixed-id' }).load?.(RETICLE_CONNECT_MODULE);
    expect(code).toContain('my-fixed-id');
  });
});

describe('desktop mode', () => {
  /**
   * A packaged Electron/Tauri renderer is a PRODUCTION Vite build loaded from `file://` or a custom
   * protocol — there is no dev server. `apply: 'serve'` therefore drops the plugin entirely and the
   * app ships with no `connect()` at all, which is why the desktop demos had to hand-wire it. Desktop
   * mode is the opt-in that says "this build is a dev desktop shell, instrument it too".
   */
  it('applies to build (not just serve) so a packaged renderer is instrumented', () => {
    expect(reticle({ desktop: true }).apply).toBe(undefined);
    expect(reticle().apply).toBe('serve');
  });

  it('allows the SDK to run in a production-mode renderer, which desktop always is', () => {
    expect(connectModuleSource({ desktop: true })).toContain('allowInProduction');
    expect(connectModuleSource({})).not.toContain('allowInProduction');
  });

  it('still honours an explicit inject:false in desktop mode', () => {
    const plugin = reticle({ desktop: true, inject: false });
    expect(plugin.transformIndexHtml('')).toEqual([]);
  });

  it('leaves web behaviour untouched — no desktop keys leak into a normal connect', () => {
    // A non-default port, because the default one is deliberately omitted from the connect args.
    const web = connectModuleSource({ port: 4401 });
    expect(web).toContain('4401');
    expect(web).not.toContain('allowInProduction');
  });
});

describe('desktop injection site', () => {
  /**
   * In a build Vite routes the HTML entry through an html-proxy id rather than the plain file path.
   * An `endsWith('.html')` check silently misses it, and the bundle ships with no connect() at all —
   * the app looks wired and connects to nothing. Both spellings must be recognised.
   */
  it('recognises the html entry in both dev and build id shapes', () => {
    for (const importer of ['/app/index.html', '/app/index.html?html-proxy&index=0.js']) {
      const plugin = reticle({ desktop: true });
      // resolveId sees the SPECIFIER; transform later sees the ABSOLUTE resolved path.
      plugin.resolveId('/src/main.tsx', importer);
      const out = plugin.transform('const a = 1;', '/Users/me/app/src/main.tsx');
      expect(out?.code, `importer ${importer}`).toContain('reticle.connect');
    }
  });

  it('does not inject into a module the HTML never referenced', () => {
    const plugin = reticle({ desktop: true });
    plugin.resolveId('/src/main.tsx', '/app/index.html');
    expect(
      plugin.transform('const a = 1;', '/Users/me/app/src/other.ts')?.code ?? '',
    ).not.toContain('reticle.connect');
  });

  it('never injects on the web path, even into the html entry', () => {
    const plugin = reticle();
    plugin.resolveId('/src/main.tsx', '/app/index.html');
    expect(
      plugin.transform('const a = 1;', '/Users/me/app/src/main.tsx')?.code ?? '',
    ).not.toContain('reticle.connect');
  });
});

describe('desktop injection cannot fail silently', () => {
  /**
   * The failure this guards against actually happened twice while building desktop mode: the entry
   * match missed, nothing was injected, and the packaged app shipped with no connect() in it. The
   * app LOOKED wired. A build that cannot instrument must fail loudly rather than produce a binary
   * that silently reports nothing.
   */
  it('fails the build when the entry was never found', () => {
    const plugin = reticle({ desktop: true });
    expect(() => plugin.buildEnd?.()).toThrow(/could not inject/i);
  });

  it('is satisfied once the entry has been injected', () => {
    const plugin = reticle({ desktop: true });
    plugin.resolveId('/src/main.tsx', '/app/index.html');
    plugin.transform('const a = 1;', '/app/src/main.tsx');
    expect(() => plugin.buildEnd?.()).not.toThrow();
  });

  it('says nothing on the web path, where injection is a script tag', () => {
    expect(() => reticle().buildEnd?.()).not.toThrow();
  });

  it('says nothing when injection was explicitly disabled', () => {
    expect(() => reticle({ desktop: true, inject: false }).buildEnd?.()).not.toThrow();
  });

  /**
   * Suffix matching alone would inject into `/other/src/main.tsx` for an entry of `/src/main.tsx`.
   * When the resolved root is known, the comparison is exact instead.
   */
  it('does not inject into a different file that merely shares a suffix', () => {
    const plugin = reticle({ desktop: true });
    plugin.configResolved?.({ root: '/app' });
    plugin.resolveId('/src/main.tsx', '/app/index.html');
    const wrong = plugin.transform('const a = 1;', '/other/src/main.tsx');
    expect(wrong?.code ?? '').not.toContain('reticle.connect');
    const right = plugin.transform('const a = 1;', '/app/src/main.tsx');
    expect(right?.code ?? '').toContain('reticle.connect');
  });
});

describe('desktop injection is loud in dev too, not only in build', () => {
  /**
   * `buildEnd` covers the dangerous case — a packaged binary that ships uninstrumented. Dev had no
   * equivalent: a missed injection just meant no session ever appeared, and nothing said why. That
   * is the same silent failure, only with a shorter blast radius, so it gets the same treatment.
   *
   * The check is deferred rather than immediate because in `serve` the HTML is sent BEFORE the
   * browser requests the entry module — asserting at html time would fire on every healthy start.
   */
  /**
   * In dev the flag means "my transform ran this session", which is NOT "the app has no connect()":
   * Vite serves an unchanged module from its transform cache, so a warm cache leaves the flag false
   * while the served entry really is instrumented. The warning must therefore report doubt, not a
   * verdict — the build path keeps the certainty, because a build always runs every transform.
   */
  it('reports UNCONFIRMED injection in dev, never a false verdict', () => {
    const warnings: string[] = [];
    const plugin = reticle({ desktop: true, onWarn: (m) => warnings.push(m) });
    plugin.configResolved?.({ root: '/app', command: 'serve' });
    plugin.transformIndexHtml('<html></html>');
    plugin.checkInjectedForTest?.();
    const text = warnings.join(' ');
    expect(text).toMatch(/could not confirm/i);
    expect(text, 'dev must not claim the app will never connect').not.toMatch(/will never connect/i);
    // The benign cause has to be named, or every warm-cache start reads as a broken integration.
    expect(text).toMatch(/cache/i);
  });

  it('stays quiet when the entry was injected', () => {
    const warnings: string[] = [];
    const plugin = reticle({ desktop: true, onWarn: (m) => warnings.push(m) });
    plugin.configResolved?.({ root: '/app', command: 'serve' });
    plugin.transformIndexHtml('<html></html>');
    plugin.resolveId('/src/main.tsx', '/app/index.html');
    plugin.transform('const a = 1;', '/app/src/main.tsx');
    plugin.checkInjectedForTest?.();
    expect(warnings).toEqual([]);
  });

  it('never warns on the web path', () => {
    const warnings: string[] = [];
    const plugin = reticle({ onWarn: (m) => warnings.push(m) });
    plugin.configResolved?.({ root: '/app', command: 'serve' });
    plugin.transformIndexHtml('<html></html>');
    plugin.checkInjectedForTest?.();
    expect(warnings).toEqual([]);
  });
});
