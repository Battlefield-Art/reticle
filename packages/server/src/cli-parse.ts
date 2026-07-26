/**
 * Pure CLI argument parsing — the command/flag grammar, the CliResult union, and parseCliArgs.
 * Split out of cli.ts (which keeps the side-effecting handlers + dispatch) to stay under the
 * file-size cap and keep the parser pure + unit-testable. Re-exported from cli.ts so existing
 * imports are unchanged.
 */

export const CLI_USAGE = `usage:
  reticle init  [--yes] [--dry-run] [--port N] [--no-mcp] [--no-install]  (wire Reticle into the project in this directory)
  reticle serve [--port N] [--drive <url>] [--headed] [--http] [--http-port N] [--http-token T]
  reticle stop  [--port N] [--quiet]
  reticle status [--port N]
  reticle open  [url] [--port N]                        (show the app: reuse the connected tab, else open one)
  reticle verify <url> [--headed] [--timeout N] [--storage-state <file>]  (one-shot: drive the URL, verify saved flows, exit 0=pass)
  reticle affected [--since <ref>] [file...]           (which saved flows must re-verify for the changed files)
  reticle gate [--since <ref>] [file...]               (exit non-zero unless passing artifacts cover the affected flows)
  reticle watch [url]                                  (on save, report which saved flows must re-verify)
  reticle drive <url> [--headed]                       (foreground mode — for debugging)
  reticle mcp   [--port N] [--drive <url>] [--headed]  (MCP stdio proxy — auto-starts daemon if needed)
  reticle update                                       (install the latest server version and restart)
  reticle rollback                                     (restore the previous server version and restart)
  reticle license                                      (show enterprise license status: active | eval | missing)`;

const INIT_COMMAND = 'init';
const SERVE_COMMAND = 'serve';
const STOP_COMMAND = 'stop';
const STATUS_COMMAND = 'status';
const OPEN_COMMAND = 'open';
const DRIVE_COMMAND = 'drive';
const VERIFY_COMMAND = 'verify';
const AFFECTED_COMMAND = 'affected';
const CAPSULES_COMMAND = 'capsules';
const GATE_COMMAND = 'gate';
const WATCH_COMMAND = 'watch';
const UPDATE_COMMAND = 'update';
const ROLLBACK_COMMAND = 'rollback';
const MCP_COMMAND = 'mcp';
const LICENSE_COMMAND = 'license';
const VERSION_COMMAND = 'version';
export const DAEMON_INNER_COMMAND = '_daemon';

export const HEADED_FLAG = '--headed';
export const PORT_FLAG = '--port';
export const DRIVE_FLAG = '--drive';
const QUIET_FLAG = '--quiet';
const DRY_RUN_FLAG = '--dry-run';
const YES_FLAG = '--yes';
const NO_MCP_FLAG = '--no-mcp';
const NO_INSTALL_FLAG = '--no-install';
export const HTTP_FLAG = '--http';
export const HTTP_PORT_FLAG = '--http-port';
export const HTTP_TOKEN_FLAG = '--http-token';
const TIMEOUT_FLAG = '--timeout';
const STORAGE_STATE_FLAG = '--storage-state';

export type CliResult =
  | { kind: 'init'; port: number | undefined; mcp: boolean; dryRun: boolean; install: boolean }
  | {
      kind: 'serve';
      port: number;
      driveUrl?: string;
      headless: boolean;
      http: boolean;
      httpPort?: number;
      httpToken?: string;
    }
  | { kind: 'stop'; port: number; quiet: boolean }
  | { kind: 'status'; port: number }
  | { kind: 'license' }
  | { kind: 'version' }
  | { kind: 'open'; port: number; url?: string }
  | {
      kind: '_daemon';
      port: number;
      driveUrl?: string;
      headless: boolean;
      http: boolean;
      httpPort?: number;
      httpToken?: string;
    }
  | { kind: 'drive'; port: number; driveUrl: string; headless: boolean }
  | { kind: 'verify'; url: string; headless: boolean; timeoutMs?: number; storageState?: string }
  | { kind: 'affected'; files: string[]; since?: string }
  | { kind: 'capsules' }
  | { kind: 'gate'; files: string[]; since?: string }
  | { kind: 'watch'; url?: string }
  | { kind: 'update' }
  | { kind: 'rollback' }
  | { kind: 'mcp'; port: number; driveUrl?: string; headless: boolean }
  | { kind: 'error'; message: string };

