/**
 * The filesystem half. Two things here are easy to get wrong and expensive when they are:
 * a MERGE that is really an overwrite (which silently discards every earlier decision), and a read
 * that throws on a half-written file (which turns one bad flush into a broken sync).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReticleDir } from '@reticlehq/core';
import { diskSink, diskSource, readCloudIssues, readCloudState } from './sync-disk.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'reticle-sync-'));
});

const write = (rel: string, value: unknown): void => {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf8');
};

describe('reading what is on disk', () => {
  it('finds run artifacts and keys them by their own id', () => {
    write(join(ReticleDir.RUNS_SUBDIR, 'a.json'), { runId: 'run-a', verdict: 'pass' });
    write(join(ReticleDir.RUNS_SUBDIR, 'b.json'), { runId: 'run-b' });
    expect(
      diskSource(root)
        .runs()
        .map((r) => r.runId)
        .sort(),
    ).toEqual(['run-a', 'run-b']);
  });

  it('drops a run artifact with no id rather than re-sending it forever', () => {
    // Without an id it cannot be diffed against the server's list, so it would upload every cycle.
    write(join(ReticleDir.RUNS_SUBDIR, 'nameless.json'), { verdict: 'pass' });
    expect(diskSource(root).runs()).toEqual([]);
  });

  it('finds flows one directory down, under the app’s own project id', () => {
    write(join(ReticleDir.FLOWS_SUBDIR, 'app-1', 'sign-in.json'), { name: 'sign-in' });
    write(join(ReticleDir.FLOWS_SUBDIR, 'app-2', 'checkout.json'), { name: 'checkout' });
    expect(diskSource(root).flows()).toHaveLength(2);
  });

  it('reads each derived record from its own file', () => {
    write(ReticleDir.IMPACT_FILE, { counts: { calls: 4 } });
    write(ReticleDir.FLAKE_FILE, { version: 1 });
    const src = diskSource(root);
    expect(src.derived('impact')).toEqual({ counts: { calls: 4 } });
    expect(src.derived('flake')).toEqual({ version: 1 });
    expect(src.derived('intent')).toBeUndefined();
  });

  it('treats a half-written file as absent instead of throwing', () => {
    // A process that died mid-flush must cost one unsynced record, not a crashed sync.
    writeFileSync(join(root, ReticleDir.IMPACT_FILE), '{"counts":', 'utf8');
    expect(diskSource(root).derived('impact')).toBeUndefined();
  });

  it('reads an empty everything on a repo that has never run Reticle', () => {
    const src = diskSource(root);
    expect(src.runs()).toEqual([]);
    expect(src.flows()).toEqual([]);
    expect(readCloudState(root)).toEqual({});
    expect(readCloudIssues(root)).toEqual({ triage: {} });
  });
});

describe('writing what came back', () => {
  it('MERGES decisions rather than replacing them', () => {
    /*
     * The defect this guards: a pull returns only what changed since the cursor. Overwriting would
     * drop every earlier decision the moment one new decision arrived — so a bug resolved last week
     * would quietly come back as untriaged.
     */
    const sink = diskSink(root);
    sink.writeIssues({ triage: { fp1: { status: 'resolved', flowName: 'a', title: 'A', at: 1 } } });
    sink.writeIssues({ triage: { fp2: { status: 'ignored', flowName: 'b', title: 'B', at: 2 } } });
    const held = readCloudIssues(root);
    expect(Object.keys(held.triage).sort()).toEqual(['fp1', 'fp2']);
    expect(held.triage['fp1']?.status).toBe('resolved');
  });

  it('lets a NEWER decision on the same defect win', () => {
    const sink = diskSink(root);
    sink.writeIssues({ triage: { fp1: { status: 'resolved', flowName: 'a', title: 'A', at: 1 } } });
    sink.writeIssues({ triage: { fp1: { status: 'open', flowName: 'a', title: 'A', at: 9 } } });
    expect(readCloudIssues(root).triage['fp1']?.status).toBe('open');
  });

  it('round-trips the cursor', () => {
    diskSink(root).writeState({ cursor: '5:fp1', lastPullAt: 42 });
    expect(readCloudState(root).cursor).toBe('5:fp1');
    expect(readCloudState(root).lastPullAt).toBe(42);
  });

  it('reads a corrupt state file as a fresh start rather than throwing', () => {
    writeFileSync(join(root, ReticleDir.CLOUD_STATE_FILE), 'not json at all', 'utf8');
    expect(readCloudState(root)).toEqual({});
  });

  it('reads a corrupt issues file as no decisions rather than throwing', () => {
    writeFileSync(join(root, ReticleDir.ISSUES_FILE), '{"triage":', 'utf8');
    expect(readCloudIssues(root)).toEqual({ triage: {} });
  });
});
