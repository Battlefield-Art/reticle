/**
 * The ordering bug that made a SvelteKit fixture look like a regression.
 *
 * Bisected against the real fixture. Start the daemon first and everything works — HELLO sent,
 * session registered. Start the DEV SERVER first, with no token yet on disk, and:
 *
 *   [ws-hello-sent] {"kind":"hello",...}
 *   [ws-close] ws://localhost:4520/reticle
 *   [warning] [reticle] bridge refused the connection: authentication failed — not retrying.
 *   daemon sessions: []
 *
 * Which is the reported signature exactly: SDK loaded, socket opened, no session. The token is read
 * ONCE when Vite resolves its config and inlined as `__RETICLE_TOKEN__`, so an empty value is frozen
 * for the life of that dev server — and the daemon, starting later, mints a token the running server
 * can never see. No amount of waiting fixes it; only restarting the dev server does.
 *
 * A warning was the first answer. This is the real one: the daemon READS-OR-CREATES this file
 * (`readOrCreatePairingToken` — "stable across restarts so a plugin-injected page keeps working
 * after the daemon bounces"), so whichever process gets there first can provision it and both agree.
 * The plugin creating it is the same secret, the same path, the same 0600 mode, and the same random
 * generation the daemon would have used.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePairingToken } from './ensure-token.js';

const withDir = (fn: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'reticle-token-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('the pairing token, whoever gets there first', () => {
  it('creates one when the daemon has not run yet', () => {
    withDir((dir) => {
      const token = ensurePairingToken(dir);
      expect(token).toBeTruthy();
      expect(readFileSync(join(dir, 'pairing-token'), 'utf8').trim()).toBe(token);
    });
  });

  it('REUSES the daemon\'s token when there is one — never replaces it', () => {
    // Overwriting would invalidate every page the daemon has already handed a token to.
    withDir((dir) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'pairing-token'), 'daemons-own-token\n');
      expect(ensurePairingToken(dir)).toBe('daemons-own-token');
    });
  });

  it('writes it 0600 — it is a secret, and the daemon writes it that way too', () => {
    withDir((dir) => {
      ensurePairingToken(dir);
      const mode = statSync(join(dir, 'pairing-token')).mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  it('returns undefined rather than throwing when the directory cannot be written', () => {
    // A dev server must still start. Degrading to the old behaviour is correct; crashing is not.
    expect(ensurePairingToken('/proc/nonexistent-reticle-dir')).toBeUndefined();
  });

  it('treats a whitespace-only file as absent and replaces it', () => {
    withDir((dir) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'pairing-token'), '   \n');
      expect(ensurePairingToken(dir)).toBeTruthy();
    });
  });
});