type ServeFlags =
  | {
      kind: 'ok';
      port: number;
      driveUrl?: string;
      headless: boolean;
      http: boolean;
      httpPort?: number;
      httpToken?: string;
    }
  | { kind: 'error'; message: string };

function parseServeFlags(args: string[], defaultPort: number): ServeFlags {
  let port = defaultPort;
  let driveUrl: string | undefined;
  let headless = true;
  let http = false;
  let httpPort: number | undefined;
  let httpToken: string | undefined;
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === PORT_FLAG) {
      i++;
      const n = args[i];
      if (n === undefined) return { kind: 'error', message: CLI_USAGE };
      const parsed = parseInt(n, 10);
      if (isNaN(parsed)) return { kind: 'error', message: CLI_USAGE };
      port = parsed;
    } else if (arg === DRIVE_FLAG) {
      i++;
      driveUrl = args[i];
      if (driveUrl === undefined) return { kind: 'error', message: CLI_USAGE };
    } else if (arg === HEADED_FLAG) {
      headless = false;
    } else if (arg === HTTP_FLAG) {
      http = true;
    } else if (arg === HTTP_PORT_FLAG) {
      i++;
      const n = args[i];
      if (n === undefined) return { kind: 'error', message: CLI_USAGE };
      const parsed = parseInt(n, 10);
      if (isNaN(parsed)) return { kind: 'error', message: CLI_USAGE };
      httpPort = parsed;
    } else if (arg === HTTP_TOKEN_FLAG) {
      i++;
      httpToken = args[i];
      if (httpToken === undefined) return { kind: 'error', message: CLI_USAGE };
    } else {
      return { kind: 'error', message: CLI_USAGE };
    }
    i++;
  }
  return {
    kind: 'ok',
    port,
    headless,
    http,
    ...(driveUrl !== undefined ? { driveUrl } : {}),
    ...(httpPort !== undefined ? { httpPort } : {}),
    ...(httpToken !== undefined ? { httpToken } : {}),
  };
}

function parsePortFlag(args: string[], defaultPort: number): number {
  const idx = args.indexOf(PORT_FLAG);
  if (idx === -1) return defaultPort;
  const n = args[idx + 1];
  if (n === undefined) return defaultPort;
  const parsed = parseInt(n, 10);
  return isNaN(parsed) ? defaultPort : parsed;
}

type DriveSuffix =
  | { kind: 'ok'; port: number; driveUrl: string; headless: boolean }
  | { kind: 'error'; message: string };

function parseDriveSuffix(args: string[], port: number): DriveSuffix {
  let headless = true;
  let driveUrl: string | undefined;
  for (const arg of args) {
    if (arg === HEADED_FLAG) {
      headless = false;
    } else if (arg.startsWith('--')) {
      return { kind: 'error', message: CLI_USAGE };
    } else if (driveUrl === undefined) {
      driveUrl = arg;
    } else {
      return { kind: 'error', message: CLI_USAGE };
    }
  }
  if (driveUrl === undefined) return { kind: 'error', message: CLI_USAGE };
  return { kind: 'ok', port, driveUrl, headless };
}

type VerifySuffix =
  | { kind: 'ok'; url: string; headless: boolean; timeoutMs?: number; storageState?: string }
  | { kind: 'error'; message: string };

/**
 * Parse `verify <url> [--headed] [--timeout N] [--storage-state <file>]`. The first non-flag token is
 * the preview URL.
 */
