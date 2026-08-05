// One command to run the benchmark suite (the regression gate's data-collection half).
//
//   node bench/harness/bench-all.mjs            # deterministic REPLAY pass (fast, pure Reticle) — default
//   node bench/harness/bench-all.mjs --full      # + OBSERVATION-COST pass (scripted; slow, boots tool MCPs)
//   node bench/harness/bench-all.mjs --no-boot    # don't start fixtures (use ones you already have up)
//
// The three measurement passes (see bench/SCORECARD.md legend):
//   - OBSERVATION-COST ("Layer A"): drive each tool's MCP directly, measure the tokens it injects per look.
//   - AGENT-LOOP       ("Layer B"): a real LLM drives the tool — costs money + needs a key, NEVER run here.
//   - REPLAY           ("Layer C"): re-run a saved flow with no model — Reticle's deterministic floor.
//
// By default this boots the fixtures the passes drive (the demo app + the api backend), health-checks
// them, runs the EXISTING harness scripts, and tears the fixtures down on exit. Each script writes its
// own bench/raw/*.json; gate.mjs reads those. (Raw JSON keys keep the A/B/C codes for data continuity.)
import { execFileSync, spawn } from 'node:child_process';
import { connect } from 'node:net';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import * as PORTS from './ports.mjs';

const FULL = process.argv.includes('--full');
const NO_BOOT = process.argv.includes('--no-boot');
// Ports live in one module — see the note there on why disagreeing about them silently
// invalidated the benchmark twice.
const { RETICLE_PORT, API_PORT, DEMO_PORT, BENCH_URL } = PORTS;
const FIXTURE_READY_MS = Number(process.env.BENCH_FIXTURE_READY_MS ?? '30000');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deterministic, offline, pure-Reticle detection scripts — always run (the gate's hard floor).
const REPLAY_PASS = [
  'bench/harness/replay-bench.mjs', // re-run cost: tokens per regression-run
  'bench/harness/replay-detect.mjs', // selector-removal detection (3/3)
  'bench/harness/replay-detect-consequence.mjs', // green-but-wrong detection (2/2)
  'bench/harness/replay-detect-state.mjs', // store-truth oracle catches a dead handler (state predicate)
  'bench/harness/network-cardinality-bench.mjs', // net.count:1 oracle catches a double-submit (presence passes)
  'bench/harness/forbidden-call-bench.mjs', // net.count:0 oracle catches a must-never-fire call
  'bench/harness/console-clean-bench.mjs', // clean-console oracle catches a silent console.error on an action
  'bench/harness/state-blast-radius-bench.mjs', // state invariant catches an action's unintended store side-effect
  'bench/harness/suite-rre.mjs', // suite-scale re-run cost: reticle_flow_verify read-cost ~constant in K (compounding)
  'bench/harness/replay-determinism.mjs', // flake rate: verdict-deterministic across N replays (0% by construction)
];
// Scripted observation cost + detection accuracy. Slow (~12 min) and boots Playwright/DevTools MCPs.
const OBSERVATION_PASS = ['bench/harness/run-observation.mjs', 'bench/harness/analyze.mjs'];

// The bridge requires the auto-provisioned pairing token (a rogue localhost app can't read the file, so
// it can't drive sessions). bench-app has no build plugin to inject it, so we present it manually: read
// the same per-user secret the daemon reads-or-creates (~/.reticle/pairing-token, RETICLE_PAIRING_TOKEN_DIR
// override), creating it here if absent so bench-app's vite has it at startup. The daemon reads the file
// we wrote rather than overwriting it, so both agree on the token.
function readOrCreatePairingToken() {
  const dir = process.env.RETICLE_PAIRING_TOKEN_DIR || join(homedir(), '.reticle');
  const path = join(dir, 'pairing-token');
  try {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing.length > 0) return existing;
  } catch {
    /* missing — create below */
  }
  const token = randomBytes(24).toString('hex');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

/** Fixtures booted by this process, torn down on exit. */
const fixtures = [];

/** Spawn a fixture server; track it so teardown() can stop it. stdio ignored to keep bench output clean. */
function spawnFixture(label, command, args, env) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: 'ignore' });
  child.on('error', (error) => console.error(`fixture ${label} failed to spawn: ${error.message}`));
  fixtures.push(child);
  return child;
}

