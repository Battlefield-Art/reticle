// Tier 1: install Reticle into apps that have never seen it, and check a session actually appears.
//
// Every gate in this repo is blind to the install. `apps/bench-app`, `apps/next-smoke` and the rest
// are ALREADY instrumented, so re-running `init` over one reports `·` (already wired) for every step
// and proves nothing — which is exactly how a Next.js install shipped connecting 0% of the time
// through three independent defects, none of which any check short of opening a browser could see.
//
// The pristine surface is SCAFFOLDED rather than vendored. `npm create vite` and `create-next-app`
// produce apps that have never seen Reticle, in seconds, with nothing to store or maintain. That
// catches install REGRESSIONS. It does not catch install COMPLEXITY — a 70-dependency app with ten
// Vite plugins is a different question, and it belongs in the reticle-fixtures gate (Tier 2), which
// is slower and cannot block a PR. Conflating the two gives a gate too slow to block and too shallow
// to trust.
//
// Three scaffolds, because `init` has three genuinely different paths into an app, and the third is
// the one that matters most: a Pages Router app has no `app/` root layout to patch, so connect has
// to mount through `pages/_app` — and that is the path that once did nothing at all, silently.
//
//   pnpm gate:install                 # all scaffolds
//   node apps/e2e/install-gate.mjs --only next-pages-router [--keep]
//   pnpm gate:install:self-test       # negative control: every scaffold must go RED
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
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
/** Private ports, so this never fights the battery or a developer's own daemon. */
const BRIDGE_PORT_BASE = Number(process.env.INSTALL_GATE_PORT ?? '4788');
const APP_PORT_BASE = Number(process.env.INSTALL_GATE_APP_PORT ?? '4820');
/** Generous: a cold Next build is slow, and a timeout here reads as an install failure. */
const BOOT_TIMEOUT_MS = 180_000;
const CONNECT_TIMEOUT_MS = 45_000;
const KEEP = process.argv.includes('--keep');
/**
 * Negative control: wire the app to a port the daemon is NOT on, so no session can appear, and
 * require the gate to FAIL.
 *
 * `check-boundaries.mjs --self-test` and `check-lossy-transforms.mjs --self-test` already run this
 * way in CI, for the reason this repo keeps rediscovering: a guard that has never failed is not a
 * guard. The session check is the one assertion that proves the install WORKS, so it is the one that
 * most needs to be shown capable of going red.
 */
const SELF_TEST = process.argv.includes('--self-test');
const ONLY = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : undefined;

/**
 * The SDK packages an app must resolve to THIS checkout, not to npm.
 *
 * Wired by `file:` alias rather than by installing tarballs. That is the fixtures repo's rule and it
 * was learned expensively: repeated `npm install --no-save @reticlehq/*.tgz` pruned MUI's transitive
 * dependencies out of one app and pulled a PUBLISHED @reticlehq/core alongside a local plugin in
 * another. Both then failed in ways that looked like Reticle bugs and were not.
 */
const SHARED_PACKAGES = {
  '@reticlehq/core': 'packages/core',
  '@reticlehq/browser': 'packages/browser',
  '@reticlehq/react': 'packages/react',
};

/**
 * One per DISTINCT init path. Not one per framework anyone can name — a scaffold that exercises a
 * path another scaffold already covers costs two minutes a run and proves nothing new.
 */
const SCAFFOLDS = [
  {
    id: 'vite-react',
    what: 'Vite + React — the vite-plugin path (config patch + injected connect)',
    create: ['npm', ['create', 'vite@latest', 'app', '--yes', '--', '--template', 'react-ts']],
    dev: (port) => ['npm', ['run', 'dev', '--', '--port', String(port), '--strictPort']],
    packages: { ...SHARED_PACKAGES, '@reticlehq/vite-plugin': 'packages/vite-plugin' },
  },
  {
    id: 'next-app-router',
    what: 'Next App Router — withReticle plus the app/ root layout',
    create: [
      'npx',
      [
        'create-next-app@latest',
        'app',
        '--ts',
        '--app',
        '--no-src-dir',
        '--no-tailwind',
        '--no-eslint',
        '--import-alias',
        '@/*',
        '--use-npm',
        '--yes',
      ],
    ],
    dev: (port) => ['npm', ['run', 'dev', '--', '-p', String(port)]],
    packages: { ...SHARED_PACKAGES, '@reticlehq/next': 'packages/next' },
  },
  {
    id: 'next-pages-router',
    // The one that matters. No `app/` directory exists, so the root layout init patches is not there
    // and connect has to mount through `pages/_app` — a different code path, and the one that
    // silently did nothing.
    what: 'Next Pages Router — no app/ at all, so connect must mount via pages/_app',
    create: [
      'npx',
      [
        'create-next-app@latest',
        'app',
        '--ts',
        '--no-app',
        '--no-src-dir',
        '--no-tailwind',
        '--no-eslint',
        '--import-alias',
        '@/*',
        '--use-npm',
        '--yes',
      ],
    ],
    dev: (port) => ['npm', ['run', 'dev', '--', '-p', String(port)]],
    packages: { ...SHARED_PACKAGES, '@reticlehq/next': 'packages/next' },
  },
];

