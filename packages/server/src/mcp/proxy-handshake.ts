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
import { MCP_SERVER_NAME } from '../init/mcp.js';
import { SERVER_VERSION } from '../version/server-version.js';

/** The version we answer with if the client proposed none. */
const FALLBACK_PROTOCOL_VERSION = '2024-11-05';

/**
 * The protocol's own way to say "the tool list you have is out of date, fetch it again".
 *
 * Load-bearing here rather than a nicety. When we answer `initialize` ourselves the catalog we serve
 * is one we made up, and it is usually empty. Nothing else in the protocol ever corrects that: a
 * client re-lists only when told to, and every other recovery path in the proxy is driven by the
 * NEXT client request, which a client holding no tools never makes. Without this the session is
 * connected, initialized and toolless until a human notices.
 */
export const TOOLS_CHANGED_NOTIFICATION = 'notifications/tools/list_changed';

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

export function localInitializeResponse(
  line: string,
  /**
   * What the daemon would have advertised, so the client is not left with none.
   *
   * A client reads `instructions` ONCE, at initialize, and this response is sent precisely when no
   * daemon is up to send its own — which is the first run of a fresh install. So the block telling
   * someone that having these tools is not the same as being set up was permanently absent for the
   * exact population it addresses, and the daemon's later correct instructions arrive at a client
   * that will never read the field again.
   *
   * Empty means "nothing to say", and the field is then omitted rather than sent blank.
   */
  instructions = '',
): string | null {
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
      // `listChanged` is not decoration: a client that was not told the list can change has no
      // reason to honour the notification we send when the daemon finally arrives, and declaring a
      // capability we then rely on is the difference between a fix and a message into the void.
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: MCP_SERVER_NAME, version: SERVER_VERSION },
      ...('' === instructions ? {} : { instructions }),
    },
  });
}

/**
 * The line that tells a client its tool list is stale, or null when there is nothing to correct.
 *
 * When a daemon arrives after we answered the handshake ourselves, the client is holding a tool list
 * we invented, and on a cold start that list is empty. Nothing else in this protocol corrects it: a
 * client re-lists only when told to, and every other recovery path in the proxy is driven by the
 * NEXT client request, which a client holding no tools never makes. Connected, initialized and
 * toolless for the rest of the session, with a human required to notice and reconnect by hand.
 *
 * Sent only when the catalog was ours. A client that completed a real handshake with the daemon
 * already has the true list, and telling it to refetch would be a round trip for nothing.
 *
 * Lives here rather than in the proxy because it belongs to the locally-answered handshake, which is
 * this module's subject.
 *
 * Worth knowing before relying on it: this is a best-effort correction, not the mechanism. Research
 * into the four clients we target found that only some honour `notifications/tools/list_changed` at
 * all, so the catalog still has to be right in the FIRST answer for the rest. This closes the gap
 * where it is honoured and costs one line where it is not.
 */
export function toolsChangedNotification(catalogWasLocal: boolean): string | null {
  if (!catalogWasLocal) return null;
  return JSON.stringify({ jsonrpc: '2.0', method: TOOLS_CHANGED_NOTIFICATION });
}
