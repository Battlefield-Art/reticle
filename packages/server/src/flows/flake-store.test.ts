import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type FileSystemPort } from '../project/fs-port.js';
import { FlakeStore } from './flake-store.js';

describe('FlakeStore', () => {
  let root: string;
  let fs: FileSystemPort;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reticle-flake-'));
    root = join(dir, '.reticle');
    fs = createNodeFileSystem();
  });
  afterEach(async () => {
    await rm(join(root, '..'), { recursive: true, force: true });
  });

  it('accrues outcomes and quarantines a flow once it is intermittently failing', async () => {
    const store = new FlakeStore(fs, root);
    for (const passed of [true, false, true, true, false]) await store.record('checkout', passed);
    expect(await store.flakyFlows()).toEqual(['checkout']);
  });

  it('does not quarantine a consistently passing flow', async () => {
    const store = new FlakeStore(fs, root);
    for (let i = 0; i < 5; i += 1) await store.record('login', true);
    expect(await store.flakyFlows()).toEqual([]);
  });

  it('degrades to an empty ledger on a malformed or wrong-version file', async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'flake.json'), '{ bad', 'utf8');
    expect(await new FlakeStore(fs, root).load()).toEqual({});
    await writeFile(join(root, 'flake.json'), JSON.stringify({ version: 9, flows: {} }), 'utf8');
    expect(await new FlakeStore(fs, root).load()).toEqual({});
  });
});
