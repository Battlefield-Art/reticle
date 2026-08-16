import * as http from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCP_SSE_PATH, MCP_MESSAGE_PATH, STATUS_PATH, DRIVE_PATH } from '@reticlehq/core';
import { getSessionMetrics } from './telemetry/session-metrics.js';
import { noteAgentPeer, PEER_VERSION_PARAM, PEER_CONTRACT_PARAM } from './version/peer-announce.js';
import { log } from './log.js';
import { reportMcpConnected } from './telemetry/mcp-connection.js';
import {
  isLoopbackHost,
  isLocalWebOrigin,
  isLoopbackPeer,
  requestToken,
  tokensMatch,
} from './bridge/token-auth.js';

export interface SharedServer {
  readonly httpServer: http.Server;
  /**
   * Register a factory that creates a fresh McpServer per SSE connection.
   * The MCP SDK's Protocol layer only supports one transport per Server instance,
   * so each concurrent Claude Code client needs its own McpServer.
   * Must be called before listen.
   */
  attachMcp(factory: () => McpServer): void;
  /** Register the JSON the daemon returns from GET /status (live sessions + health for `reticle status`). */
  attachStatus(provider: () => unknown): void;
  /**
   * Register the handler behind POST /drive: open a driveable browser at `url` and answer with the
   * session it registered.
   *
   * This is how `reticle drive` stops fighting the daemon for the bridge port. The daemon already
   * owns the browser plane, so driving is a request to it — see cli/drive-attach.ts. Left
   * unattached, the route 404s, which is exactly what a newer CLI needs to hear from an older daemon.
   */
  attachDrive(provider: (url: string) => Promise<unknown>): void;
  /**
   * Register a callback fired when the AGENT presence changes — true when the first MCP client (any
   * agent: Codex/OpenCode/Claude/Hermes) connects, false when the last one disconnects. Agent-
   * independent: the MCP connection lives exactly as long as the agent session, so its presence IS
   * "is an agent attached?". The daemon uses this to tell the panel "agent live" vs "agent stopped".
   */
  attachAgentPresence(cb: (connected: boolean) => void): void;
  close(): Promise<void>;
}

/**
 * Creates a shared HTTP server that handles both the WebSocket bridge (browser SDK) and the
 * SSE MCP transport (Claude/agent). Does NOT call listen — caller controls that.
 *
 * Routes:
 * GET /mcp/sse → establishes SSE MCP session
 * POST /mcp/message → routes MCP messages to an active SSE session
 * WS /reticle → browser SDK connections (via WebSocketServer)
 */
