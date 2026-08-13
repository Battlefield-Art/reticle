import * as http from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCP_SSE_PATH, MCP_MESSAGE_PATH, STATUS_PATH } from '@reticlehq/core';
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

    if (path === STATUS_PATH || path === MCP_SSE_PATH || path === MCP_MESSAGE_PATH) {
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

  return { httpServer, attachMcp, attachStatus, attachAgentPresence, close };
}