/** Poll a URL until it responds (any non-5xx) or the deadline passes. */
async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

/** Stop every fixture this process started (idempotent; safe to call from a signal handler). */
function teardownFixtures() {
  while (fixtures.length > 0) {
    const child = fixtures.pop();
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

/** Boot the demo app + api backend the passes drive, and wait for both to answer. */
async function bootFixtures() {
  console.log(
    `bench-all: booting fixtures — api:${API_PORT}, demo:${DEMO_PORT} (pass --no-boot to skip)`,
  );
  spawnFixture('api', 'node', ['apps/api/server.mjs'], { API_PORT });
  // The benchmark fixture is @reticlehq/bench-app (login + dashboard: compose/deployments/diagnostics)
  // — the app these flows drive. Its embedded SDK dials RETICLE_PORT, which must match the daemon each
  // script spawns.
  const pairingToken = readOrCreatePairingToken();
  spawnFixture(
    'bench-app',
    'pnpm',
    ['--filter', '@reticlehq/bench-app', 'exec', 'vite', '--port', DEMO_PORT, '--strictPort'],
    { RETICLE_PORT, VITE_RETICLE_TOKEN: pairingToken },
  );
  const [apiUp, demoUp] = await Promise.all([
    waitForHttp(`http://localhost:${API_PORT}/api/health`, FIXTURE_READY_MS),
    waitForHttp(`http://localhost:${DEMO_PORT}/`, FIXTURE_READY_MS),
  ]);
  if (!apiUp || !demoUp) {
    teardownFixtures();
    console.error(
      `\n✗ fixtures did not come up within ${FIXTURE_READY_MS}ms (api:${apiUp}, demo:${demoUp}). ` +
        `Raise BENCH_FIXTURE_READY_MS on a slow machine, or start them yourself and pass --no-boot.`,
    );
    process.exit(1);
  }
  console.log('✓ fixtures ready');
}

/** Free any reticle daemon left on the bench port so the next script starts from a clean session. */
function cleanupDaemon() {
  try {
    execFileSync(
      'node',
      ['packages/server/dist/cli.js', 'stop', '--port', RETICLE_PORT, '--quiet'],
      {
        stdio: 'ignore',
      },
    );
  } catch {
    /* none running — fine */
  }
}

/** Resolve once nothing is listening on `port`, so the next pass can actually bind it. */
async function waitForPortFree(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const busy = await new Promise((resolve) => {
      const socket = connect({ port: Number(port), host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (!busy) return true;
    if (Date.now() >= deadline) return false;
    await sleep(200);
  }
}

/**
 * A pass writes `bench/raw/<its own basename>.json`. There are two ways it can exit 0 while having
 * proved nothing, and both used to read as a green ✓:
 *
 *   1. Every flow errored, so the summary is a row of nulls — the run still printed
 *      `detection 0/3 … ~null tok … => nullx` and then `process.exit(0)`.
 *   2. It died before writing, leaving the PREVIOUS run's file behind. gate.mjs then compares
 *      stale numbers against history and reports no regression.
 *
 * Both are the exact failure this project exists to catch, in the harness that measures it. So the
 * exit code is not the verdict — the artifact is. Verify the pass wrote a file DURING this run, and
 * that it measured at least one row.
 */
function verifyPassArtifact(scriptPath, startedAtMs) {
  const raw = join('bench', 'raw', `${basename(scriptPath, '.mjs')}.json`);
  let stat;
  try {
    stat = statSync(raw);
  } catch {
    return `wrote no ${raw}`;
  }
  // 1s of slack: some filesystems store mtime at whole-second granularity.
  if (stat.mtimeMs < startedAtMs - 1000) return `left ${raw} stale — this run never wrote it`;
  let data;
  try {
    data = JSON.parse(readFileSync(raw, 'utf8'));
  } catch {
    return `wrote ${raw} but it is not valid JSON`;
  }
  if (!Array.isArray(data.rows)) return null; // pass reports no per-row detail; exit code is all we have
  const measured = data.rows.filter((row) => row !== null && row.error === undefined);
  if (measured.length > 0) return null;
  const firstError = data.rows.find((row) => row?.error !== undefined)?.error;
  return data.rows.length === 0
    ? `measured NOTHING — ${raw} has no rows`
    : `measured NOTHING — all ${data.rows.length} row(s) errored, first: ${String(firstError).slice(0, 160)}`;
}

function runScript(path) {
  console.log(`\n▶ ${path}`);
  const started = Date.now();
  try {
    execFileSync('node', [path], {
      stdio: 'inherit',
      // A pass spawns its OWN daemon, which has to land on the port the fixture app dials. bench-all
      // set that port only on the fixture, so the passes inherited nothing, fell back to a DIFFERENT
      // default, and no browser session ever connected — every flow failed while the pass still
      // reported ✓. Hand both down explicitly rather than hoping the defaults agree.
      env: { ...process.env, RETICLE_PORT, BENCH_URL },
    });
  } catch (error) {
    console.error(`\n✗ ${path} FAILED (${error instanceof Error ? error.message : String(error)})`);
    return false;
  }
  const problem = verifyPassArtifact(path, started);
  if (problem !== null) {
    console.error(`\n✗ ${path} exited 0 but ${problem}`);
    return false;
  }
  console.log(`✓ ${path} (${Math.round((Date.now() - started) / 1000)}s)`);
  return true;
}

// Tear fixtures down however we exit (normal, error, Ctrl-C) so an interrupted run never orphans them.
process.on('SIGINT', () => {
  teardownFixtures();
  process.exit(130);
});
process.on('SIGTERM', () => {
  teardownFixtures();
  process.exit(143);
});
process.on('exit', teardownFixtures);

const scripts = [...(FULL ? OBSERVATION_PASS : []), ...REPLAY_PASS];
console.log(
  `bench-all: ${FULL ? 'observation-cost + replay passes' : 'replay pass only (pass --full for observation-cost)'}`,
);

if (!NO_BOOT) await bootFixtures();

for (const path of scripts) {
  cleanupDaemon();
  // Not a sleep. `stop` returns before the listener has necessarily released the socket, and the next
  // pass spawns its own daemon on the same port — so a fixed 1s wait is a bet on the machine, and it
  // loses under load: the daemon fails to bind, the MCP child exits 1, and the pass dies with
  // "mcp process exited code=1", which reads as a product failure rather than a harness race.
  if (!(await waitForPortFree(RETICLE_PORT))) {
    teardownFixtures();
    console.error(
      `\n✗ daemon port ${RETICLE_PORT} never freed — the next pass could not have bound it.`,
    );
    process.exit(1);
  }
  if (!runScript(path)) {
    cleanupDaemon();
    teardownFixtures();
    console.error('\nbench-all aborted — a pass failed. Fix it before gating.');
    process.exit(1);
  }
}
cleanupDaemon();
// Manifest of what ran THIS pass, so the gate only checks freshly-measured passes (a stale observation
// analysis.json from a prior run must not be gated on a replay-only pass). Keys keep the A/C codes for
// continuity with gate.mjs and the raw data files.
writeFileSync(
  'bench/raw/bench-run.json',
  JSON.stringify({ ranLayerA: FULL, ranLayerC: true, at: new Date().toISOString() }, null, 2),
);
console.log(
  '\nbench-all complete. Run `node bench/harness/gate.mjs` to compare vs the last baseline.',
);
process.exit(0);
