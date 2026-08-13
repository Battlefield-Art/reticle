/**
 * Serve the IPv4-bound daemon on IPv6 loopback too, so `localhost` reaches it on every platform.
 *
 * The daemon binds `127.0.0.1` — deliberately, because Reticle must never be reachable off-host. But
 * `localhost` is a NAME, and on Windows Chrome resolves it to `::1` before `127.0.0.1`. The SDK's
 * default bridge URL says `localhost`. So on the platform that is most of our installs, and the
 * browser that is most of that, the documented default cannot connect — and the error text names the
 * daemon, containers and WSL, none of which is the cause.
 *
 * This is a byte forwarder rather than a second `http.Server` on purpose. The daemon speaks HTTP,
 * WebSocket upgrades and SSE on one port; copying request/upgrade wiring onto a second server means a
 * second place to keep in sync, and the first handler anybody forgets to mirror becomes a bug that
 * only Windows sees. A TCP pipe carries all three and cannot drift from what it forwards.
 *
 * Best-effort by contract: a machine with IPv6 disabled, or something already holding `[::1]:port`,
 * leaves the daemon exactly as it was before. Never fatal — this widens reachability, it is not a
 * precondition for serving.
 */

import net from 'node:net';
import { LOOPBACK_HOST } from '@reticlehq/core';

/** IPv6 loopback. The other half of what `localhost` can mean. */
export const IPV6_LOOPBACK = '::1';

export interface LoopbackAlias {
  /** False when the alias could not be bound — the daemon still serves IPv4 as before. */
  opened: boolean;
  close: () => Promise<void>;
}

/**
 * Accept on `[::1]:port` and pipe each connection to `127.0.0.1:port`.
 *
 * Both ends are loopback, so a forwarded peer is still a loopback peer and the bridge's loopback
 * trust holds — the alias does not widen who may connect, only which address they may name.
 */
export function openLoopbackAlias(port: number): Promise<LoopbackAlias> {
  const server = net.createServer((inbound) => {
    const outbound = net.connect(port, LOOPBACK_HOST);
    // A dead peer on either side must tear down the pair, not surface as an unhandled 'error'
    // event — which in Node terminates the daemon this alias exists to make reachable.
    inbound.on('error', () => outbound.destroy());
    outbound.on('error', () => inbound.destroy());
    inbound.pipe(outbound);
    outbound.pipe(inbound);
  });

  return new Promise<LoopbackAlias>((resolve) => {
    const close = (): Promise<void> =>
      new Promise<void>((done) => {
        server.close(() => done());
      });
    server.once('error', () => {
      // Nothing was bound, so there is nothing to close — but the caller still gets a close it can
      // call unconditionally, rather than a shape it has to branch on.
      resolve({ opened: false, close: () => Promise.resolve() });
    });
    server.listen(port, IPV6_LOOPBACK, () => {
      resolve({ opened: true, close });
    });
  });
}
