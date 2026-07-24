import * as http from 'node:http';
import * as net from 'node:net';
import { LOOPBACK_HOST, MCP_SSE_PATH } from '@reticlehq/core';
import { log } from './log.js';

const DEFAULT_DAEMON_READY_TIMEOUT_MS = 10_000;
/**
 * How long to wait for the spawned daemon's port to accept connections before giving up. The default
 * suits a normal machine; a slow CI/VM (heavy headless-browser launch) can raise it via the
 * RETICLE_DAEMON_READY_TIMEOUT_MS env var. Invalid/absent values fall back to the default.
 */
const envDaemonReadyTimeoutMs = Number(process.env['RETICLE_DAEMON_READY_TIMEOUT_MS']);
const DAEMON_READY_TIMEOUT_MS =
  Number.isFinite(envDaemonReadyTimeoutMs) && envDaemonReadyTimeoutMs > 0
    ? envDaemonReadyTimeoutMs
    : DEFAULT_DAEMON_READY_TIMEOUT_MS;
const DAEMON_POLL_INTERVAL_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One parsed Server-Sent-Events frame: the event name (defaulted to "message") and its data. */
export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Incremental SSE frame parser for the MCP front door.
 *
 * A single SSE field can split across TCP reads (`da` in one chunk, `ta: {...}` in the next), and a
 * server may send CRLF or bare CR line endings — so the framing is stateful and edge-case-prone, yet it
 * carried every MCP message the agent sends and was only ever exercised end-to-end. Pulled out of the
 * socket handler as a pure, chunk-fed parser so those boundaries are unit-testable: feed raw chunks,
 * get back each complete frame (a blank line terminates a frame; `event:` names it, `data:` lines
 * accumulate newline-joined; `id:`/`retry:`/comments are ignored — not needed for the bridge).
 */
export class SseFrameParser {
  #buffer = '';
  #event = '';
  #data = '';

  push(chunk: string): SseFrame[] {
    this.#buffer += chunk;
    // Normalise CRLF/CR so the splitter only handles \n, then hold the trailing partial line for the
    // next chunk (it may complete later).
    const normalised = this.#buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalised.split('\n');
    this.#buffer = lines.pop() ?? '';
    const frames: SseFrame[] = [];
    for (const line of lines) {
      if (line === '') {
        if (this.#data !== '') {
          frames.push({ event: this.#event !== '' ? this.#event : 'message', data: this.#data });
        }
        this.#event = '';
        this.#data = '';
      } else if (line.startsWith('event:')) {
        this.#event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const val = line.slice(5).trim();
        this.#data = this.#data !== '' ? `${this.#data}\n${val}` : val;
      }
    }
    return frames;
  }
}

/**
 * Returns true if something is already listening on the reticle port.
 * Uses a plain TCP probe so we don't create a side-effectful SSE session
 * inside the daemon just to check reachability.
 */
export function probeDaemon(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, LOOPBACK_HOST);
  });
}

/** Poll until the daemon's HTTP port accepts connections or the deadline is reached. */
export async function waitForDaemon(port: number): Promise<void> {
  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const reachable = await probeDaemon(port);
    if (reachable) return;
    await delay(DAEMON_POLL_INTERVAL_MS);
  }
  throw new Error(
    `reticle daemon did not become ready on port ${port} within ${DAEMON_READY_TIMEOUT_MS}ms`,
  );
}

function postToSession(url: string, body: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const parsed = new URL(url);
    const bodyBuf = Buffer.from(body, 'utf8');
    const options: http.RequestOptions = {
      host: parsed.hostname,
      port: parsed.port !== '' ? parseInt(parsed.port, 10) : 80,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': bodyBuf.byteLength,
      },
    };
    const req = http.request(options, (res) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        // A non-2xx from the daemon MCP endpoint used to be swallowed, hanging the JSON-RPC call
        // client-side with no diagnostic. Surface it (the forward is still fire-and-forget).
        log('reticle_mcp_proxy_post_non2xx', { status, path: options.path });
      }
      res.resume(); // drain so the socket is reused
      resolve();
    });
    req.on('error', (err) => {
      log('reticle_mcp_proxy_post_error', { error: err.message });
      resolve();
    });
    req.write(bodyBuf);
    req.end();
  });
}

export function buildSessionUrl(rawData: string, port: number): string {
  return rawData.startsWith('/') ? `http://${LOOPBACK_HOST}:${port}${rawData}` : rawData;
}

/**
 * Bridge stdio ↔ SSE: connects to the running daemon's MCP endpoint and forwards
 * Claude Code's stdin/stdout JSON-RPC through it. Never resolves — runs until
 * stdin closes or the SSE stream ends (at which point the process exits so
 * Claude Code restarts the proxy fresh).
 */
export function startMcpProxy(port: number): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    let postUrl: string | null = null;
    const stdinQueue: string[] = [];

    // ── SSE reader ──────────────────────────────────────────────────────────
    const req = http.get({ host: LOOPBACK_HOST, port, path: MCP_SSE_PATH }, (res) => {
      res.setEncoding('utf8');

      const sse = new SseFrameParser();
      res.on('data', (chunk: string) => {
        for (const frame of sse.push(chunk)) onSseEvent(frame.event, frame.data, port);
      });

      res.on('end', () => {
        log('reticle_mcp_proxy_sse_ended', { port });
        process.exit(0);
      });

      res.on('error', (err) => {
        log('reticle_mcp_proxy_sse_error', { error: err.message });
        process.exit(1);
      });
    });

    req.on('error', (err) => reject(err));

    function onSseEvent(event: string, data: string, p: number): void {
      if (event === 'endpoint') {
        const url = buildSessionUrl(data, p);
        postUrl = url;
        // Flush messages that arrived before the session URL was known
        for (const queued of stdinQueue.splice(0)) {
          void postToSession(url, queued);
        }
        return;
      }
      if (event === 'message') {
        process.stdout.write(`${data}\n`);
      }
    }

    // ── stdin reader ─────────────────────────────────────────────────────────
    process.stdin.setEncoding('utf8');
    let stdinBuffer = '';

    process.stdin.on('data', (chunk: string) => {
      stdinBuffer += chunk;
      const lines = stdinBuffer.split('\n');
      stdinBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        if (postUrl === null) {
          stdinQueue.push(trimmed);
        } else {
          void postToSession(postUrl, trimmed);
        }
      }
    });

    process.stdin.on('end', () => process.exit(0));
  });
}