export function createSharedServer(options: { token?: string } = {}): SharedServer {
  type McpFactory = () => McpServer;
  let mcpFactory: McpFactory | undefined;
  let statusProvider: (() => unknown) | undefined;
  let driveProvider: ((url: string) => Promise<unknown>) | undefined;
  let agentPresence: ((connected: boolean) => void) | undefined;
  const transports = new Map<string, SSEServerTransport>();
  const token = options.token;

  // The agent control plane (MCP transport) and /status carry the same trust as the browser WS: a
  // loopback peer is trusted (the local stdio proxy and `reticle status` always dial 127.0.0.1), but any
  // non-loopback peer must present the pairing token. Without this, binding the daemon beyond loopback
  // (RETICLE_HOST) would expose reticle_act/reticle_navigate and session enumeration to the whole network even
  // though the WS demanded a token. When no token is configured the bind is loopback-only anyway.
  //
  // Loopback-peer trust alone is not enough: a DNS-rebound webpage reaches us AS a loopback peer while
  // its browser sends the attacker's original Host/Origin. So the loopback-trust tier additionally
  // requires a loopback Host header and a loopback-or-absent Origin/Referer — the same rebinding
  // defense the WS bridge has (#originAllowed). A rebound page fails those and falls through to the
  // token check (which it cannot satisfy). Legitimate remote clients on a RETICLE_HOST bind present the
  // token instead of relying on loopback trust, so this never breaks them.
  const authorized = (req: http.IncomingMessage, url: URL): boolean => {
    const localClient =
      isLoopbackPeer(req.socket.remoteAddress) &&
      isLoopbackHost(req.headers.host) &&
      isLocalWebOrigin(req.headers.origin, req.headers.referer);
    if (localClient) return true;
    if (token === undefined) return false;
    return tokensMatch(token, requestToken(req, url));
  };

  const httpServer = http.createServer((req, res) => {
    const rawUrl = req.url ?? '/';
    const url = new URL(rawUrl, 'http://localhost');
    const path = url.pathname;

    if (
      path === STATUS_PATH ||
      path === DRIVE_PATH ||
      path === MCP_SSE_PATH ||
      path === MCP_MESSAGE_PATH
    ) {
      if (!authorized(req, url)) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('unauthorized');
        return;
      }
    }

    if ('GET' === req.method && path === STATUS_PATH) {
      const body = JSON.stringify(statusProvider?.() ?? { running: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    if ('POST' === req.method && path === DRIVE_PATH) {
      if (driveProvider === undefined) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      const provider = driveProvider;
      readBody(req)
        .then(async (body) => {
          const url = urlFromDriveRequest(body);
          if (url === undefined) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('drive requires a url');
            return;
          }
          // A refusal is an ANSWER. The caller is a foreground CLI waiting on this socket: a thrown
          // handler that took the response down with it would hang `reticle drive` on a request
          // that can never complete — the same shape of silence the raw EADDRINUSE bind had.
          const payload = await provider(url).catch((err: unknown) => ({
            error: err instanceof Error ? err.message : String(err),
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        })
        .catch((err: unknown) => {
          log('drive_request_error', { error: err instanceof Error ? err.message : String(err) });
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('drive failed');
        });
      return;
    }

    if ('GET' === req.method && path === MCP_SSE_PATH) {
      // The agent's MCP server announces itself here, on the connect it already makes. The daemon is
      // the single judge of skew, so this is where the third pair is decided — and unlike the CLI's
      // own check (a stderr line no agent reads), a nudge queued here rides out on the agent's next
      // tool result. That is the pair the user hits after `npm update`: a cached npx MCP package
      // talking to a daemon from a different build.
      noteAgentPeer(
        url.searchParams.get(PEER_VERSION_PARAM),
        url.searchParams.get(PEER_CONTRACT_PARAM),
      );
      if (mcpFactory === undefined) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('MCP server not ready');
        return;
      }
      // Fresh McpServer per connection: the MCP SDK's Protocol layer only supports
      // one active transport per Server instance, so concurrent clients each need
      // their own instance backed by the same shared ToolDeps.
      const mcpServer = mcpFactory();
      const transport = new SSEServerTransport(MCP_MESSAGE_PATH, res);
      const sid = transport.sessionId;
      transports.set(sid, transport);
      if (1 === transports.size) agentPresence?.(true); // first agent attached
      res.on('close', () => {
        transports.delete(sid);
        transport.close().catch(() => undefined);
        mcpServer.close().catch(() => undefined);
        log('mcp_client_disconnected', { sessionId: sid });
        // The one part of `endReason` a query cannot derive: "the client detached" and "the agent
        // stopped asking" produce identical counters and are different findings.
        try {
          getSessionMetrics().recordClientLeft();
        } catch {
          /* a counter must never affect a disconnect path */
        }
        if (0 === transports.size) agentPresence?.(false); // last agent detached → it's the human's turn
      });
      mcpServer
        .connect(transport)
        .then(() => {
          log('mcp_client_connected', { sessionId: sid });
          // The one signal that separates "Reticle is running" from "somebody is USING it": a daemon
          // can sit up for days with nothing attached. It also exposes reconnect churn, which is
          // indistinguishable from healthy usage in every other metric.
          reportMcpConnected();
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          log('mcp_connect_error', { error: message });
        });
      return;
    }

    if ('POST' === req.method && path === MCP_MESSAGE_PATH) {
      const sessionId = url.searchParams.get('sessionId');
      if (null === sessionId) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('missing sessionId');
        return;
      }
      const transport = transports.get(sessionId);
      if (transport === undefined) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('session not found');
        return;
      }
      transport.handlePostMessage(req, res).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        log('mcp_message_error', { error: message });
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  function attachStatus(provider: () => unknown): void {
    statusProvider = provider;
  }

  function attachDrive(provider: (url: string) => Promise<unknown>): void {
    driveProvider = provider;
  }

  function attachAgentPresence(cb: (connected: boolean) => void): void {
    agentPresence = cb;
  }

  function attachMcp(factory: McpFactory): void {
    mcpFactory = factory;
  }

  async function close(): Promise<void> {
    for (const transport of transports.values()) {
      await transport.close();
    }
    transports.clear();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        // A server that never listened is already closed, and saying so is not an error worth
        // propagating. It matters because this close() runs on the CLEANUP path of a failed
        // `--drive`: when the app URL is unreachable, the daemon tears down before `listen()` has
        // been called, Node rejects with ERR_SERVER_NOT_RUNNING, and that rejection REPLACES the
        // real cause. The user's app is down and the message they read is "Server is not running",
        // which blames Reticle for their dev server — traced live, where swallowing this turned the
        // same failure back into "net::ERR_CONNECTION_REFUSED at http://localhost:4312/".
        if (
          err !== undefined &&
          err !== null &&
          'ERR_SERVER_NOT_RUNNING' !== (err as NodeJS.ErrnoException).code
        ) {
          reject(err);
        } else resolve();
      });
    });
  }

  return { httpServer, attachMcp, attachStatus, attachDrive, attachAgentPresence, close };
}

/** Cap on a drive request body. A url is short; anything larger is not one. */
const MAX_DRIVE_BODY_BYTES = 8 * 1024;

/** Collect a request body, refusing one too large to be what this route accepts. */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_DRIVE_BODY_BYTES) {
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/** The `url` out of a drive request body, or undefined when there isn't a usable one. Pure. */
function urlFromDriveRequest(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || null === parsed) return undefined;
  const url = (parsed as Record<string, unknown>)['url'];
  return 'string' === typeof url && url.length > 0 ? url : undefined;
}
