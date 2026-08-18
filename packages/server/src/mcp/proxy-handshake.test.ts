/**
 * `reticle mcp` never answered `initialize`, and said nothing about why.
 *
 * Reported from the field on a SvelteKit app: the MCP client gave up after 60 seconds and NO tools
 * ran at all. Reproduced here — the cause is not the app, it is the daemon port:
 *
 *   a process that accepts connections but never serves the SSE endpoint
 *     -> initialize: TIMED OUT in 25004ms, stderr: (none)
 *
 * That is a wedged daemon, a foreign process on the port, or — the case already reported separately
 * — a daemon leaked by ANOTHER project. The proxy queues every client message until the daemon's
 * endpoint frame arrives, and `initialize` is a client message, so the whole handshake waits on a
 * thing that is never coming.
 *
 * A hang is worse than an error: the agent has no tools, no diagnosis, and nothing to retry. The
 * handshake must complete on its own, after which the FIRST TOOL CALL reports the real problem
 * through the no-session diagnostics that already exist and are good.
 *
 * Answering locally is safe because the proxy already replays the client's `initialize` to the
 * daemon whenever a session is established (see replayLines) — the daemon still gets its handshake.
 */

import { describe, expect, it } from 'vitest';
import { localInitializeResponse } from './proxy-handshake.js';

interface InitResult {
  id?: unknown;
  result?: {
    protocolVersion?: unknown;
    capabilities?: { tools?: unknown };
    serverInfo?: { name?: unknown };
    instructions?: unknown;
  };
}
function answer(line: string, instructions?: string): InitResult {
  const parsed: unknown = JSON.parse(
    (instructions === undefined
      ? localInitializeResponse(line)
      : localInitializeResponse(line, instructions)) ?? '{}',
  );
  return parsed as InitResult;
}

describe('answering initialize without a daemon', () => {
  it('mirrors the id the client asked with', () => {
    expect(answer('{"jsonrpc":"2.0","id":7,"method":"initialize"}').id).toBe(7);
  });

  it('declares tool capability, so the client will actually call tools', () => {
    const parsed = answer('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    expect(parsed.result?.capabilities?.tools).toBeDefined();
    expect(parsed.result?.serverInfo?.name).toBeTruthy();
  });

  it('echoes the protocol version the client proposed', () => {
    // Answering with a version the client did not offer is its own handshake failure.
    const parsed = answer(
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}',
    );
    expect(parsed.result?.protocolVersion).toBe('2024-11-05');
  });

  it('is null for anything that is not an initialize request', () => {
    expect(localInitializeResponse('{"jsonrpc":"2.0","id":2,"method":"tools/list"}')).toBeNull();
    expect(localInitializeResponse('not json')).toBeNull();
    // A notification has no id, so there is nothing to answer.
    expect(localInitializeResponse('{"jsonrpc":"2.0","method":"initialize"}')).toBeNull();
  });
});

/**
 * The handshake the proxy answers itself carried no `instructions` at all.
 *
 * A client reads `instructions` ONCE, at initialize. The proxy answers locally precisely when no
 * daemon is up yet — which is the first run, which is the population that has tools registered and
 * an app that is not instrumented. So the one block that tells them "having these tools is not the
 * same as being set up" was permanently absent for exactly them, and the daemon's later, correct
 * instructions arrive at a client that will never look again.
 */
describe('the locally-answered handshake carries the guidance', () => {
  const INIT = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

  it('passes the instructions through to the client', () => {
    expect(answer(INIT, 'DO THE THING FIRST').result?.instructions).toBe('DO THE THING FIRST');
  });

  it('omits the field rather than sending an empty one when there is nothing to say', () => {
    expect(answer(INIT, '').result?.instructions).toBeUndefined();
  });
});