const run = (cmd, args, cwd, extraEnv = {}) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
    timeout: 600_000,
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

/** Drive one scaffold end to end. Returns its own tally, so one bad scaffold cannot mask another. */
async function driveScaffold(scaffold, index) {
  let pass = 0;
  let fail = 0;
  const chk = (label, ok, detail = '') => {
    console.log(`   ${ok ? '✅' : '❌'} ${label}${detail ? '  — ' + detail : ''}`);
    ok ? (pass += 1) : (fail += 1);
  };
  const note = (line) => console.log(`   · ${line}`);

  // A port pair per scaffold. Sequential runs would be fine sharing one, but a scaffold that leaves
  // a dev server behind must not be able to make the NEXT scaffold look broken.
  const bridgePort = BRIDGE_PORT_BASE + index * 2;
  const appPort = APP_PORT_BASE + index * 2;

  console.log(`\n──────── ${scaffold.id} ────────`);
  note(scaffold.what);
  await freePortSafely(bridgePort);
  await freePortSafely(appPort);

  const workdir = mkdtempSync(join(tmpdir(), `reticle-install-${scaffold.id}-`));
  const app = join(workdir, 'app');
  let daemon;
  let dev;

  try {
    // ── 1. a surface that has never seen Reticle ──────────────────────────────────────────────
    note('scaffolding…');
    run(scaffold.create[0], scaffold.create[1], workdir);
    const pkgPath = join(app, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    chk(
      'the scaffold is a real app',
      typeof pkg.name === 'string' && pkg.scripts?.dev !== undefined,
    );
    chk(
      '  and it has never seen Reticle',
      !JSON.stringify(pkg).includes('@reticlehq'),
      'no @reticlehq in the fresh package.json',
    );

    // ── 2. point it at THIS checkout ───────────────────────────────────────────────────────────
    pkg.dependencies = pkg.dependencies ?? {};
    for (const [name, rel] of Object.entries(scaffold.packages)) {
      pkg.dependencies[name] = `file:${join(ROOT, rel)}`;
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    note('installing (local SDK by file: alias, never a tarball)…');
    run('npm', ['install', '--no-audit', '--no-fund'], app);

    // ── 3. the thing under test ────────────────────────────────────────────────────────────────
    // `--no-mcp` for the reason the fixtures gate uses it: registering the MCP server edits global
    // machine state (~/.cursor/mcp.json, the developer's own CLAUDE.md). The gate measures the SDK
    // install, not what it does to whoever runs it.
    // `--no-install` because the deps are already pinned to this checkout; letting init install would
    // pull the PUBLISHED SDK over the local one and quietly measure the wrong code.
    let report = '';
    let initExit = 0;
    try {
      report = run(
        'node',
        [
          CLI,
          'init',
          '--port',
          String(SELF_TEST ? bridgePort + 1 : bridgePort),
          '--no-mcp',
          '--no-install',
        ],
        app,
      );
    } catch (err) {
      initExit = err.status ?? 1;
      report = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    console.log(
      report
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => `      ${l}`)
        .join('\n'),
    );

    chk('init exits 0', initExit === 0, `exit ${String(initExit)}`);

    // The load-bearing assertion. A ⚠ is a step nothing performed, so the app never dials the bridge
    // and every tool answers "no browser session connected" — a green-looking install that cannot
    // work.
    //
    // Exactly ONE ⚠ is tolerated: `--no-install` means init does not run the package manager, so it
    // correctly reports the dependency step as the caller's to do, and the gate already did it with
    // `file:` paths into this checkout. The exemption is narrow on purpose — excusing "the install
    // step" in general would excuse the class of regression this gate exists to catch — so it is
    // verified twice: the ⚠ must BE that step, and the resolved packages must really be the local
    // ones.
    const manualLines = report.split('\n').filter((l) => l.includes('[⚠]'));
    const unexpected = manualLines.filter((l) => !/Install dependencies/i.test(l));
    chk(
      'init leaves no manual step the gate did not already perform',
      unexpected.length === 0,
      unexpected.length === 0
        ? `${String(manualLines.length)} ⚠ (the expected --no-install one)`
        : unexpected.join(' | ').trim(),
    );

    const wired = Object.entries(scaffold.packages).filter(([name, rel]) => {
      try {
        return realpathSync(join(app, 'node_modules', name)).startsWith(
          realpathSync(join(ROOT, rel)),
        );
      } catch {
        return false;
      }
    });
    chk(
      '  and the SDK the app resolves is THIS checkout, not npm',
      wired.length === Object.keys(scaffold.packages).length,
      `${String(wired.length)}/${String(Object.keys(scaffold.packages).length)} linked into the repo`,
    );
    chk(
      '  and init applied something — a run of all `·` would mean it found nothing to do',
      (report.match(/\[✓\]/g) ?? []).length > 0,
      `${String((report.match(/\[✓\]/g) ?? []).length)} ✓ mark(s)`,
    );

    // ── 4. own the daemon before the app can dial it (harness rule 2) ───────────────────────────
    daemon = await startOwnedDaemon(bridgePort, { cliPath: CLI, cwd: ROOT });
    const transport = watchTransport(bridgePort);

    // ── 5. boot, and open it in a real browser ──────────────────────────────────────────────────
    const [devCmd, devArgs] = scaffold.dev(appPort);
    dev = spawn(devCmd, devArgs, {
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
      if (await reachable(`http://localhost:${String(appPort)}/`)) {
        booted = true;
        break;
      }
      await sleep(500);
    }
    chk('the app boots', booted, booted ? `:${String(appPort)}` : devLog.join('').slice(-300));

    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const consoleLines = [];
    page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
    try {
      await page.goto(`http://localhost:${String(appPort)}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
    } catch (err) {
      consoleLines.push(`goto failed: ${String(err).slice(0, 120)}`);
    }

    // POLL. Steps 6 and 7 of the connection sequence race, and a gate that samples once sits outside
    // the product's own protection against it — see docs/system-map.md.
    const connectDeadline = Date.now() + CONNECT_TIMEOUT_MS;
    let sessions = [];
    while (Date.now() < connectDeadline) {
      sessions = await sessionsOn(bridgePort);
      if (sessions.length > 0) break;
      await sleep(500);
    }

    // ── 6. attribute honestly (harness rule 4) ─────────────────────────────────────────────────
    const { aliveThroughout } = transport.stop();
    const verdict = attributeOutcome({
      connected: sessions.length > 0,
      transportAliveThroughout: aliveThroughout,
    });
    if (verdict.outcome === Attribution.INCONCLUSIVE) {
      // Neither a pass nor a clean fail. A scaffold that never had a bridge was never tested, and
      // reporting that as an install failure is how a correct SvelteKit install became a bug report.
      console.log(`   ⚠️  INCONCLUSIVE — ${verdict.because}`);
      fail += 1;
    } else {
      chk(
        'a session actually appears — the only step that proves the install works',
        verdict.outcome === Attribution.PASS,
        verdict.outcome === Attribution.PASS
          ? (sessions[0]?.url ?? '')
          : `${verdict.because}; console: ${consoleLines.slice(-3).join(' | ').slice(0, 220)}`,
      );
    }

    await browser.close();
  } catch (err) {
    chk('the scaffold ran to completion', false, String(err).slice(0, 300));
  } finally {
    if (dev !== undefined) {
      try {
        process.kill(-dev.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    if (daemon !== undefined) await daemon.stop();
    await freePortSafely(appPort);
    if (KEEP) note(`kept: ${workdir}`);
    else rmSync(workdir, { recursive: true, force: true });
  }

  console.log(`   ${fail === 0 ? '✓' : '✗'} ${scaffold.id}: ${pass} passed, ${fail} failed`);
  return { id: scaffold.id, pass, fail };
}

console.log('\n=== INSTALL GATE: pristine apps, installed into, opened, and asked to connect ===');
if (SELF_TEST) console.log('   (self-test: every scaffold is mis-wired and MUST fail)');
await sweepBatteryOrphans([], { onNote: (n) => console.log(`   · ${n}`) });

const chosen = SCAFFOLDS.filter((s) => ONLY === undefined || s.id === ONLY);
if (chosen.length === 0) {
  console.error(`\nno scaffold named '${String(ONLY)}' — have: ${SCAFFOLDS.map((s) => s.id).join(', ')}`);
  process.exit(1);
}

const results = [];
for (const [index, scaffold] of chosen.entries()) {
  results.push(await driveScaffold(scaffold, index));
}

console.log('\n──────── summary ────────');
for (const r of results) {
  console.log(`   ${r.fail === 0 ? '✅' : '❌'} ${r.id.padEnd(20)} ${r.pass} passed, ${r.fail} failed`);
}

if (SELF_TEST) {
  // Inverted, and per scaffold. A green here would mean the session check passes regardless of
  // reality, which is the only way this whole script could be worthless while looking fine.
  const undetected = results.filter((r) => r.fail === 0).map((r) => r.id);
  const ok = undetected.length === 0;
  console.log(
    `\n${ok ? '✅ SELF-TEST PASSED' : '❌ SELF-TEST FAILED'} — ` +
      (ok
        ? 'every mis-wired install was correctly reported as a failure'
        : `these went UNDETECTED and so prove nothing: ${undetected.join(', ')}`),
  );
  process.exit(ok ? 0 : 1);
}

const failed = results.filter((r) => r.fail > 0);
console.log(
  `\n${failed.length === 0 ? '✅ INSTALL GATE PASSED' : '❌ INSTALL GATE FAILED'} ` +
    `(${String(results.length - failed.length)}/${String(results.length)} scaffolds)`,
);
process.exit(failed.length === 0 ? 0 : 1);
