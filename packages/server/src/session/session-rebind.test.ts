import { describe, it, expect, vi } from 'vitest';
import type { WebSocket } from 'ws';
import {
  MessageKind,
  ReticleCommand,
  RETICLE_PROTOCOL_VERSION,
  type HelloMessage,
} from '@reticlehq/core';
import { Session } from './session.js';

/**
 * A page that re-dials under the same session id used to kill every tool call holding the old
 * transport.
 *
 * Reported five times by three users on two clients, always the same shape: `reticle_navigate`
 * succeeds, the page reloads and sends a fresh HELLO carrying the id it already had, the bridge
 * disconnects the displaced session, and the `reticle_snapshot` that was already on the wire dies
 * with "session replaced by a newer connection claiming the same id". The replacement itself is
 * correct — the page really did re-dial — but the caller is handed an error whose only answer is to
 * call `reticle_sessions` and retry, to learn an id the daemon is already holding and which has not
 * even changed.
 */

const HELLO: HelloMessage = {
  kind: MessageKind.HELLO,
  protocolVersion: RETICLE_PROTOCOL_VERSION,
  sessionId: 'demo',
  url: 'http://localhost/',
  title: 'Demo',
  adapters: [],
  hasCapabilities: false,
};

const REPLACED = 'session replaced by a newer connection claiming the same id (demo)';

interface Wired {
  session: Session;
  /** Reply to the command the session most recently put on the wire. */
  reply: (result: unknown) => void;
  sent: string[];
}

function wire(): Wired {
  const sent: string[] = [];
  const socket = {
    send: (payload: string): void => {
      sent.push(payload);
    },
    close: (): void => {},
  } as unknown as WebSocket;
  const session = new Session(HELLO, socket, () => 0);
  return {
    session,
    sent,
    reply: (result: unknown): void => {
      const last = sent[sent.length - 1];
      if (last === undefined) throw new Error('nothing was sent');
      const { id } = JSON.parse(last) as { id: string };
      session.handleResult({ kind: MessageKind.COMMAND_RESULT, id, ok: true, result });
    },
  };
}

describe('a session replaced under the same id rebinds instead of erroring', () => {
  it('finishes an in-flight read against the connection that replaced it', async () => {
    const old = wire();
    const fresh = wire();
    const pending = old.session.command(ReticleCommand.SNAPSHOT);
    old.session.succeededBy(fresh.session);
    old.session.disconnect(REPLACED);
    // The rebind rides the rejected command's promise chain, so it lands a few microtasks later.
    await vi.waitFor(() => expect(fresh.sent).toHaveLength(1));
    fresh.reply({ tree: 'after reload' });
    await expect(pending).resolves.toMatchObject({ result: { tree: 'after reload' } });
  });

  it('sends a later command straight to the successor', async () => {
    const old = wire();
    const fresh = wire();
    old.session.succeededBy(fresh.session);
    old.session.disconnect(REPLACED);
    const pending = old.session.command(ReticleCommand.QUERY);
    expect(old.sent).toHaveLength(0);
    expect(fresh.sent).toHaveLength(1);
    fresh.reply({ elements: [] });
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  /**
   * The safety boundary. A read can be re-issued because re-reading a page costs nothing and answers
   * the same question. An act cannot: it may already have been dispatched in the page that went
   * away, and silently performing it a second time is a double submit nobody asked for. The honest
   * answer there is still the error — the caller's own retry, with the same id, is the safe path.
   */
  it('does not re-issue an act that was already on the wire', async () => {
    const old = wire();
    const fresh = wire();
    const pending = old.session.command(ReticleCommand.ACT, { ref: 'e1' });
    old.session.succeededBy(fresh.session);
    old.session.disconnect(REPLACED);
    await expect(pending).rejects.toThrow(/replaced by a newer connection/);
    expect(fresh.sent).toHaveLength(0);
  });

  it('still rejects an in-flight read when nothing replaced the session', async () => {
    const old = wire();
    const pending = old.session.command(ReticleCommand.SNAPSHOT);
    old.session.disconnect('session disconnected');
    await expect(pending).rejects.toThrow(/session disconnected/);
  });
});