function parseVerifySuffix(args: string[]): VerifySuffix {
  let headless = true;
  let url: string | undefined;
  let timeoutMs: number | undefined;
  let storageState: string | undefined;
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === HEADED_FLAG) {
      headless = false;
    } else if (arg === TIMEOUT_FLAG) {
      i++;
      const n = args[i];
      if (n === undefined) return { kind: 'error', message: CLI_USAGE };
      const parsed = parseInt(n, 10);
      if (isNaN(parsed)) return { kind: 'error', message: CLI_USAGE };
      timeoutMs = parsed;
    } else if (arg === STORAGE_STATE_FLAG) {
      i++;
      const v = args[i];
      if (v === undefined) return { kind: 'error', message: CLI_USAGE };
      storageState = v;
    } else if (arg.startsWith('--')) {
      return { kind: 'error', message: CLI_USAGE };
    } else if (url === undefined) {
      url = arg;
    } else {
      return { kind: 'error', message: CLI_USAGE };
    }
    i++;
  }
  if (url === undefined) return { kind: 'error', message: CLI_USAGE };
  return {
    kind: 'ok',
    url,
    headless,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(storageState !== undefined ? { storageState } : {}),
  };
}

type InitFlags =
  | { kind: 'ok'; port: number | undefined; mcp: boolean; dryRun: boolean; install: boolean }
  | { kind: 'error'; message: string };

function parseInitFlags(args: string[]): InitFlags {
  let port: number | undefined;
  let mcp = true;
  let dryRun = false;
  let install = true;
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === PORT_FLAG) {
      i++;
      const n = args[i];
      if (n === undefined) return { kind: 'error', message: CLI_USAGE };
      const parsed = parseInt(n, 10);
      if (isNaN(parsed)) return { kind: 'error', message: CLI_USAGE };
      port = parsed;
    } else if (arg === NO_MCP_FLAG) {
      mcp = false;
    } else if (arg === NO_INSTALL_FLAG) {
      install = false;
    } else if (arg === DRY_RUN_FLAG) {
      dryRun = true;
    } else if (arg === YES_FLAG) {
      // Accepted for scripting/CI; init has no interactive prompts today.
    } else {
      return { kind: 'error', message: CLI_USAGE };
    }
    i++;
  }
  return { kind: 'ok', port, mcp, dryRun, install };
}

/** Pure CLI arg parser — exported for unit tests. argv = process.argv.slice(2). */
const SINCE_FLAG = '--since';

/** Parse `[--since <ref>] [file...]` shared by `affected` and `gate`. */
function parseTargetArgs(rest: string[]): { files: string[]; since?: string } {
  const files: string[] = [];
  let since: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === SINCE_FLAG) {
      since = rest[i + 1];
      i += 1;
      continue;
    }
    if (arg !== undefined && !arg.startsWith('-')) files.push(arg);
  }
  return since === undefined ? { files } : { files, since };
}

