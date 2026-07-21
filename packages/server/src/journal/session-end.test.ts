import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '../project/fs-port.js';
import { AmbientStore } from './ambient-store.js';
import { makeSessionEnd, type SessionEndTarget } from './session-end.js';

function fakeSession(id: string, ambient: Record<string, number>, onFlush?: () => void): SessionEndTarget {
  return {
    id,
    flushJournal: () => {
      onFlush?.();
      return Promise.resolve();
    },
    ambientCounts: () => ambient,
  };
}

describe('makeSessionEnd (teardown: flush journal + persist ambient)', () => {
  let root: string;
  const fs = createNodeFileSystem();

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reticle-sessend-'));
    root = join(dir, '.reticle');
  });
  afterEach(async () => {
    await rm(join(root, '..'), { recursive: true, force: true });
  });

  it('flushes the journal so the tail of a session is never lost from disk', async () => {
    let flushed = false;
    const end = makeSessionEnd({ fs, reticleRoot: root, enabled: true });
    await end(fakeSession('s1', {}, () => (flushed = true)));
    expect(flushed).toBe(true);
  });

  it('persists the learned ambient map so the NEXT session starts warm', async () => {
    const end = makeSessionEnd({ fs, reticleRoot: root, enabled: true });
    await end(fakeSession('s1', { 'chat-log': 12 }));
    expect(await new AmbientStore(fs, root).load()).toEqual({ 'chat-log': 12 });
  });

  it('accumulates across sessions rather than overwriting (the map sharpens over time)', async () => {
    const end = makeSessionEnd({ fs, reticleRoot: root, enabled: true });
    await end(fakeSession('s1', { 'chat-log': 12, ticker: 3 }));
    await end(fakeSession('s2', { 'chat-log': 8 }));
    expect(await new AmbientStore(fs, root).load()).toEqual({ 'chat-log': 20, ticker: 3 });
  });

  it('is a no-op when journaling/persistence is disabled (opt-out)', async () => {
    let flushed = false;
    const end = makeSessionEnd({ fs, reticleRoot: root, enabled: false });
    await end(fakeSession('s1', { 'chat-log': 5 }, () => (flushed = true)));
    expect(flushed).toBe(false);
    expect(await new AmbientStore(fs, root).load()).toEqual({});
  });

  it('never throws at teardown even when the flush fails (the tab is already gone)', async () => {
    const end = makeSessionEnd({ fs, reticleRoot: root, enabled: true });
    const broken: SessionEndTarget = {
      id: 's1',
      flushJournal: () => Promise.reject(new Error('disk gone')),
      ambientCounts: () => ({ 'chat-log': 4 }),
    };
    await expect(end(broken)).resolves.toBeUndefined();
    // ambient still persisted despite the flush failure
    expect(await new AmbientStore(fs, root).load()).toEqual({ 'chat-log': 4 });
  });
});
