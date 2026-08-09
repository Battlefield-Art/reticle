/**
 * The daemon survives a stray async rejection (one agent's error can't crash the fleet) but exits
 * cleanly on a genuine uncaught synchronous throw (so it can be respawned fresh).
 */

import { describe, expect, it } from 'vitest';
import {
  CrashKind,
  installDaemonResilience,
  installProxyResilience,
  type ProcessLike,
} from './daemon-resilience.js';

/** A fake process that records listeners and lets the test emit events. */
function fakeProc(): ProcessLike & { emit: (event: string, arg: unknown) => void } {
  const listeners = new Map<string, (arg: unknown) => void>();
  return {
    on(event, listener) {
      listeners.set(event, listener);
      return this;
    },
    emit(event, arg) {
      listeners.get(event)?.(arg);
    },
  };
}

describe('installDaemonResilience', () => {
  it('logs an unhandled rejection and KEEPS running (no fatal exit)', () => {
    const logs: { event: string; data: Record<string, unknown> }[] = [];
    let fatal = 0;
    const proc = fakeProc();
    installDaemonResilience(
      proc,
      (event, data) => logs.push({ event, data }),
      () => (fatal += 1),
    );

    proc.emit('unhandledRejection', new Error('one agent blew up'));

    expect(fatal).toBe(0); // the daemon stays alive for the other agents
    expect(logs).toHaveLength(1);
    expect(logs[0]?.event).toBe('reticle_daemon_unhandled_rejection');
    expect(logs[0]?.data['reason']).toBe('one agent blew up');
  });

  it('logs an uncaught exception and exits cleanly (respawnable)', () => {
    const logs: { event: string; data: Record<string, unknown> }[] = [];
    let fatal = 0;
    const proc = fakeProc();
    installDaemonResilience(
      proc,
      (event, data) => logs.push({ event, data }),
      () => (fatal += 1),
    );

    proc.emit('uncaughtException', new Error('truly unexpected'));

    expect(fatal).toBe(1); // exit so the next `reticle mcp` respawns a fresh daemon
    expect(logs[0]?.event).toBe('reticle_daemon_uncaught_exception');
    expect(logs[0]?.data['error']).toBe('truly unexpected');
  });

  it('stringifies non-Error reasons safely', () => {
    const logs: Record<string, unknown>[] = [];
    const proc = fakeProc();
    installDaemonResilience(
      proc,
      (_e, data) => logs.push(data),
      () => undefined,
    );
    proc.emit('unhandledRejection', 'a string rejection');
    expect(logs[0]?.['reason']).toBe('a string rejection');
  });
});

/**
 * The proxy's rule is the OPPOSITE of the daemon's, and the difference is who can restart it.
 *
 * A daemon that exits on an uncaught throw is respawned by the next `reticle mcp`, so exiting is the
 * safe answer there. Nothing respawns the PROXY: it is the stdio MCP server the editor launched, and
 * when it exits the client marks the server disconnected, drops its tools, and waits for a human to
 * open /mcp and reconnect. Staying up with a logged error is strictly better than that, because the
 * proxy's own state is a socket and a queue — both of which it already knows how to rebuild.
 */
describe('installProxyResilience — the MCP server must outlive its own bugs', () => {
  it('logs an uncaught exception and KEEPS SERVING — exiting would disconnect the client', () => {
    const proc = fakeProc();
    const lines: { event: string; data: Record<string, unknown> }[] = [];
    const crashes: CrashKind[] = [];
    // There is no fatal hook to pass: the signature cannot express "and then exit", which is the
    // point. The daemon's equivalent takes one and uses it; the proxy has nobody to respawn it.
    installProxyResilience(proc, (event, data) => lines.push({ event, data }), (kind) =>
      crashes.push(kind),
    );
    proc.emit('uncaughtException', new Error('a bug in the proxy'));
    expect(lines.some((l) => l.event.includes('uncaught'))).toBe(true);
    expect(crashes, 'still reported, just not fatal').toEqual([CrashKind.UNCAUGHT_EXCEPTION]);
  });

  it('logs an unhandled rejection and keeps serving', () => {
    const proc = fakeProc();
    const lines: { event: string; data: Record<string, unknown> }[] = [];
    installProxyResilience(proc, (event, data) => lines.push({ event, data }), () => undefined);
    proc.emit('unhandledRejection', 'a stray promise');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.event).toContain('proxy');
  });
});
