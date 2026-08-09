/**
 * What `GET /status` answers — the daemon describing itself.
 *
 * Carries the daemon's OWN version, because a daemon outlives every agent attached to it: after an
 * upgrade the new CLI attaches to the old daemon and serves its code, and until this field existed
 * there was no surface anywhere — not /status, not `reticle status` — naming the version actually
 * answering requests. See describeDaemonSkew.
 */
import type { SessionInfo } from './session/session-info.js';
import { CONTRACT_FINGERPRINT } from '@reticlehq/core';
import { SERVER_VERSION } from './version/server-version.js';

interface StatusPayload {
  running: true;
  version: string;
  /** The wire contract this daemon speaks — what another process compares against, not the version. */
  contract: string;
  sessionCount: number;
  sessions: SessionInfo[];
}

export function statusPayload(sessionCount: number, sessions: SessionInfo[]): StatusPayload {
  return {
    running: true,
    version: SERVER_VERSION,
    contract: CONTRACT_FINGERPRINT,
    sessionCount,
    sessions,
  };
}
