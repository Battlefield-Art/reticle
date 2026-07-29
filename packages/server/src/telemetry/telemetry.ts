/**
 * Anonymous adoption telemetry — the OSS runtime's ONLY phone-home for product metrics (DAU/WAU/MAU,
 * invocations, sessions, installs, uninstalls). It answers the "npm downloads don't count, show me
 * platform usage" question without collecting anything personal:
 *
 *   - identity is a random UUID minted locally at `~/.reticle/telemetry-id` (never derived from you),
 *   - the project is a one-way HASH of the cwd (counts DISTINCT projects, reveals none),
 *   - it is strictly opt-OUT: `RETICLE_TELEMETRY=0` or the `DO_NOT_TRACK` convention disables it,
 *   - it is best-effort and non-blocking: a send failure NEVER changes what the tool does.
 *
 * The wire shape is `@reticlehq/core`'s `TelemetryEventSchema` (one contract, validated on both ends).
 * Everything here is wrapped so a telemetry bug can never surface to a user — a broken metric must not
 * break a verification.
 */
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { TelemetryEventKind, TELEMETRY_EVENT_VERSION, type TelemetryEvent } from '@reticlehq/core';

const RETICLE_DIR = join(homedir(), '.reticle');
const ID_FILE = join(RETICLE_DIR, 'telemetry-id');
const NOTICE_FILE = join(RETICLE_DIR, 'telemetry-notice-shown');
const TELEMETRY_PATH = '/v1/telemetry';
/** ponytail: point at the production cloud host at publish; overridable per-env for local testing. */
const DEFAULT_URL = 'http://localhost:8890';
const SEND_TIMEOUT_MS = 2000;

/** Env var names — mirror cloud-sync's `RETICLE_*` convention. */
const Env = {
  DISABLE: 'RETICLE_TELEMETRY', // "0" / "false" / "off" → disabled
  DO_NOT_TRACK: 'DO_NOT_TRACK', // the cross-tool opt-out convention (any truthy value)
  URL: 'RETICLE_TELEMETRY_URL', // override the ingest host
  CI: 'CI', // presence marks a CI environment
} as const;

const isDisabled = (env: NodeJS.ProcessEnv): boolean => {
  const off = new Set(['0', 'false', 'off', 'no']);
  if (off.has((env[Env.DISABLE] ?? '').toLowerCase())) return true;
  const dnt = env[Env.DO_NOT_TRACK];
  return typeof dnt === 'string' && dnt !== '' && dnt !== '0';
};

/** Read (or mint-and-persist) the anonymous machine id. `firstRun` is true the run that created it. */
const resolveIdentity = (): { anonymousId: string; firstRun: boolean } => {
  try {
    if (existsSync(ID_FILE)) {
      const id = readFileSync(ID_FILE, 'utf8').trim();
      if (id.length > 0) return { anonymousId: id, firstRun: false };
    }
    const id = randomUUID();
    mkdirSync(RETICLE_DIR, { recursive: true });
    writeFileSync(ID_FILE, id, 'utf8');
    return { anonymousId: id, firstRun: true };
  } catch {
    // Can't persist (read-only home, sandbox): still report, just as a fresh ephemeral id each time.
    return { anonymousId: randomUUID(), firstRun: false };
  }
};

/** One-way project fingerprint: distinct-count of this = "projects Reticle is used in", reveals nothing. */
const projectFingerprint = (cwd: string): string =>
  createHash('sha256').update(cwd).digest('hex').slice(0, 32);

/** Print the opt-out notice exactly once per machine (honest disclosure, the OSS-trust bar). */
const showNoticeOnce = (): void => {
  try {
    if (existsSync(NOTICE_FILE)) return;
    mkdirSync(RETICLE_DIR, { recursive: true });
    writeFileSync(NOTICE_FILE, '1', 'utf8');
    process.stderr.write(
      'reticle: collecting anonymous usage metrics (no code, no PII). ' +
        'Opt out any time with RETICLE_TELEMETRY=0.\n',
    );
  } catch {
    /* notice is a courtesy; never fail on it */
  }
};

export interface Telemetry {
  /** Fire one event, non-blocking. Returns the in-flight promise so a short-lived CLI can await it. */
  emit(kind: TelemetryEventKind, extra?: { sessionMs?: number }): Promise<void>;
  readonly enabled: boolean;
  /** True the very first run on this machine — the CLI emits INSTALL alongside the first INVOKE. */
  readonly firstRun: boolean;
}

const NOOP: Telemetry = { emit: async () => {}, enabled: false, firstRun: false };

/**
 * Build the telemetry emitter for this process. Resolves identity + opt-out ONCE; each `emit` builds a
 * fully-validated event and fires a best-effort POST. `version` is the running reticle version (for the
 * `version` dimension); `now`/`fetchImpl` are injected so this is testable without a clock or network.
 */
export const createTelemetry = (opts: {
  version: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
}): Telemetry => {
  const env = opts.env ?? process.env;
  if (isDisabled(env)) return NOOP;

  const now = opts.now ?? (() => Date.now());
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${(env[Env.URL] ?? DEFAULT_URL).replace(/\/+$/, '')}${TELEMETRY_PATH}`;
  const ci = env[Env.CI] !== undefined && env[Env.CI] !== '';
  const os = platform();
  const { anonymousId, firstRun } = resolveIdentity();
  const projectId = projectFingerprint(opts.cwd ?? process.cwd());
  showNoticeOnce();

  const emit = async (kind: TelemetryEventKind, extra?: { sessionMs?: number }): Promise<void> => {
    const event: TelemetryEvent = {
      v: TELEMETRY_EVENT_VERSION,
      anonymousId,
      projectId,
      event: kind,
      ts: now(),
      version: opts.version,
      ci,
      os,
      ...(extra?.sessionMs !== undefined ? { sessionMs: extra.sessionMs } : {}),
    };
    try {
      await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: [event] }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      /* best-effort: a lost metric must never surface to the user */
    }
  };

  return { emit, enabled: true, firstRun };
};

export { TelemetryEventKind };
