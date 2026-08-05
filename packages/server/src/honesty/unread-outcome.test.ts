import { describe, expect, it } from 'vitest';
import { EventType, type ReticleEvent } from '@reticlehq/core';
import { hasUnreadWriteOutcome } from './unread-outcome.js';

const call = (data: Record<string, unknown>): ReticleEvent =>
  ({
    type: EventType.NET_REQUEST,
    t: 10,
    data: { url: '/api/x', ...data },
  }) as unknown as ReticleEvent;

describe('a write whose outcome went unread', () => {
  it('reports a 2xx write with a payload that exists and was not recorded', () => {
    expect(hasUnreadWriteOutcome([call({ method: 'POST', status: 200, responseSize: 412 })])).toBe(
      true,
    );
  });

  it('stays silent once the body IS recorded — findBodyFailures judges it instead', () => {
    expect(
      hasUnreadWriteOutcome([
        call({ method: 'POST', status: 200, responseSize: 412, responseBody: '{"ok":true}' }),
      ]),
    ).toBe(false);
  });

  it('stays silent for a GET — the DOM already witnesses what a read returned', () => {
    expect(hasUnreadWriteOutcome([call({ method: 'GET', status: 200, responseSize: 9000 })])).toBe(
      false,
    );
  });

  it('stays silent for a genuinely empty response', () => {
    expect(hasUnreadWriteOutcome([call({ method: 'POST', status: 204, responseSize: 0 })])).toBe(
      false,
    );
  });

  it('stays silent when the size is unknown — "empty" and "unseen" must not be guessed apart', () => {
    expect(hasUnreadWriteOutcome([call({ method: 'POST', status: 200 })])).toBe(false);
  });

  it('stays silent for a failed write — the status already says so', () => {
    expect(hasUnreadWriteOutcome([call({ method: 'POST', status: 500, responseSize: 120 })])).toBe(
      false,
    );
  });
});

describe('IPC is not HTTP', () => {
  // Measured: forwarding `responseSize` for IPC made a healthy `todos:add` on a default Electron
  // config return `unknown`. Every ordinary desktop action would have carried that caveat — the
  // cry-wolf failure that teaches agents to ignore the field.
  it('stays silent for an IPC call whose payload went unread', () => {
    expect(hasUnreadWriteOutcome([call({ method: 'ipc', status: 200, responseSize: 129 })])).toBe(
      false,
    );
  });

  it('still reports an HTTP write in the same window', () => {
    expect(
      hasUnreadWriteOutcome([
        call({ method: 'ipc', status: 200, responseSize: 129 }),
        call({ method: 'POST', status: 200, responseSize: 412 }),
      ]),
    ).toBe(true);
  });
});
