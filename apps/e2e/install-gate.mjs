// Tier 1: install Reticle into an app that has never seen it, and check a session actually appears.
//
// Every gate in this repo is blind to this. `apps/bench-app`, `apps/next-smoke` and the rest are
// already instrumented, so re-running `init` over one reports `·` (already wired) for every step and
// proves nothing — which is exactly how a Next.js install shipped connecting 0% of the time through
// three independent defects, none of which any check short of opening a browser could see.
//
// The pristine surface is SCAFFOLDED rather than vendored. `npm create vite` produces an app that has
// never seen Reticle, in seconds, with nothing to store or maintain. That catches install
// REGRESSIONS. It does not catch install COMPLEXITY — a 70-dependency app with ten Vite plugins is a
// different question, and it belongs in the reticle-fixtures gate (Tier 2), which is slower and
// cannot block a PR. Conflating the two produces a gate too slow to block and too shallow to trust.
//
//   node apps/e2e/install-gate.mjs [--keep]
//
// `--keep` leaves the temp app on disk for inspection.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  freePortSafely,
  startOwnedDaemon,
  watchTransport,
  attributeOutcome,
  Attribution,
  sweepBatteryOrphans,
} from './gate-harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'packages/server/dist/cli.js');
/** A private bridge port, so this never fights the battery or a developer's own daemon. */
const BRIDGE_PORT = Number(process.env.INSTALL_GATE_PORT ?? '4788');
const APP_PORT = Number(process.env.INSTALL_GATE_APP_PORT ?? '4789');
/** How long the app gets to boot, then to register a session. Generous: a cold Vite start is seconds. */
const BOOT_TIMEOUT_MS = 120_000;
const CONNECT_TIMEOUT_MS = 45_000;
const KEEP = process.argv.includes('--keep');

/**
 * The SDK packages the app must resolve to THIS checkout, not to npm.
 *
 * Wired by `file:` alias rather than by installing tarballs. That is the fixtures repo's rule and it
 * was learned expensively: repeated `npm install --no-save @reticlehq/*.tgz` pruned MUI's transitive
 * dependencies out of one app and pulled a PUBLISHED @reticlehq/core alongside a local plugin in
 * another. Both then failed in ways that looked like Reticle bugs and were not.
 */
const LOCAL_PACKAGES = {
  '@reticlehq/core': 'packages/core',
  '@reticlehq/browser': 'packages/browser',
  '@reticlehq/react': 'packages/react',
  '@reticlehq/vite-plugin': 'packages/vite-plugin',
};

let pass = 0;
let fail = 0;
const chk = (label, ok, detail = '') => {
  console.log(`   ${ok ? '✅' : '❌'} ${label}${detail ? '  — ' + detail : ''}`);
  ok ? (pass += 1) : (fail += 1);
};
const note = (line) => console.log(`   · ${line}`);

const run = (cmd, args, cwd, extraEnv = {}) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
    timeout: 300_000,
  });

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function sessionsOn(port) {
  try {
    const res = await fetch(`http://localhost:${String(port)}/status`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body?.sessions) ? body.sessions : [];
  } catch {
    return [];
  }
}

console.log('\n=== INSTALL GATE: a pristine app, installed into, opened, and asked to connect ===');
await sweepBatteryOrphans([], { onNote: (n) => note(n) });
await freePortSafely(BRIDGE_PORT);
await freePortSafely(APP_PORT);

const workdir = mkdtempSync(join(tmpdir(), 'reticle-install-gate-'));
const app = join(workdir, 'app');
let daemon;
let dev;

