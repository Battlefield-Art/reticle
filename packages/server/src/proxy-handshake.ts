/**
 * Answer `initialize` when the daemon cannot.
 *
 * The proxy queues every client message until the daemon's SSE endpoint frame arrives. `initialize`
 * is a client message, so when the daemon port is held by something that accepts connections and
 * never serves SSE — a wedged daemon, a foreign process, a daemon leaked by another project — the
 * handshake waits on a thing that is never coming. Reported from the field as "initialize never
 * answers, no tools run at all"; reproduced with a listener that simply never responds.
 *
 * A hang is the worst possible outcome here: no tools, no diagnosis, nothing to retry. Completing
 * the handshake locally gives the agent a working surface whose FIRST tool call reports the real
 * problem through the no-session diagnostics that already exist.
 *
 * Safe because the proxy replays the client's own `initialize` to the daemon whenever a session is
 * finally established (see `replayLines`), so the daemon still gets its handshake in order.
 */
import { MCP_SERVER_NAME } from './init/mcp.js';
import { SERVER_VERSION } from './server-version.js';

/** The version we answer with if the client proposed none. */
const FALLBACK_PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcLike {
  id?: unknown;
  method?: unknown;
  params?: { protocolVersion?: unknown };
}

function parseLine(line: string): JsonRpcLike | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return 'object' === typeof parsed && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** True when this queued client line is the handshake we answered ourselves. */
export function isHandshakeLine(line: string): boolean {
  const msg = parseLine(line);
  return 'initialize' === msg?.method || 'notifications/initialized' === msg?.method;
}

export function localInitializeResponse(line: string): string | null {
  const msg = parseLine(line);
  if (null === msg || msg.method !== 'initialize') return null;
  // A notification carries no id and expects no reply; answering one is a protocol error.
  if (msg.id === undefined || null === msg.id) return null;
  const proposed = msg.params?.protocolVersion;
  return JSON.stringify({
    jsonrpc: '2.0',
    id: msg.id,
    result: {
      // Echo what the client asked for: answering with a version it did not offer is its own
      // handshake failure.
      protocolVersion: 'string' === typeof proposed ? proposed : FALLBACK_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: MCP_SERVER_NAME, version: SERVER_VERSION },
    },
  });
}
