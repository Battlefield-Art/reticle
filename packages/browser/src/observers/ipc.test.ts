import { afterEach, describe, expect, it } from 'vitest';
import { EventType, IPC_URL_SCHEME, IpcStatus, NetInitiator } from '@reticlehq/core';
import { installIpc, ipcNetOverrides } from './ipc.js';

interface Emitted {
  type: EventType;
  data: Record<string, unknown>;
}

function recorder(): { emit: (t: EventType, d: Record<string, unknown>) => void; all: Emitted[] } {
  const all: Emitted[] = [];
  return { emit: (type, data) => all.push({ type, data }), all };
}

const teardowns: (() => void)[] = [];

afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
  Reflect.deleteProperty(window, '__reticleIpc');
});

/**
 * The renderer CANNOT patch a contextBridge API: `exposeInMainWorld` installs a deeply frozen,
 * non-configurable object. So Electron IPC is observed in the preload and pushed through this
 * channel — this stands in for `@reticlehq/electron/preload`.
 */
function fakePreload(): (record: Record<string, unknown>) => void {
  // Mirrors the real preload: many subscribers, keyed by token, with a real removal.
  const sinks = new Map<number, (record: Record<string, unknown>) => void>();
  let token = 0;
  Reflect.set(window, '__reticleIpc', {
    subscribe: (callback: (record: Record<string, unknown>) => void) => {
      token += 1;
      sinks.set(token, callback);
      return token;
    },
    unsubscribe: (id: number) => sinks.delete(id),
  });
  return (record) => {
    for (const sink of sinks.values()) sink(record);
  };
}

describe('IPC observer — Electron (reports arrive from the preload shim)', () => {
  it('turns a start/end pair from the preload into the same events a fetch produces', () => {
    const push = fakePreload();
    const { emit, all } = recorder();
    teardowns.push(installIpc(emit));

    push({ phase: 'start', id: 'i1', channel: 'todos:load' });
    push({ phase: 'end', id: 'i1', channel: 'todos:load', ok: true, durationMs: 120 });

    expect(all.map((e) => e.type)).toEqual([EventType.NET_PENDING, EventType.NET_REQUEST]);
    expect(all[0]?.data['url']).toBe(`${IPC_URL_SCHEME}todos:load`);
    expect(all[1]).toMatchObject({
      data: {
        id: 'i1',
        ok: true,
        status: IpcStatus.OK,
        durationMs: 120,
        initiator: NetInitiator.IPC,
      },
    });
  });

  it('carries a failed main-process handler through as ok:false with its message', () => {
    const push = fakePreload();
    const { emit, all } = recorder();
    teardowns.push(installIpc(emit));

    push({ phase: 'start', id: 'i2', channel: 'todos:archive' });
    push({
      phase: 'end',
      id: 'i2',
      channel: 'todos:archive',
      ok: false,
      durationMs: 80,
      error: 'archive is not implemented in the backend',
    });

    expect(all[1]?.data['ok']).toBe(false);
    expect(all[1]?.data['error']).toBe('archive is not implemented in the backend');
    // The synthetic status is what makes the failure findable via reticle_network { status: 500 }.
    expect(all[1]?.data['status']).toBe(IpcStatus.ERROR);
  });

  it('never lets a throwing emit escape into the app', () => {
    const push = fakePreload();
    teardowns.push(
      installIpc(() => {
        throw new Error('sink exploded');
      }),
    );
    expect(() => push({ phase: 'start', id: 'i3', channel: 'todos:load' })).not.toThrow();
  });

  it('stops emitting after teardown', () => {
    const push = fakePreload();
    const { emit, all } = recorder();
    installIpc(emit)();

    push({ phase: 'start', id: 'i4', channel: 'todos:load' });
    expect(all).toEqual([]);
  });

  /**
   * A single-slot sink meant a second connect() in the same renderer silently stole the first one's
   * subscription, and "teardown" was really "overwrite with a no-op" — so tearing one session down
   * killed reporting for the other. Both must be able to observe, and each must remove only itself.
   */
  it('supports two independent subscribers, and removing one leaves the other reporting', () => {
    const push = fakePreload();
    const first = recorder();
    const second = recorder();
    const stopFirst = installIpc(first.emit);
    teardowns.push(installIpc(second.emit));

    push({ phase: 'start', id: 'i1', channel: 'todos:load' });
    expect(first.all).toHaveLength(1);
    expect(second.all).toHaveLength(1);

    stopFirst();
    push({ phase: 'start', id: 'i2', channel: 'todos:load' });
    expect(first.all, 'the torn-down subscriber must stop').toHaveLength(1);
    expect(second.all, 'the surviving subscriber must keep reporting').toHaveLength(2);
  });

  it('tolerates an older preload with no unsubscribe rather than throwing', () => {
    const sinks: ((record: Record<string, unknown>) => void)[] = [];
    Reflect.set(window, '__reticleIpc', {
      subscribe: (cb: (record: Record<string, unknown>) => void) => sinks.push(cb),
    });
    const { emit } = recorder();
    expect(() => installIpc(emit)()).not.toThrow();
  });

  it('is inert with no preload shim (Tauri, and any plain web page)', () => {
    const { emit, all } = recorder();
    expect(() => teardowns.push(installIpc(emit))).not.toThrow();
    expect(all).toEqual([]);
  });
});

