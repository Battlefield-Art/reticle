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
