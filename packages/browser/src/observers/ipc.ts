import {
  EventType,
  IPC_URL_SCHEME,
  IpcStatus,
  NetInitiator,
  RETICLE_IPC_GLOBAL,
} from '@reticlehq/core';
import type { Emit, Teardown } from './types.js';
import { observeSafely } from './types.js';

/**
 * IPC observer — the desktop counterpart to the network observer.
 *
 * An Electron or Tauri app does not reach its backend over HTTP: it calls into the main process /
 * Rust core over IPC. Left unobserved, every backend call in a desktop app is a blind spot:
 * `reticle_network` reports nothing, `act_and_wait` has no in-flight request to settle on, and
 * `assert { net }` is vacuously true — a false green by construction.
 *
 * Observed calls are reported as the SAME pair the network observer emits (NET_PENDING at call time,
 * NET_REQUEST at resolution) with `initiator: 'ipc'` and the channel name as an `ipc://` url, so the
 * existing tools, oracles and settle logic work on desktop unchanged. No new wire contract.
 *
 * NEITHER runtime can be instrumented by patching what the page can see — both harden their IPC
 * entry point, which is why this file contains two mechanisms and no direct monkey-patching:
 *
 *  - **Electron**: `contextBridge.exposeInMainWorld` hands the renderer a deeply frozen,
 *    non-configurable object. Calls are observed in the PRELOAD, by
 *    `@reticlehq/electron/preload`, and pushed to the channel this file subscribes to.
 *  - **Tauri v2**: `__TAURI_INTERNALS__.invoke` is `writable: false, configurable: false`. It does
 *    not need patching — an `invoke` travels as a real `fetch` to Tauri's `ipc://` custom protocol,
 *    which the network observer already sees. See `ipcNetOverrides`.
 */

/** One report from the preload shim: a call starting, or the same call settling. */
interface PreloadRecord {
  phase: 'start' | 'end';
  id: string;
  channel: string;
  ok?: boolean;
  durationMs?: number;
  error?: string;
}

interface PreloadChannel {
  subscribe: (callback: (record: PreloadRecord) => void) => void;
}

/**
 * How Tauri v2 reports a command's verdict. The transport answers HTTP 200 whether the Rust command
 * returned Ok or Err — the verdict is in this response header, which Tauri explicitly CORS-exposes so
 * JS may read it. Without translating it, every failed command is recorded as a successful request.
 */
export const TAURI_RESPONSE_HEADER_NAME = 'Tauri-Response';
const TAURI_RESPONSE_ERROR = 'error';

/** Rust/IPC vocabulary rather than HTTP's, so the text never claims a transport status it lacks. */
const IPC_STATUS_TEXT = { OK: 'Ok', ERROR: 'Err' } as const;

/** Tauri's IPC endpoint, e.g. `ipc://localhost/archive_todo`. The last segment is the command. */
const TAURI_IPC_URL = /^ipc:\/\/[^/]*\/(.+)$/;

/**
 * Fields to override on a NET_REQUEST that turned out to be a Tauri IPC call, or null when the
 * request was ordinary HTTP. Pure — the network observer calls this with the response header it
 * already holds, so IPC knowledge stays in this file.
 */
export function ipcNetOverrides(
  url: string,
  header: (name: string) => string | null,
): Record<string, unknown> | undefined {
  const match = TAURI_IPC_URL.exec(url);
  const command = match?.[1];
  if (command === undefined) return undefined;
  const ok = header(TAURI_RESPONSE_HEADER_NAME) !== TAURI_RESPONSE_ERROR;
  return {
    // Normalize `ipc://localhost/archive_todo` to `ipc://archive_todo`, so a Tauri command and an
    // Electron channel read identically to the agent and to a saved flow's assertions.
    url: `${IPC_URL_SCHEME}${command}`,
    initiator: NetInitiator.IPC,
    method: NetInitiator.IPC,
    ok,
    status: ok ? IpcStatus.OK : IpcStatus.ERROR,
    // Overwrite the TRANSPORT's statusText. Tauri's fetch genuinely answered 200/"OK", so letting it
    // through beside a synthetic 500 produced a record that contradicted itself — `status: 500,
    // statusText: "OK"` reads as nonsense to anyone seeing it cold. The record must tell one story,
    // and the story that matters is the command's verdict, not the pipe it travelled down.
    statusText: ok ? IPC_STATUS_TEXT.OK : IPC_STATUS_TEXT.ERROR,
  };
}

/**
 * Subscribe to the Electron preload shim, if this app installed it. Inert on Tauri (whose calls the
 * network observer handles) and on a plain web page.
 */
export function installIpc(emit: Emit): Teardown {
  const channel = (window as unknown as Record<string, unknown>)[RETICLE_IPC_GLOBAL] as
    | PreloadChannel
    | undefined;
  if (typeof channel?.subscribe !== 'function') return () => undefined;

  channel.subscribe((record) => {
    observeSafely(() => {
      const url = `${IPC_URL_SCHEME}${record.channel}`;
      if (record.phase === 'start') {
        emit(EventType.NET_PENDING, {
          id: record.id,
          method: NetInitiator.IPC,
          url,
          initiator: NetInitiator.IPC,
        });
        return;
      }
      const ok = record.ok === true;
      emit(EventType.NET_REQUEST, {
        id: record.id,
        method: NetInitiator.IPC,
        url,
        ok,
        status: ok ? IpcStatus.OK : IpcStatus.ERROR,
        durationMs: record.durationMs ?? 0,
        initiator: NetInitiator.IPC,
        ...(record.error === undefined ? {} : { error: record.error }),
      });
    });
  });

  // Detaching the sink is the teardown — the preload's patch stays, but stops reporting.
  return () => {
    channel.subscribe(() => {
      /* detached */
    });
  };
}