try {
  // ── 1. a surface that has never seen Reticle ────────────────────────────────────────────────
  note('scaffolding a fresh Vite + React app…');
  run('npm', ['create', 'vite@latest', 'app', '--yes', '--', '--template', 'react-ts'], workdir);
  const pkgPath = join(app, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  chk('the scaffold is a real app', typeof pkg.name === 'string' && pkg.scripts?.dev !== undefined);
  chk(
    '  and it has never seen Reticle',
    !JSON.stringify(pkg).includes('@reticlehq'),
    'no @reticlehq in the fresh package.json',
  );

  // ── 2. point it at THIS checkout ─────────────────────────────────────────────────────────────
  pkg.dependencies = pkg.dependencies ?? {};
  pkg.devDependencies = pkg.devDependencies ?? {};
  for (const [name, rel] of Object.entries(LOCAL_PACKAGES)) {
    pkg.dependencies[name] = `file:${join(ROOT, rel)}`;
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  note('installing (local SDK by file: alias, never a tarball)…');
  run('npm', ['install', '--no-audit', '--no-fund'], app);

  // ── 3. the thing under test ──────────────────────────────────────────────────────────────────
  // `--no-mcp` for the same reason the fixtures gate uses it: registering the MCP server edits
  // global machine state (~/.cursor/mcp.json, the user's own CLAUDE.md). The gate measures the SDK
  // install, not what it does to the developer running it.
  // `--no-install` because the deps are already pinned to this checkout above; letting init install
  // would pull the PUBLISHED SDK over the local one and quietly measure the wrong code.
  let report = '';
  let initExit = 0;
  try {
    report = run(
      'node',
      [CLI, 'init', '--port', String(BRIDGE_PORT), '--no-mcp', '--no-install'],
      app,
    );
  } catch (err) {
    initExit = err.status ?? 1;
    report = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  console.log(
    report
      .split('\n')
      .map((l) => `      ${l}`)
      .join('\n'),
  );

  chk('init exits 0', initExit === 0, `exit ${String(initExit)}`);
  // The load-bearing assertion. A ⚠ is a step nothing performed, so the app never dials the bridge
  // and every tool answers "no browser session connected" — a green-looking install that cannot work.
  const manual = (report.match(/\[⚠\]/g) ?? []).length;
  chk('init leaves ZERO manual steps', manual === 0, `${String(manual)} ⚠ mark(s)`);
  chk(
    '  and it did apply something — a run of all `·` would mean it found nothing to do',
    (report.match(/\[✓\]/g) ?? []).length > 0,
    `${String((report.match(/\[✓\]/g) ?? []).length)} ✓ mark(s)`,
  );

  // ── 4. own the daemon before the app can dial it (rule 2) ────────────────────────────────────
  daemon = await startOwnedDaemon(BRIDGE_PORT, { cliPath: CLI, cwd: ROOT });
  const transport = watchTransport(BRIDGE_PORT);

  // ── 5. boot, and open it in a real browser ───────────────────────────────────────────────────
  dev = spawn('npm', ['run', 'dev', '--', '--port', String(APP_PORT), '--strictPort'], {
    cwd: app,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });
  const devLog = [];
  dev.stdout.on('data', (d) => devLog.push(String(d)));
  dev.stderr.on('data', (d) => devLog.push(String(d)));

  const bootDeadline = Date.now() + BOOT_TIMEOUT_MS;
  let booted = false;
  while (Date.now() < bootDeadline) {
    if (await reachable(`http://localhost:${String(APP_PORT)}/`)) {
      booted = true;
      break;
    }
    await sleep(500);
  }
  chk('the app boots', booted, booted ? `:${String(APP_PORT)}` : devLog.join('').slice(-200));

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
  await page.goto(`http://localhost:${String(APP_PORT)}/`, { waitUntil: 'domcontentloaded' });

  // POLL. Steps 6 and 7 of the connection sequence race, and a gate that samples once is outside the
  // product's own protection against it — see docs/system-map.md.
  const connectDeadline = Date.now() + CONNECT_TIMEOUT_MS;
  let sessions = [];
  while (Date.now() < connectDeadline) {
    sessions = await sessionsOn(BRIDGE_PORT);
    if (sessions.length > 0) break;
    await sleep(500);
  }

  // ── 6. attribute honestly (rule 4) ───────────────────────────────────────────────────────────
  const { aliveThroughout } = transport.stop();
  const verdict = attributeOutcome({
    connected: sessions.length > 0,
    transportAliveThroughout: aliveThroughout,
  });
  if (verdict.outcome === Attribution.INCONCLUSIVE) {
    // Not counted as a pass OR a fail. A fixture that never had a bridge was never tested, and
    // reporting that as an install failure is how a correct SvelteKit install became a bug report.
    console.log(`   ⚠️  INCONCLUSIVE — ${verdict.because}`);
    fail += 1;
  } else {
    chk(
      'a session actually appears — the only step that proves the install works',
      verdict.outcome === Attribution.PASS,
      verdict.outcome === Attribution.PASS
        ? sessions[0]?.url ?? ''
        : `${verdict.because}; console: ${consoleLines.slice(-3).join(' | ').slice(0, 200)}`,
    );
  }

  await browser.close();
} catch (err) {
  chk('the gate ran to completion', false, String(err).slice(0, 300));
} finally {
  if (dev !== undefined) {
    try {
      process.kill(-dev.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  if (daemon !== undefined) await daemon.stop();
  await freePortSafely(APP_PORT);
  if (KEEP) note(`kept: ${workdir}`);
  else rmSync(workdir, { recursive: true, force: true });
}

console.log(
  `\n${fail === 0 ? '✅ INSTALL GATE PASSED' : '❌ INSTALL GATE FAILED'} (${pass} passed, ${fail} failed)`,
);
process.exit(fail === 0 ? 0 : 1);
