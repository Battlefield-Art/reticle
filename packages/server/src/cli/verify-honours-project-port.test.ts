/**
 * `reticle verify` has to use the port the project configured, not the default.
 *
 * `cli.ts` resolves `defaultPort` from `RETICLE_PORT` -> `.reticle.json` -> 4400 and hands it to
 * `parseCliArgs`. Every other command that needs it carries `port` on its parsed result. The
 * `verify` branch of `CliResult` did not declare one, so `handleVerify` received
 * `parsed.port === undefined` on every run and fell back to `RETICLE_DEFAULT_PORT`.
 *
 * Environment still worked, by accident: `openLiveConnection` re-reads `RETICLE_PORT` itself. A
 * project that sets its port in `.reticle.json` — the documented way — never connected, and the
 * failure surfaced as `MSG_NO_SESSION`, which reads as "your app is not running" rather than
 * "I looked at the wrong port".
 *
 * The docstring on `handleVerify`'s `port` said the opposite of what the code did: "parseCliArgs
 * already resolves --port / RETICLE_PORT / .reticle.json into this."
 *
 * No existing test could see it, because they all run on the default port, where a dropped port
 * and a correct one are the same number.
 */

import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './cli-parse.js';

const PROJECT_PORT = 4711;
const parse = (argv: readonly string[], defaultPort = PROJECT_PORT) =>
  parseCliArgs([...argv], defaultPort, false);

describe('reticle verify carries the resolved bridge port', () => {
  it('takes the port the project resolved, not the built-in default', () => {
    const r = parse(['verify', 'http://localhost:3000/']);
    expect(r.kind).toBe('verify');
    expect('verify' === r.kind ? r.port : undefined).toBe(PROJECT_PORT);
  });

  /**
   * `--port` is deliberately NOT accepted here: it has never been a documented flag for `verify`
   * (`docs/cli/verify.mdx` lists `--headed`, `--timeout`, `--storage-state`), and adding one is a
   * feature rather than this fix. `RETICLE_PORT` and `.reticle.json` are the supported routes, and
   * both now arrive. Pinned so the refusal stays deliberate instead of becoming an oversight.
   */
  it('still refuses --port, which this command has never taken', () => {
    expect(parse(['verify', 'http://localhost:3000/', '--port', '4999']).kind).toBe('error');
  });

  /** The rest of the branch must keep working — this adds a field, it does not reshape the command. */
  it('still parses the url and flags it already understood', () => {
    // `--timeout` is milliseconds, as documented in docs/cli/verify.mdx, not seconds.
    const r = parse(['verify', 'http://localhost:3000/app', '--headed', '--timeout', '90000']);
    if (r.kind !== 'verify') throw new Error('expected a verify result');
    expect(r.url).toBe('http://localhost:3000/app');
    expect(r.headless).toBe(false);
    expect(r.timeoutMs).toBe(90_000);
  });
});
