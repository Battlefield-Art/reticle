import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventType, JOURNAL_FILE_VERSION, type JournalAction, type ReticleEvent } from '@reticlehq/core';
import { createNodeFileSystem, type FileSystemPort } from '../project/fs-port.js';
import { SessionJournal } from './session-journal.js';

function evt(seq: number, over: Partial<ReticleEvent> = {}): ReticleEvent {
  return { t: seq, seq, type: EventType.DOM_ADDED, sessionId: 'demo', data: { role: 'button' }, ...over };
}

function action(over: Partial<JournalAction> = {}): JournalAction {
  return { v: JOURNAL_FILE_VERSION, actionId: 'c1', tool: 'reticle_act', args: {}, tRange: { from: 0, to: 5 }, at: 0, ...over };
}

describe('SessionJournal — durable JSONL over a temp dir', () => {
  let root: string;
  let fs: FileSystemPort;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reticle-journal-'));
    root = join(dir, '.reticle');
    fs = createNodeFileSystem();
  });

  afterEach(async () => {
    await rm(join(root, '..'), { recursive: true, force: true });
  });

  it('appends events in batches and reads them back in order', async () => {
    const j = new SessionJournal(fs, root, 'demo');
    await j.appendEvents([evt(0), evt(1)]);
    await j.appendEvents([evt(2)]);
    const back = await j.readEvents();
    expect(back.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it('appends and reads back actions', async () => {
    const j = new SessionJournal(fs, root, 'demo');
    await j.appendAction(action({ actionId: 'c1' }));
    await j.appendAction(action({ actionId: 'c2', seqRange: { from: 0, to: 2 } }));
    const back = await j.readActions();
    expect(back.map((a) => a.actionId)).toEqual(['c1', 'c2']);
    expect(back[1]?.seqRange?.to).toBe(2);
  });

  it('returns [] for a session with no journal on disk (never throws)', async () => {
    const j = new SessionJournal(fs, root, 'fresh');
    expect(await j.readEvents()).toEqual([]);
    expect(await j.readActions()).toEqual([]);
  });

  it('skips malformed and schema-invalid lines instead of throwing', async () => {
    const j = new SessionJournal(fs, root, 'demo');
    await j.appendEvents([evt(0)]);
    await fs.appendFile(join(root, 'sessions', 'demo', 'events.jsonl'), 'not json\n{"seq":99}\n');
    await j.appendEvents([evt(1)]);
    const back = await j.readEvents();
    expect(back.map((e) => e.seq)).toEqual([0, 1]);
  });

  it('is a no-op on an empty event batch (no empty lines written)', async () => {
    const j = new SessionJournal(fs, root, 'demo');
    await j.appendEvents([]);
    expect(await j.readEvents()).toEqual([]);
  });

  it('rejects an unsafe session id before any disk path is built', () => {
    expect(() => new SessionJournal(fs, root, '../escape')).toThrow();
  });
});
