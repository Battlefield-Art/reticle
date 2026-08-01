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
 * channel — this stands in for `@reticlehq/browser/electron-preload`.
 */
function fakePreload(): (record: Record<string, unknown>) => void {
  let sink: ((record: Record<string, unknown>) => void) | null = null;
  Reflect.set(window, '__reticleIpc', {
    subscribe: (callback: (record: Record<string, unknown>) => void) => {
      sink = callback;
    },
  });
  return (record) => sink?.(record);
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

  it('is inert with no preload shim (Tauri, and any plain web page)', () => {
    const { emit, all } = recorder();
    expect(() => teardowns.push(installIpc(emit))).not.toThrow();
    expect(all).toEqual([]);
  });
});

describe('ipcNetOverrides — a Tauri invoke arrives as a fetch to its ipc:// protocol', () => {
  it('leaves an ordinary HTTP request alone', () => {
    expect(ipcNetOverrides('https://api.example/users', null)).toBeNull();
    expect(ipcNetOverrides('/api/users', 'error')).toBeNull();
  });

  it('normalizes the command URL and reports Ok', () => {
    expect(ipcNetOverrides('ipc://localhost/load_todos', 'ok')).toEqual({
      url: `${IPC_URL_SCHEME}load_todos`,
      initiator: NetInitiator.IPC,
      method: NetInitiator.IPC,
      ok: true,
      status: IpcStatus.OK,
    });
  });

  /**
   * The whole reason this exists: Tauri answers HTTP 200 for a command that returned Err, so without
   * translating the header a failed Rust command is recorded as a successful request — a false green.
   */
  it('turns a Tauri-Response: error into a failed call despite the HTTP 200', () => {
    expect(ipcNetOverrides('ipc://localhost/archive_todo', 'error')).toMatchObject({
      url: `${IPC_URL_SCHEME}archive_todo`,
      ok: false,
      status: IpcStatus.ERROR,
    });
  });

  it('treats a missing header as success (a non-Tauri producer on the same scheme)', () => {
    expect(ipcNetOverrides('ipc://localhost/whatever', null)).toMatchObject({ ok: true });
  });
});
