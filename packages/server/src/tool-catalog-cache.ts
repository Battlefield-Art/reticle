/**
 * The tool catalog the proxy has already seen, so a locally-answered handshake is not toolless.
 *
 * When the daemon does not answer in time the proxy answers `initialize` itself — a hang gives the
 * agent no tools AND no diagnosis, so that is right. But it left the client CONNECTED WITH NO TOOLS,
 * because `tools/list` then had nothing behind it. Measured over one editor session: 25 stream drops,
 * 11 dormant, 4 reconnects, 4 local handshakes — and each of those four is a state where a human has
 * to notice and reconnect by hand.
 *
 * Every `tools/list` response the daemon has ever sent passes through this proxy, so the catalog is
 * already in hand. Serving it back is the difference between "Reticle is here but useless" and
 * "Reticle is here, and the first call will tell you what is wrong".
 *
 * In-memory and per-process on purpose: a catalog persisted from a different Reticle version would be
 * its own confidently-wrong answer, and a proxy that has never seen one has nothing honest to serve —
 * so it says nothing rather than inventing a list the agent would then call into.
 */

const LIST_METHOD = 'tools/list';

interface JsonRpcLike {
  id?: unknown;
  method?: unknown;
  result?: { tools?: unknown };
}

function parse(line: string): JsonRpcLike | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null ? value : null;
  } catch {
    return null;
  }
}

export class ToolCatalogCache {
  #tools: unknown[] | undefined;

  /** Watch a line coming BACK from the daemon; remember it if it is a tool catalog. */
  observe(line: string): void {
    const msg = parse(line);
    const tools = msg?.result?.tools;
    if (Array.isArray(tools) && tools.length > 0) this.#tools = tools;
  }

  has(): boolean {
    return this.#tools !== undefined;
  }

  /**
   * A response to `request` from the cached catalog, or null when this is not a tools/list request or
   * nothing has been cached. The response carries the CALLER'S id — a JSON-RPC reply under any other
   * id is not an answer, it is noise the client will never match.
   */
  answer(request: string): string | null {
    if (this.#tools === undefined) return null;
    const msg = parse(request);
    if (msg?.method !== LIST_METHOD) return null;
    if (msg.id === undefined || msg.id === null) return null;
    return JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: this.#tools } });
  }
}
