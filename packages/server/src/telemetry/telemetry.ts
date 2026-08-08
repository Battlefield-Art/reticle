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
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import {
  TelemetryEventKind,
  TELEMETRY_EVENT_VERSION,
  ProjectIdSource,
  type Crash,
  type Feedback,
  type Identity,
  type BugFound,
  isSessionScoped,
  type InitOutcome,
  type McpConnection,
  type ProjectProfile,
  type SessionSummary,
  type TelemetryActor,
  type TelemetryEvent,
  type Verification,
  type VersionChange,
} from '@reticlehq/core';
import { SERVER_VERSION } from '../server-version.js';

const RETICLE_DIR = join(homedir(), '.reticle');
const ID_FILE = join(RETICLE_DIR, 'telemetry-id');
const NOTICE_FILE = join(RETICLE_DIR, 'telemetry-notice-shown');
/** Presence of this file = a persistent, machine-wide opt-out (`reticle telemetry disable`). */
const OPT_OUT_FILE = join(RETICLE_DIR, 'telemetry-opt-out');
/** Where the full disclosure lives — printed in the first-run notice and `reticle telemetry status`. */
const POLICY_URL = 'https://github.com/reticlehq/reticle/blob/main/docs/telemetry.md';
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
import { isReticleSourceCheckout } from './dev-repo.js';
import { gitFacts } from './git-facts.js';

const Env = {
  DISABLE: 'RETICLE_TELEMETRY', // "0" / "false" / "off" → disabled
  DO_NOT_TRACK: 'DO_NOT_TRACK', // the cross-tool opt-out convention (any truthy value)
  URL: 'RETICLE_TELEMETRY_URL', // override the PostHog host (EU cloud / self-hosted)
  KEY: 'RETICLE_TELEMETRY_KEY', // override the PostHog project key
  CI: 'CI', // presence marks a CI environment
  VITEST: 'VITEST', // set by vitest — unit tests must never phone home
} as const;

