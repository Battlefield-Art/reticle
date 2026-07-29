/**
 * Anonymous adoption telemetry — the OSS runtime's ONLY phone-home for product metrics (DAU/WAU/MAU,
 * invocations, sessions, installs, tool usage). It answers the "npm downloads don't count, show me
 * platform usage" question without collecting anything personal:
 *
 *   - identity is a random UUID minted locally at `~/.reticle/telemetry-id` (never derived from you),
 *   - the project is a one-way HASH of the cwd (counts DISTINCT projects, reveals none),
 *   - it is strictly opt-OUT: `RETICLE_TELEMETRY=0` or the `DO_NOT_TRACK` convention disables it,
 *   - it is best-effort and non-blocking: a send failure NEVER changes what the tool does.
 *
 * Events are `@reticlehq/core`'s `TelemetryEventSchema`, mapped at the wire into PostHog's capture
 * format (https://posthog.com/docs/api/capture) — PostHog is the analytics backend until Reticle Cloud
 * grows its own; a project API key is WRITE-ONLY by design, so embedding it in an OSS client is safe.
 * Everything here is wrapped so a telemetry bug can never surface to a user — a broken metric must not
 * break a verification.
 */
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { TelemetryEventKind, TELEMETRY_EVENT_VERSION, type TelemetryEvent } from '@reticlehq/core';
import { SERVER_VERSION } from '../server-version.js';

const RETICLE_DIR = join(homedir(), '.reticle');
const ID_FILE = join(RETICLE_DIR, 'telemetry-id');
const NOTICE_FILE = join(RETICLE_DIR, 'telemetry-notice-shown');
/** PostHog batch-capture endpoint (US cloud). `RETICLE_TELEMETRY_URL` overrides the host (EU/self-host). */
const DEFAULT_URL = 'https://us.i.posthog.com';
const TELEMETRY_PATH = '/batch/';
/**
 * The write-only PostHog project key (safe to embed: it can only WRITE events, never read anything —
 * PostHog's own docs ship it in client-side JS). `RETICLE_TELEMETRY_KEY` overrides it; empty disables.
 */
const POSTHOG_KEY = 'phc_q4yCxKMXHfWQ43VAz4HxJXZFLqFi4nBbg5v3avemggYo';
/**
 * Skip PostHog person-profile processing: our users are anonymous by construction (never $identify'd),
 * so profiles buy nothing — and personless events are up to 4x cheaper while unique counts/retention
 * still key on distinct_id.
 */
const POSTHOG_PERSONLESS = { $process_person_profile: false } as const;
const SEND_TIMEOUT_MS = 2000;

/**
 * The sender a `detach: true` emit runs in a disowned child (argv: [url, body]) — an in-process fetch
 * keeps Node's event loop alive until the POST finishes, which taxed every short-lived CLI command
 * (`reticle version`/`gate`) ~800ms. Long-lived daemon events still send in-process: a spawn per tool
 * call would be far heavier than a fetch inside an already-running server.
 */
const DETACHED_SEND_SCRIPT =
  "fetch(process.argv[1],{method:'POST',headers:{'content-type':'application/json'}," +
  `body:process.argv[2],signal:AbortSignal.timeout(${SEND_TIMEOUT_MS})})` +
  '.catch(()=>{}).finally(()=>process.exit(0))';

/** Env var names — mirror cloud-sync's `RETICLE_*` convention. */
const Env = {
  DISABLE: 'RETICLE_TELEMETRY', // "0" / "false" / "off" → disabled
  DO_NOT_TRACK: 'DO_NOT_TRACK', // the cross-tool opt-out convention (any truthy value)
  URL: 'RETICLE_TELEMETRY_URL', // override the PostHog host (EU cloud / self-hosted)
  KEY: 'RETICLE_TELEMETRY_KEY', // override the PostHog project key
  CI: 'CI', // presence marks a CI environment
  VITEST: 'VITEST', // set by vitest — unit tests must never phone home
} as const;

const isDisabled = (env: NodeJS.ProcessEnv): boolean => {
  const off = new Set(['0', 'false', 'off', 'no']);
  if (off.has((env[Env.DISABLE] ?? '').toLowerCase())) return true;
  if (env[Env.VITEST] !== undefined) return true; // a test run is not a user
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
  /**
   * Fire one event, non-blocking. `detach: true` hands the send to a disowned child so a short-lived
   * CLI process can exit immediately instead of waiting out the POST (use it from command entry
   * points; daemon-side events send in-process).
   */
  emit(
    kind: TelemetryEventKind,
    extra?: { sessionMs?: number; tool?: string; detach?: boolean },
  ): Promise<void>;
  readonly enabled: boolean;
  /** True the very first run on this machine — the CLI emits INSTALL alongside the first INVOKE. */
  readonly firstRun: boolean;
}

const NOOP: Telemetry = { emit: async () => {}, enabled: false, firstRun: false };

/**
 * Build the telemetry emitter for this process. Resolves identity + opt-out ONCE; each `emit` builds a
 * fully-validated core event, maps it into PostHog capture shape, and fires a best-effort POST.
 * `version` is the running reticle version (for the `version` dimension); `now`/`fetchImpl` are
 * injected so this is testable without a clock or network.
 */
export const createTelemetry = (opts: {
  version: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
  spawnImpl?: (command: string, args: string[]) => void;
}): Telemetry => {
  const env = opts.env ?? process.env;
  if (isDisabled(env)) return NOOP;
  const apiKey = env[Env.KEY] ?? POSTHOG_KEY;
  if (apiKey === '') return NOOP; // no key baked in (dev/test build) — nowhere to send, stay silent

  const now = opts.now ?? (() => Date.now());
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${(env[Env.URL] ?? DEFAULT_URL).replace(/\/+$/, '')}${TELEMETRY_PATH}`;
  const ci = env[Env.CI] !== undefined && env[Env.CI] !== '';
  const os = platform();
  const { anonymousId, firstRun } = resolveIdentity();
  const projectId = projectFingerprint(opts.cwd ?? process.cwd());
  showNoticeOnce();

  const spawnDetached =
    opts.spawnImpl ??
    ((command: string, args: string[]): void => {
      spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
    });

  const emit = async (
    kind: TelemetryEventKind,
    extra?: { sessionMs?: number; tool?: string; detach?: boolean },
  ): Promise<void> => {
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
      ...(extra?.tool !== undefined ? { tool: extra.tool } : {}),
    };
    // Map the core contract onto PostHog's capture shape: id/name/time move up, the rest are properties.
    const { anonymousId: distinctId, event: name, ts, ...properties } = event;
    const body = JSON.stringify({
      api_key: apiKey,
      batch: [
        {
          event: name,
          distinct_id: distinctId,
          timestamp: new Date(ts).toISOString(),
          properties: { ...properties, ...POSTHOG_PERSONLESS },
        },
      ],
    });
    try {
      if (extra?.detach === true && opts.fetchImpl === undefined) {
        spawnDetached(process.execPath, ['-e', DETACHED_SEND_SCRIPT, url, body]);
        return;
      }
      await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      /* best-effort: a lost metric must never surface to the user */
    }
  };

  return { emit, enabled: true, firstRun };
};

/**
 * The process-wide emitter. One identity resolution + one opt-out check per process; both the CLI
 * lifecycle (install/invoke/session) and the per-tool hook in `runTool` share it.
 */
let singleton: Telemetry | undefined;
export const getTelemetry = (): Telemetry =>
  (singleton ??= createTelemetry({ version: SERVER_VERSION }));

export { TelemetryEventKind };
