/**
 * The automatic loop. Everything here is about staying INVISIBLE: not overlapping itself, not
 * shouting the same failure once a minute, not starting before a link exists, and not being the
 * reason a process refuses to exit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSyncDaemon } from './sync-daemon.js';
import type { ProjectCloud } from './cloud-config.js';

const LINKED: ProjectCloud = {
  config: { url: 'https://cloud.test', apiKey: 'rk_test' },
  policy: { runs: true, memory: true, flows: true },
  verify: 'local',
  projectId: 'demo',
};
const UNLINKED: ProjectCloud = {
  config: null,
  policy: { runs: true, memory: true, flows: true },
  verify: 'local',
  projectId: null,
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'reticle-syncd-'));
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A server that answers everything successfully and counts what it was asked. */
function counting() {
  let calls = 0;
  const request = (url: string): Promise<{ status: number; text: string }> => {
    calls += 1;
    const body = url.includes('/pull') ? { triage: [], cursor: '0:' } : {};
    return Promise.resolve({ status: 200, text: JSON.stringify(body) });
  };
  return { request, count: (): number => calls };
}

describe('it stays out of the way', () => {
  it('does nothing at all for a project that is not linked', async () => {
    const server = counting();
    const d = startSyncDaemon({
      reticleRoot: root,
      cloud: () => Promise.resolve(UNLINKED),
      request: server.request,
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(server.count()).toBe(0);
    d.stop();
  });

  it('starts syncing once a link appears, with no restart', async () => {
    // `reticle link` must take effect on a daemon that is already running.
    const server = counting();
    let linked = false;
    const d = startSyncDaemon({
      reticleRoot: root,
      cloud: () => Promise.resolve(linked ? LINKED : UNLINKED),
      request: server.request,
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(8000);
    expect(server.count()).toBe(0);
    linked = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(server.count()).toBeGreaterThan(0);
    d.stop();
  });

  it('stops when told to, and schedules nothing further', async () => {
    const server = counting();
    const d = startSyncDaemon({
      reticleRoot: root,
      cloud: () => Promise.resolve(LINKED),
      request: server.request,
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(7000);
    const before = server.count();
    d.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.count()).toBe(before);
  });

  it('does not start a second cycle on top of a slow one', async () => {
    /*
     * Two bundles in flight race, and the cursor written by the loser rewinds the winner's progress
     * — decisions already applied would be pulled and applied again, forever.
     */
    let started = 0;
    let release: (() => void) | undefined;
    const d = startSyncDaemon({
      reticleRoot: root,
      cloud: () => Promise.resolve(LINKED),
      intervalMs: 1000,
      request: () => {
        started += 1;
        return new Promise((resolve) => {
          release = (): void => resolve({ status: 200, text: '{}' });
        });
      },
    });
    await vi.advanceTimersByTimeAsync(6000);
    expect(started, 'the first cycle is in flight').toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(started, 'no second cycle piled on top of it').toBe(1);
    release?.();
    d.stop();
  });
});

describe('it does not shout', () => {
  it('reports a repeated failure ONCE, not once a minute', async () => {
    // A laptop on a train would otherwise write the same line four hundred times.
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(String(args[0]));
    });
    const d = startSyncDaemon({
      reticleRoot: root,
      cloud: () => Promise.resolve(LINKED),
      intervalMs: 1000,
      request: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const failures = logged.filter((l) => l.includes('sync_failed'));
    expect(failures.length).toBeLessThanOrEqual(1);
    d.stop();
  });

  it('keeps cycling after a failure rather than giving up', async () => {
    let calls = 0;
    const d = startSyncDaemon({
      reticleRoot: root,
      cloud: () => Promise.resolve(LINKED),
      intervalMs: 1000,
      request: () => {
        calls += 1;
        return Promise.reject(new Error('offline'));
      },
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls, 'a transient outage must not end the loop').toBeGreaterThan(2);
    d.stop();
  });
});

describe('syncNow', () => {
  it('runs a cycle immediately without waiting for the timer', async () => {
    const server = counting();
    const d = startSyncDaemon({
      reticleRoot: root,
      cloud: () => Promise.resolve(LINKED),
      request: server.request,
      intervalMs: 600_000,
    });
    const report = await d.syncNow();
    expect(report?.ok).toBe(true);
    expect(server.count()).toBeGreaterThan(0);
    d.stop();
  });

  it('answers undefined for an unlinked project instead of pretending', async () => {
    const d = startSyncDaemon({
      reticleRoot: root,
      cloud: () => Promise.resolve(UNLINKED),
      intervalMs: 600_000,
    });
    expect(await d.syncNow()).toBeUndefined();
    d.stop();
  });
});

/**
 * The two silences that cost a whole session: a daemon syncing nothing without saying so, and a
 * finished verification waiting a full interval to appear.
 */
describe('it says whether it is syncing at all', () => {
  it('announces an UNLINKED root once, naming the directory', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown): boolean => {
      lines.push(String(chunk));
      return true;
    });
    const d = startSyncDaemon({
      reticleRoot: root,
      cloud: () => Promise.resolve(UNLINKED),
      request: counting().request,
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    d.stop();
    const said = lines.filter((l) => l.includes('reticle_cloud_unlinked'));
    // Once — not once per tick, which is what teaches people to stop reading the log.
    expect(said).toHaveLength(1);
    // The directory is the answer; without it people go and check their API key instead.
    expect(String(said[0])).toContain(root);
    spy.mockRestore();
  });

  it('announces when a link APPEARS mid-session, so `reticle link` needs no restart', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown): boolean => {
      lines.push(String(chunk));
      return true;
    });
    let linked = false;
    const d = startSyncDaemon({
      reticleRoot: root,
      cloud: () => Promise.resolve(linked ? LINKED : UNLINKED),
      request: counting().request,
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lines.filter((l) => l.includes('reticle_cloud_unlinked'))).toHaveLength(1);
    linked = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lines.filter((l) => l.includes('reticle_cloud_linked'))).toHaveLength(1);
    d.stop();
    spy.mockRestore();
  });
});

describe('nudge', () => {
  it('cycles well before the next tick would have', async () => {
    const server = counting();
    const d = startSyncDaemon({
      reticleRoot: root,
      cloud: () => Promise.resolve(LINKED),
      request: server.request,
      intervalMs: 600_000,
    });
    await vi.advanceTimersByTimeAsync(6_000); // the first cycle
    const afterFirst = server.count();
    d.nudge();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(server.count()).toBeGreaterThan(afterFirst);
    d.stop();
  });

  it('COALESCES a burst into one cycle — six runs must not mean six uploads', async () => {
    const server = counting();
    const d = startSyncDaemon({
      reticleRoot: root,
      cloud: () => Promise.resolve(LINKED),
      request: server.request,
      intervalMs: 600_000,
    });
    await vi.advanceTimersByTimeAsync(6_000);
    const afterFirst = server.count();
    for (let i = 0; i < 6; i += 1) d.nudge();
    await vi.advanceTimersByTimeAsync(3_000);
    // One cycle's worth of requests, not six.
    const perCycle = afterFirst;
    expect(server.count() - afterFirst).toBeLessThanOrEqual(perCycle);
    d.stop();
  });

  it('does not leave an extra timer armed for the life of the process', async () => {
    const server = counting();
    const d = startSyncDaemon({
      reticleRoot: root,
      cloud: () => Promise.resolve(LINKED),
      request: server.request,
      intervalMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(6_000);
    d.nudge();
    await vi.advanceTimersByTimeAsync(3_000);
    const settled = server.count();
    await vi.advanceTimersByTimeAsync(10_000); // ten more intervals
    const perTick = (server.count() - settled) / 10;
    d.stop();
    // A stacked timer would double this. One cycle per interval is the whole claim.
    expect(perTick).toBeLessThanOrEqual(counting().count() + 3);
    d.stop();
  });
});
