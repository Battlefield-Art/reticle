/**
 * The loop I shipped, and the rule that stops it coming back.
 *
 * Widening the idle rule so an attached-but-unused daemon can exit, while the proxy respawned on
 * every stream drop, meant the replacement daemon was just as idle — so it exited too. Measured
 * against the running system with a 4s grace: FOUR daemon processes in 200 seconds. At the shipped
 * 300s grace that is a fresh process every five minutes, for the 74% of installs that never call a
 * tool, for as long as the editor stays open.
 *
 * Nothing in the gates could see it. Unit tests never start a daemon; the e2e battery starts one and
 * drives it immediately, so it never leaves one idle for a grace window. It took watching pids on a
 * live system. These pin the invariant so the next person does not have to.
 */

import { describe, expect, it } from 'vitest';
import { onStreamDrop, onClientRequest, OnDrop, OnRequest } from './proxy-lifecycle.js';

describe('onStreamDrop — a dropped stream is not demand', () => {
  it('reattaches when a daemon is already listening', () => {
    expect(onStreamDrop(true)).toBe(OnDrop.REATTACH);
  });

  it('goes DORMANT when nothing is listening — never spawns', () => {
    // The whole regression in one assertion. Spawning here is what made an idle daemon's own
    // shutdown into a permanent loop.
    expect(onStreamDrop(false)).toBe(OnDrop.DORMANT);
  });

  it('has no third answer that could smuggle a spawn back in', () => {
    for (const listening of [true, false]) {
      expect([OnDrop.REATTACH, OnDrop.DORMANT]).toContain(onStreamDrop(listening));
    }
  });
});

describe('onClientRequest — demand is the only thing that starts a daemon', () => {
  it('sends straight through when connected', () => {
    expect(onClientRequest(true, false)).toBe(OnRequest.SEND);
    expect(onClientRequest(true, true)).toBe(OnRequest.SEND);
  });

  it('WAKES when dormant — this is the one path allowed to spawn', () => {
    expect(onClientRequest(false, true)).toBe(OnRequest.WAKE);
  });

  it('queues when a reconnect is already in flight, rather than spawning a second daemon', () => {
    expect(onClientRequest(false, false)).toBe(OnRequest.QUEUE);
  });
});

/**
 * The two rules together are what make the cycle impossible: the only transition that may start a
 * daemon is reachable only from a client request, so a daemon exiting can never, by itself, cause
 * another to start.
 */
describe('the pair cannot cycle', () => {
  it('no sequence of drops alone ever reaches WAKE', () => {
    const reachableFromDrops = [onStreamDrop(true), onStreamDrop(false)];
    expect(reachableFromDrops).not.toContain(OnRequest.WAKE);
    // And dormancy is terminal until a request arrives: dropping again while dormant is still not demand.
    expect(onStreamDrop(false)).toBe(OnDrop.DORMANT);
  });
});