describe('ipcNetOverrides — a Tauri invoke arrives as a fetch to its ipc:// protocol', () => {
  it('leaves an ordinary HTTP request alone', () => {
    expect(ipcNetOverrides('https://api.example/users', () => null)).toBeUndefined();
    expect(ipcNetOverrides('/api/users', () => 'error')).toBeUndefined();
  });

  it('normalizes the command URL and reports Ok', () => {
    expect(ipcNetOverrides('ipc://localhost/load_todos', () => 'ok')).toEqual({
      url: `${IPC_URL_SCHEME}load_todos`,
      initiator: NetInitiator.IPC,
      method: NetInitiator.IPC,
      ok: true,
      status: IpcStatus.OK,
      // Overwrites the transport's own statusText so the record cannot contradict itself.
      statusText: 'Ok',
    });
  });

  /**
   * The whole reason this exists: Tauri answers HTTP 200 for a command that returned Err, so without
   * translating the header a failed Rust command is recorded as a successful request — a false green.
   */
  it('turns a Tauri-Response: error into a failed call despite the HTTP 200', () => {
    expect(ipcNetOverrides('ipc://localhost/archive_todo', () => 'error')).toMatchObject({
      url: `${IPC_URL_SCHEME}archive_todo`,
      ok: false,
      status: IpcStatus.ERROR,
    });
  });

  it('treats a missing header as success (a non-Tauri producer on the same scheme)', () => {
    expect(ipcNetOverrides('ipc://localhost/whatever', () => null)).toMatchObject({ ok: true });
  });
});

describe('an IPC record must not contradict itself', () => {
  /**
   * A Tauri IPC failure used to be emitted as `status: 500` while the transport's own
   * `statusText: "OK"` passed straight through, because the underlying fetch really did answer 200.
   * The resulting record read as nonsense to anyone looking at it cold, and "OK" next to 500 is
   * exactly the kind of internal contradiction this project exists to eliminate — in its own output.
   *
   * The synthetic status stays (it is what makes `reticle_network { status: 500 }` work uniformly),
   * but the record must describe ONE consistent story.
   */
  it('clears a transport statusText that would disagree with the command verdict', () => {
    const failed = ipcNetOverrides('ipc://localhost/archive_todo', () => 'error');
    expect(failed?.['status']).toBe(IpcStatus.ERROR);
    expect(failed?.['statusText']).toBe('Err');
  });

  it('describes a successful command consistently too', () => {
    const ok = ipcNetOverrides('ipc://localhost/load_todos', () => 'ok');
    expect(ok?.['status']).toBe(IpcStatus.OK);
    expect(ok?.['statusText']).toBe('Ok');
  });
});