export function parseCliArgs(argv: string[], defaultPort: number): CliResult {
  if (argv.length === 0) return { kind: 'serve', port: defaultPort, headless: true, http: false };

  const [cmd, ...rest] = argv;

  // `version` (or the conventional -v/--version flags) prints the running version — the diagnostic the
  // troubleshooting docs lean on to confirm which npx-resolved build is actually executing.
  if (cmd === VERSION_COMMAND || cmd === '--version' || cmd === '-v') return { kind: 'version' };

  switch (cmd) {
    case INIT_COMMAND: {
      const r = parseInitFlags(rest);
      if (r.kind === 'error') return r;
      return { kind: 'init', port: r.port, mcp: r.mcp, dryRun: r.dryRun, install: r.install };
    }
    case SERVE_COMMAND: {
      const r = parseServeFlags(rest, defaultPort);
      if (r.kind === 'error') return r;
      return {
        kind: 'serve',
        port: r.port,
        headless: r.headless,
        http: r.http,
        ...(r.driveUrl !== undefined ? { driveUrl: r.driveUrl } : {}),
        ...(r.httpPort !== undefined ? { httpPort: r.httpPort } : {}),
        ...(r.httpToken !== undefined ? { httpToken: r.httpToken } : {}),
      };
    }
    case STOP_COMMAND: {
      const port = parsePortFlag(rest, defaultPort);
      const quiet = rest.includes(QUIET_FLAG);
      return { kind: 'stop', port, quiet };
    }
    case STATUS_COMMAND: {
      const port = parsePortFlag(rest, defaultPort);
      return { kind: 'status', port };
    }
    case LICENSE_COMMAND:
      return { kind: 'license' };
    case OPEN_COMMAND: {
      const port = parsePortFlag(rest, defaultPort);
      // The first non-flag arg is the url (optional — omitting reuses a connected tab).
      const url = rest.find((a) => !a.startsWith('--') && a !== String(port));
      return url !== undefined ? { kind: 'open', port, url } : { kind: 'open', port };
    }
    case DRIVE_COMMAND: {
      const r = parseDriveSuffix(rest, defaultPort);
      if (r.kind === 'error') return r;
      return { kind: 'drive', port: r.port, driveUrl: r.driveUrl, headless: r.headless };
    }
    case DAEMON_INNER_COMMAND: {
      const r = parseServeFlags(rest, defaultPort);
      if (r.kind === 'error') return r;
      return {
        kind: '_daemon',
        port: r.port,
        headless: r.headless,
        http: r.http,
        ...(r.driveUrl !== undefined ? { driveUrl: r.driveUrl } : {}),
        ...(r.httpPort !== undefined ? { httpPort: r.httpPort } : {}),
        ...(r.httpToken !== undefined ? { httpToken: r.httpToken } : {}),
      };
    }
    case VERIFY_COMMAND: {
      const r = parseVerifySuffix(rest);
      if (r.kind === 'error') return r;
      return {
        kind: 'verify',
        url: r.url,
        headless: r.headless,
        ...(r.timeoutMs !== undefined ? { timeoutMs: r.timeoutMs } : {}),
        ...(r.storageState !== undefined ? { storageState: r.storageState } : {}),
      };
    }
    case CAPSULES_COMMAND:
      return { kind: 'capsules' };
    case AFFECTED_COMMAND: {
      const t = parseTargetArgs(rest);
      if (t.files.length === 0 && t.since === undefined) {
        return { kind: 'error', message: 'usage: reticle affected [--since <ref>] [file...]' };
      }
      return {
        kind: 'affected',
        files: t.files,
        ...(t.since === undefined ? {} : { since: t.since }),
      };
    }
    case GATE_COMMAND: {
      const t = parseTargetArgs(rest);
      if (t.files.length === 0 && t.since === undefined) {
        return { kind: 'error', message: 'usage: reticle gate [--since <ref>] [file...]' };
      }
      return { kind: 'gate', files: t.files, ...(t.since === undefined ? {} : { since: t.since }) };
    }
    case WATCH_COMMAND: {
      // `reticle watch [url]` — on file save, report which saved flows must re-verify.
      const url = rest.find((arg) => !arg.startsWith('-'));
      return url === undefined ? { kind: 'watch' } : { kind: 'watch', url };
    }
    case UPDATE_COMMAND:
      return { kind: 'update' };
    case ROLLBACK_COMMAND:
      return { kind: 'rollback' };
    case MCP_COMMAND: {
      const r = parseServeFlags(rest, defaultPort);
      if (r.kind === 'error') return r;
      return {
        kind: 'mcp',
        port: r.port,
        headless: r.headless,
        ...(r.driveUrl !== undefined ? { driveUrl: r.driveUrl } : {}),
      };
    }
    default:
      return { kind: 'error', message: CLI_USAGE };
  }
}
