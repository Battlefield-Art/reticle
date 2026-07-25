import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EventType,
  JOURNAL_FILE_VERSION,
  type JournalAction,
  type ReticleEvent,
} from '@reticlehq/core';
import { createNodeFileSystem, type FileSystemPort } from '../project/fs-port.js';
import { SessionJournal } from './session-journal.js';

function evt(seq: number, over: Partial<ReticleEvent> = {}): ReticleEvent {
  return {
    t: seq,
    seq,
    type: EventType.DOM_ADDED,
    sessionId: 'demo',
    data: { role: 'button' },
    ...over,
  };
}

function action(over: Partial<JournalAction> = {}): JournalAction {
  return {
    v: JOURNAL_FILE_VERSION,
    actionId: 'c1',
    tool: 'reticle_act',
    args: {},
    tRange: { from: 0, to: 5 },
    at: 0,
    ...over,
  };
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

  it('reads incrementally across appends — a re-read after more writes returns the union', async () => {
    // The parse-cache only parses the TAIL written since the last read (queryEvents calls readEvents on
    // every observe/network/console once the ring buffer evicts, so re-parsing the whole file each time
    // was the hot cost). Correctness: reads interleaved with appends must still return every event once.
    const j = new SessionJournal(fs, root, 'demo');
    await j.appendEvents([evt(0), evt(1)]);
    expect((await j.readEvents()).map((e) => e.seq)).toEqual([0, 1]);
    // A re-read with nothing new returns the same set (cache hit, no duplication).
    expect((await j.readEvents()).map((e) => e.seq)).toEqual([0, 1]);
    // Append more, then re-read: the tail is parsed and merged, no earlier event lost or repeated.
    await j.appendEvents([evt(2)]);
    await j.appendEvents([evt(3), evt(4)]);
    expect((await j.readEvents()).map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    // The returned array is a copy — mutating it must not corrupt the cache for the next read.
    const back = await j.readEvents();
    back.pop();
    expect((await j.readEvents()).map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
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

  it('does NOT drop an event when a read observes a partial trailing line mid-append', async () => {
    // Reads and writes are not on the same chain and hit separate libuv threads, so a read can see the
    // file ending mid-record. Advancing the parse offset past that partial line used to splice its tail
    // onto the next read's head, fail to parse the join, and lose that event from the durable cache
    // forever. The offset must stop at the last newline and re-read the completed line.
    let fileText = '';
    const controllable: FileSystemPort = {
      ...fs,
      readFile: (path) => (path.endsWith('events.jsonl') ? Promise.resolve(fileText) : fs.readFile(path)),
      appendFile: (path, data) => {
        if (path.endsWith('events.jsonl')) {
          fileText += data;
          return Promise.resolve();
        }
        return fs.appendFile(path, data);
      },
      mkdir: () => Promise.resolve(),
    };
    const j = new SessionJournal(controllable, root, 'demo');
    const complete = `${JSON.stringify(evt(0))}\n${JSON.stringify(evt(1))}\n`;
    fileText = `${complete}${JSON.stringify(evt(2))}`; // event 2 is a PARTIAL trailing line (no \n yet)
    expect((await j.readEvents()).map((e) => e.seq)).toEqual([0, 1]); // partial line left unconsumed

    fileText = `${complete}${JSON.stringify(evt(2))}\n`; // the append completes with the newline
    expect((await j.readEvents()).map((e) => e.seq)).toEqual([0, 1, 2]); // event 2 recovered, not dropped
  });
});