const isDisabled = (env: NodeJS.ProcessEnv, cwd: string = process.cwd()): boolean => {
  const off = new Set(['0', 'false', 'off', 'no']);
  if (off.has((env[Env.DISABLE] ?? '').toLowerCase())) return true;
  if (env[Env.VITEST] !== undefined) return true; // a test run is not a user
  // Developing Reticle is not using Reticle. The `.env` carrying RETICLE_TELEMETRY=0 is gitignored,
  // so it only exists on the machine that made it — a fresh clone would phone home on a
  // contributor's first `reticle serve`. The repo marker is committed, so this guarantee travels.
  if (isReticleSourceCheckout(cwd)) return true;
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

/**
 * One-way project fingerprint: distinct-count of this = "projects Reticle is used in", reveals nothing.
 *
 * Prefers a hash of the git ORIGIN over a hash of the cwd. The contract in `@reticlehq/core` always
 * said "one-way hash of the git remote (or cwd)", but the implementation only ever hashed the path —
 * which meant the same repo cloned by four teammates, or checked out twice on one machine, counted as
 * four separate projects. That inflates the project count and, worse, makes team adoption look like
 * unrelated individuals. Hashing the origin dedupes a real project down to one id across every clone.
 *
 * Still one-way, still non-reversible, and still exactly what the published policy describes: the
 * remote URL itself never leaves the machine, only its SHA-256. The URL is normalized first (scheme,
 * credentials, `.git` suffix and case removed) so `git@github.com:acme/web.git` and
 * `https://github.com/Acme/web` are recognized as the same project rather than two.
 */
const projectFingerprint = (cwd: string): { projectId: string; source: ProjectIdSource } => {
  const { origin } = gitFacts(cwd);
  return {
    projectId: createHash('sha256')
      .update(origin ?? cwd)
      .digest('hex')
      .slice(0, 32),
    // Reported alongside so the analytics knows whether this id is comparable to another machine's.
    source: origin !== undefined ? ProjectIdSource.GIT_ORIGIN : ProjectIdSource.CWD,
  };
};

/** Print the opt-out notice exactly once per machine (honest disclosure, the OSS-trust bar). */
const showNoticeOnce = (): void => {
  try {
    if (existsSync(NOTICE_FILE)) return;
    mkdirSync(RETICLE_DIR, { recursive: true });
    writeFileSync(NOTICE_FILE, '1', 'utf8');
    process.stderr.write(
      'reticle: anonymous usage telemetry helps improve reticle — no code, no PII, ' +
        `and your app's data never leaves your machine (${POLICY_URL}). ` +
        'Opt out any time: reticle telemetry disable\n',
    );
  } catch {
    /* notice is a courtesy; never fail on it */
  }
};

/** The current telemetry state and which control set it — what `reticle telemetry status` prints. */
export const describeTelemetry = (
  env: NodeJS.ProcessEnv = process.env,
  dir: string = RETICLE_DIR,
  cwd: string = process.cwd(),
): { enabled: boolean; reason: string; policyUrl: string } => {
  // Report the reason that ACTUALLY applies. Saying "environment variable" when the real cause is
  // the source-checkout guard would send a contributor hunting for a variable that is not set.
  if (isReticleSourceCheckout(cwd)) {
    return {
      enabled: false,
      reason: 'this is a Reticle source checkout — developing it is not using it',
      policyUrl: POLICY_URL,
    };
  }
  if (isDisabled(env, cwd)) {
    return { enabled: false, reason: 'disabled by environment variable', policyUrl: POLICY_URL };
  }
  if (existsSync(join(dir, 'telemetry-opt-out'))) {
    return {
      enabled: false,
      reason: 'disabled via `reticle telemetry disable`',
      policyUrl: POLICY_URL,
    };
  }
  return {
    enabled: true,
    reason: 'anonymous usage metrics only — no code, no PII',
    policyUrl: POLICY_URL,
  };
};

/** Persist (or lift) the machine-wide opt-out — `reticle telemetry disable` / `enable`. */
export const setTelemetryEnabled = (enabled: boolean, dir: string = RETICLE_DIR): void => {
  const optOutFile = join(dir, 'telemetry-opt-out');
  if (enabled) {
    rmSync(optOutFile, { force: true });
    return;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(optOutFile, '1', 'utf8');
};

/**
 * The per-event extras — one optional block per event kind, so a payload can only ever be attached
 * to the event it belongs to. `feedback` is the only one carrying author-written text, and it only
 * ever arrives from `submitFeedback`, which redacts and validates it first. Nothing else may set it.
 */
export interface TelemetryExtra {
  detach?: boolean;
  actor?: TelemetryActor;
  /** `cli_command_run`: which subcommand a human ran. */
  command?: string;
  /** `cli_command_run`: flag NAMES present on the invocation. Never values. */
  flags?: string[];
  /** `daemon_stopped`: the whole session rolled up. Replaces the old per-tool-call event. */
  session?: SessionSummary;
  /** `project_profiled`: the project's shape and depth-of-use. */
  project?: ProjectProfile;
  /** `verification_completed`: one verdict. */
  verification?: Verification;
  /** `version_changed`: update or rollback. */
  versionChange?: VersionChange;
  /** `runtime_crashed`: a fingerprinted crash. */
  crash?: Crash;
  feedback?: Feedback;
  /** `identified`: a self-declared identity. Opt-in, typed by a human, never inferred. */
  identity?: Identity;
  /** `mcp_client_connected`: a client attached, and whether it had attached before. */
  connection?: McpConnection;
  /** `init_completed`: how `reticle init` went. */
  init?: InitOutcome;
  /** `bug_found`: one defect Reticle found in the app under test. */
  bug?: BugFound;
}

export interface Telemetry {
  /**
   * Fire one event, non-blocking. `detach: true` hands the send to a disowned child so a short-lived
   * CLI process can exit immediately instead of waiting out the POST (use it from command entry
   * points; daemon-side events send in-process).
   */
  /**
   * Send one event. Resolves to whether it was DELIVERED.
   *
   * Almost every caller ignores the result and should — a lost metric must never surface to a user.
   * `reticle_feedback` is the exception: it hands a receipt to an agent, and reporting "filed" for a
   * send that failed loses the report and lies about it in the same breath.
   */
  emit(kind: TelemetryEventKind, extra?: TelemetryExtra): Promise<boolean>;
  readonly enabled: boolean;
  /** True the very first run on this machine — the CLI emits INSTALL alongside the first INVOKE. */
  readonly firstRun: boolean;
}

// A disabled emitter delivers nothing, and says so — `false` is the honest answer, not a courtesy.
const NOOP: Telemetry = { emit: () => Promise.resolve(false), enabled: false, firstRun: false };

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
  const cwd = opts.cwd ?? process.cwd();
  if (isDisabled(env, cwd)) return NOOP;
  try {
    if (existsSync(OPT_OUT_FILE)) return NOOP; // the persistent `reticle telemetry disable` opt-out
  } catch {
    /* unreadable home dir — fall through; the env-var opt-outs above still apply */
  }
  const apiKey = env[Env.KEY] ?? POSTHOG_KEY;
  if (apiKey === '') return NOOP; // no key baked in (dev/test build) — nowhere to send, stay silent

  const now = opts.now ?? (() => Date.now());
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${(env[Env.URL] ?? DEFAULT_URL).replace(/\/+$/, '')}${TELEMETRY_PATH}`;
  const ci = env[Env.CI] !== undefined && env[Env.CI] !== '';
  const os = platform();
  // Negated so it reads the way people say it: UTC+2 is +120, not -120.
  const tzOffsetMin = -new Date().getTimezoneOffset();
  const { anonymousId, firstRun } = resolveIdentity();
  /**
   * One id per PROCESS, minted in memory and never persisted — which is exactly right: a daemon run
   * IS the session, and a restarted daemon is genuinely a new one. Ephemeral by construction, so it
   * adds no durable identifier to the machine.
   */
  const sessionId = randomUUID();
  const { projectId, source: projectIdSource } = projectFingerprint(opts.cwd ?? process.cwd());
  showNoticeOnce();

  const spawnDetached =
    opts.spawnImpl ??
    ((command: string, args: string[]): void => {
      spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
    });

  /**
   * Returns whether the event was actually DELIVERED.
   *
   * Every caller but one ignores this and should: a lost metric must never surface to a user. The
   * exception is `reticle_feedback`, which hands a receipt back to an agent — `sent: true` there was
   * unconditional, so a DNS miss or a 4xx both read as "filed", and the only qualitative channel the
   * product has could fail silently while telling the reporter it had worked.
   *
   * A detached send reports false: it is handed to a disowned child precisely so the caller does not
   * wait, so its outcome is genuinely unknown and claiming success would be the same lie.
   */
  const emit = async (kind: TelemetryEventKind, extra?: TelemetryExtra): Promise<boolean> => {
    const event: TelemetryEvent = {
      v: TELEMETRY_EVENT_VERSION,
      anonymousId,
      sessionId,
      projectId,
      event: kind,
      ts: now(),
      version: opts.version,
      ci,
      os,
      tzOffsetMin,
      projectIdSource,
      ...(extra?.actor !== undefined ? { actor: extra.actor } : {}),
      ...(extra?.command !== undefined ? { command: extra.command } : {}),
      ...(extra?.flags !== undefined ? { flags: extra.flags } : {}),
      ...(extra?.session !== undefined ? { session: extra.session } : {}),
      ...(extra?.project !== undefined ? { project: extra.project } : {}),
      ...(extra?.verification !== undefined ? { verification: extra.verification } : {}),
      ...(extra?.versionChange !== undefined ? { versionChange: extra.versionChange } : {}),
      ...(extra?.crash !== undefined ? { crash: extra.crash } : {}),
      ...(extra?.feedback !== undefined ? { feedback: extra.feedback } : {}),
      ...(extra?.identity !== undefined ? { identity: extra.identity } : {}),
      ...(extra?.connection !== undefined ? { connection: extra.connection } : {}),
      ...(extra?.init !== undefined ? { init: extra.init } : {}),
      ...(extra?.bug !== undefined ? { bug: extra.bug } : {}),
    };
    // Map the core contract onto PostHog's capture shape: id/name/time move up, the rest are properties.
    // The feedback body is FLATTENED into `feedback_*` properties rather than sent as a nested object:
    // PostHog filters and breakdowns operate on top-level properties, so a nested `feedback.stack`
    // would be invisible to the exact "which stacks report the most bugs" question this exists to
    // answer. One prefix keeps them grouped in the UI without a nested path.
    const {
      anonymousId: distinctId,
      event: name,
      ts,
      sessionId: eventSessionId,
      feedback,
      session,
      project,
      verification,
      versionChange,
      crash,
      identity,
      connection,
      init,
      bug,
      ...rest
    } = event;
    // `$session_id` is PostHog's OWN session property, so sending ours under that name lights up
    // its built-in session views and funnels for free rather than requiring custom HogQL everywhere.
    // `sessionId` rides only on events that happened inside a daemon run. A one-shot CLI command
    // mints a per-process id that joins to nothing and inflates every session count — see
    // isSessionScoped for the measurement.
    const properties: Record<string, unknown> = {
      ...rest,
      ...(isSessionScoped(name)
        ? { sessionId: eventSessionId, $session_id: eventSessionId }
        : {}),
    };
    // Each block is flattened under its own prefix rather than nested. PostHog filters, breakdowns and
    // insight builders all operate on TOP-LEVEL properties, so a nested `project.stack` is invisible to
    // the exact "which stacks retain best" question these exist to answer — you would have to drop to
    // raw HogQL for every chart. One prefix per block keeps them grouped in the property list without
    // paying that cost. The two genuine maps (`toolCounts`, `errorKinds`) stay objects: their keys are
    // open-ended, so flattening them would mint an unbounded number of property names, which is the one
    // thing that actually degrades a PostHog project.
    const blocks: Record<string, Record<string, unknown> | undefined> = {
      feedback,
      session,
      project,
      verification,
      version: versionChange,
      crash,
      identity,
      connection,
      init,
      bug,
    };
    for (const [prefix, block] of Object.entries(blocks)) {
      for (const [key, value] of Object.entries(block ?? {})) {
        properties[`${prefix}_${key}`] = value;
      }
    }
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
        return false; // handed off, outcome unknowable from here
      }
      const response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      // A 4xx is a rejected payload, not a delivery. It must not read as filed.
      return response.ok !== false;
    } catch {
      /* best-effort: a lost metric must never surface to the user */
      return false;
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
