/**
 * One logical transport drop must schedule exactly ONE reconnect.
 *
 * A dead socket emits on BOTH halves of an HTTP request — `req`'s `error` and the response's
 * `aborted`/`close` for the same TCP death — and the single-fire latch used to live INSIDE the
 * response callback, so `req.on('error')` scheduled a second reconnect the drop path could not see.
 * Every chain that came back died the same way and split again, and the retry budget could not damp
 * it because any one chain reaching an `endpoint` frame resets the attempt count for all of them.
 *
 * It was found by accident, from its consequences: the proxy log grew without bound and filled a
 * user's disk, and the reconnect churn inflated a headline usage number to a multiple of the truth.
 * The fix is a boolean moved up one scope, which is the kind of edit a later refactor undoes without
 * noticing — so the invariant is pinned here against a REAL socket. The whole defect lives in which
 * Node events fire and in what order, and a test that stubbed `http` would pass while it was present.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { LOOPBACK_HOST, MCP_SSE_PATH } from '@reticlehq/core';
import { proxyLogPath, startMcpProxy } from './mcp-proxy.js';
import { resetOutageReporting } from './mcp-outage.js';

const SESSION_PATH = '/session/fanout';
const SSE_HEADERS = { 'content-type': 'text/event-stream' } as const;
const ENDPOINT_FRAME = `event: endpoint\ndata: ${SESSION_PATH}\n\n`;
/**
 * A client line the proxy will hold while disconnected and post the moment a session exists.
 *
 * `tools/list` rather than `initialize` on purpose: the handshake has a local-answer path of its own,
 * and this test is about the transport, not about what the proxy can answer by itself.
 */
const clientCall = (id: number): string =>
  `${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list' })}\n`;

/**
 * Long enough that a second reconnect would have dialled.
 *
 * NOT a duration assertion: nothing here claims the proxy is fast. Both reconnects of a fan-out are
 * armed by the same drop, at the same moment, one backoff step apart — so a loaded machine delays
 * the duplicate along with the real one, and this window is a settle, not a deadline.
 */
const SETTLE_MS = 1_500;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

interface FakeDaemon {
  port: number;
  /** Every SSE stream the proxy has opened. One per connect attempt, in order. */
  streams: http.ServerResponse[];
  /** Every client line the proxy has posted into a session it was handed. */
  posts: string[];
  close: () => Promise<void>;
}

/**
 * A daemon that serves SSE for real, so the proxy's reconnect path runs over real sockets.
 *
 * Each stream gets an `endpoint` frame immediately. Those frames are also the test's barrier: the
 * proxy only posts a queued client line once it has processed one, so an arriving POST proves the
 * RESPONSE callback for that stream is live — which is what makes killing the socket afterwards fire
 * both halves rather than only `req`'s `error`. Without that proof the test could pass for the wrong
 * reason, which is the one false green available here.
 */
function startFakeDaemon(): Promise<FakeDaemon> {
  const streams: http.ServerResponse[] = [];
  const posts: string[] = [];
  const server = http.createServer((req, res) => {
    if ('POST' === req.method) {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => (body += chunk));
      req.on('end', () => {
        posts.push(body);
        res.writeHead(202).end();
      });
      return;
    }
    // Counted by PATH, so a dial only counts when it is the SSE stream the proxy reconnects with.
    if (!(req.url ?? '').startsWith(MCP_SSE_PATH)) {
      res.writeHead(404).end();
      return;
    }
    streams.push(res);
    res.writeHead(200, SSE_HEADERS);
    res.write(ENDPOINT_FRAME);
  });
  return new Promise<FakeDaemon>((resolve) => {
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        streams,
        posts,
        close: () =>
          new Promise<void>((done) => {
            for (const stream of streams) stream.socket?.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

/** How many times the proxy has dialled the daemon's SSE endpoint. */
const connectAttempts = (daemon: FakeDaemon): number => daemon.streams.length;

const RECONNECTING_EVENT = 'reticle_mcp_proxy_reconnecting';
interface ProxyLogLine {
  event?: string;
  attempt?: number;
}

/**
 * The attempt number of every reconnect the proxy has SCHEDULED, from its own log.
 *
 * A second reading of the same invariant, one step earlier than the dial: a chain that schedules a
 * reconnect and has not got round to dialling it yet is still a chain.
 */
function scheduledReconnectAttempts(): number[] {
  return readFileSync(proxyLogPath(), 'utf8')
    .split('\n')
    .filter((line) => '' !== line)
    .map((line) => JSON.parse(line) as ProxyLogLine)
    .filter((entry) => RECONNECTING_EVENT === entry.event)
    .map((entry) => entry.attempt ?? 0);
}

describe('reconnect fan-out', () => {
  const cleanups: (() => Promise<void> | void)[] = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetOutageReporting();
  });

  /** The proxy logs every reconnect to `~/.reticle`. A test run has no business writing there. */
  function redirectProxyLog(): void {
    vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'reticle-proxy-log-')));
  }

  /**
   * The proxy owns `process.stdin` and `process.stdout` for the life of the process. A test needs a
   * stdin it can write to that never ends — a real one that ends would run the shutdown path and
   * take the whole worker down with `process.exit`.
   */
  function driveProxy(port: number): PassThrough {
    const stdin = new PassThrough({ encoding: 'utf8' });
    const realStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    // Never resolves by design; it runs until stdin closes, which here it never does.
    void startMcpProxy(port).catch(() => {});
    cleanups.push(() => {
      Object.defineProperty(process, 'stdin', { value: realStdin, configurable: true });
      stdin.destroy();
    });
    return stdin;
  }

  it('schedules ONE reconnect for a socket that dies on both halves of the request', async () => {
    redirectProxyLog();
    const daemon = await startFakeDaemon();
    cleanups.push(() => daemon.close());

    const stdin = driveProxy(daemon.port);
    // Queued now, posted the instant the proxy sees the `endpoint` frame — the barrier that says the
    // response callback for this stream is live.
    stdin.write(clientCall(1));
    await vi.waitFor(() => expect(daemon.posts.length).toBe(1));

    // End the FIRST stream cleanly and reconnect off it. The very first connect is the one whose
    // `req` error is a startup failure the caller is handed rather than a reconnect, so the drop
    // being tested has to land on a stream the proxy reached by reconnecting.
    daemon.streams[0]?.end();
    await vi.waitFor(() => expect(connectAttempts(daemon)).toBe(2));
    stdin.write(clientCall(2));
    await vi.waitFor(() => expect(daemon.posts.length).toBe(2));

    // RST, not FIN: a reset is what a daemon killed under the proxy looks like, and it is the only
    // close that fires `req`'s `error` alongside the response's `aborted`/`close`. One dead socket,
    // both halves, and the proxy owes exactly one reconnect for it.
    const socket = daemon.streams[1]?.socket as Socket;
    socket.resetAndDestroy();

    await vi.waitFor(() => expect(connectAttempts(daemon)).toBe(3));
    await settle();
    expect(connectAttempts(daemon)).toBe(3);

    // Two drops, two scheduled reconnects — and both are attempt 1, because the second stream reached
    // an `endpoint` frame and a USABLE session earns a fresh retry budget. That reset is the other
    // half of why the runaway could not damp itself: any one chain coming back zeroed the counter for
    // all of them, pinning the loop at its minimum delay. It is correct on its own and stays, so it is
    // pinned here rather than changed — the fan-out above is the part that had to stop.
    expect(scheduledReconnectAttempts()).toEqual([1, 1]);
  });
});
