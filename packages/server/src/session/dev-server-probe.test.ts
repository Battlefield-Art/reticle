/**
 * The scan claimed "nothing is listening on the ports Reticle scans" at a user whose Nuxt dev server
 * was listening on one of them.
 *
 * The server was started with `--host`, so it bound `0.0.0.0` and `[::]` rather than the loopback
 * addresses. A listener on `0.0.0.0:<port>` serves `localhost:<port>` and MUST count as found — but
 * a single-name probe resolves `localhost` to whichever family the OS prefers (on Windows, `::1`),
 * and a v4-wildcard listener does not accept there. The claim was reported as a fact, which is what
 * made it expensive: an absence stated as evidence sends the reader to the wrong half of the system.
 *
 * So the probe asks BOTH families and takes either answer.
 */

import { describe, expect, it } from 'vitest';
import { PROBE_HOSTS, anyFamilyServes, probeDevServers } from './dev-server-probe.js';

describe('the probe asks both address families', () => {
  it('covers the IPv4 and IPv6 loopbacks by address, not by a name the OS resolves for us', () => {
    expect(PROBE_HOSTS).toContain('127.0.0.1');
    expect(PROBE_HOSTS).toContain('::1');
  });

  it('counts a port as up when only the IPv4 loopback answers (a `0.0.0.0` wildcard bind)', async () => {
    const seen: string[] = [];
    const up = await anyFamilyServes(3000, (_port, host) => {
      seen.push(host);
      return Promise.resolve('127.0.0.1' === host);
    });
    expect(up).toBe(true);
    expect(seen).toContain('::1');
  });

  it('counts a port as up when only the IPv6 loopback answers (a `[::]` wildcard bind)', async () => {
    const up = await anyFamilyServes(3000, (_port, host) => Promise.resolve('::1' === host));
    expect(up).toBe(true);
  });

  it('is still absent when neither family answers', async () => {
    expect(await anyFamilyServes(3000, () => Promise.resolve(false))).toBe(false);
  });

  it('never rejects when a family probe throws', async () => {
    const up = await anyFamilyServes(3000, (_port, host) =>
      '::1' === host ? Promise.reject(new Error('EAFNOSUPPORT')) : Promise.resolve(true),
    );
    expect(up).toBe(true);
  });

  it('reports the listening ports in ascending order', async () => {
    const ports = await probeDevServers([8080, 3000, 5173], (p) => Promise.resolve(p !== 5173));
    expect(ports).toEqual([3000, 8080]);
  });
});
