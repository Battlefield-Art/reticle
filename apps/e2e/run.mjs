// E2E orchestrator: run each committed spec sequentially against already-running servers
// (api:8787, demo:4310, next-smoke:3100). Each spec boots its own Reticle bridge on :4400, so we
// free that port between specs. Exits non-zero if any spec fails — the CI regression gate.
//
// Two batteries, one runner. `--desktop` runs the Electron/Tauri specs instead of the web ones,
// because those two need things the web battery's boot script does not provision — an Electron
// install, a compiled Tauri binary, and on Linux a display — while needing none of its three HTTP
// servers. They are a separate JOB, never a silent omission: a spec on disk that belongs to neither
// list still fails the classification check below.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const specsDir = path.join(dir, 'specs');

// Order: next-smoke-backed specs first, real-world (demo+api) last.
const ORDER = [
  // Needs no browser and none of the three servers — real dist modules against a real capture
  // endpoint. Runs first because it is the fastest way to learn the build is sane.
  'telemetry-events-test',
  'next-smoke-test',
  'next-blur-clock-test',
  'status-honesty-test',
  'drive-launch-test',
  'spa-nav-realinput-test',
  'visual-test',
  'crawl-test',
  'scroll-find-test',
  'flow-record-replay-test',
  'flow-self-heal-test',
  'project-history-test',
  'spec-runner-test',
  // Needs no servers and no browser — it watches the daemon's own life cycle, which nothing else
  // here can see (every other spec drives a daemon immediately, never leaving one idle).
  'daemon-lifecycle-test',
  'live-control-test',
  'real-world-tests',
  'multi-agent-lease-test',
  'atlas-hard-fixture-test',
  // Last: it drives every tool over real MCP, including navigate/crawl/clock, and owns a browser of
  // its own. Running it earlier would leave the shared bench-app in a state later specs assume fresh.
  'tool-surface-sweep-test',
];
// The desktop battery — `pnpm e2e:desktop`. Each of these starts its OWN runtime (an Electron main
// process, a packaged Tauri binary) and waits for it to dial the bridge, so they need no server from
// run-ci.sh and would only fail inside it for want of a display.
const DESKTOP = ['electron-desktop-test', 'tauri-desktop-test'];
// Specs intentionally excluded from BOTH batteries (add here WITH a reason, never by omission).
const SKIP = new Set([]);
const present = new Set(
  readdirSync(specsDir)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => f.replace(/\.mjs$/, '')),
);
// ORDER only SEQUENCES; a spec present on disk but in no list is silently un-run rot (this is how
// new-features-test.mjs rotted). Fail loud so every new spec must be classified.
const unclassified = [...present].filter(
  (n) => !ORDER.includes(n) && !DESKTOP.includes(n) && !SKIP.has(n),
);
if (unclassified.length > 0) {
  console.error(
    `\ne2e: spec(s) present but not in ORDER, DESKTOP or SKIP: ${unclassified.join(', ')}\n` +
      'Add each to ORDER (web battery), DESKTOP (Electron/Tauri battery), or SKIP (with a reason).',
  );
  process.exit(1);
}
// A named list that resolves to nothing means the battery quietly passed having run zero specs —
// the same rot in a new shape. Only reachable by deleting a file without updating the list.
const desktop = process.argv.includes('--desktop');
const specs = (desktop ? DESKTOP : ORDER).filter((n) => present.has(n));
if (specs.length === 0) {
  console.error(`\ne2e: the ${desktop ? 'desktop' : 'web'} battery resolved to zero specs`);
  process.exit(1);
}

const sh = (cmd) =>
  new Promise((res) => {
    let out = '';
    const child = spawn('bash', ['-c', cmd], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.on('close', () => res(out.trim()));
  });

/** The bridge port every spec binds. One holder left behind fails every spec after it. */
const BRIDGE_PORT = 4400;

/**
 * Free the bridge port, escalating until it actually IS free.
 *
 * A spec that fails can leave a process holding this port, and the previous version — a single
 * SIGTERM to LISTEN sockets followed by `sleep 1` — did not reliably shift it: a hung process may
 * ignore SIGTERM, and a socket mid-teardown is not in LISTEN state so it was not even looked at.
 * Every subsequent spec then died with EADDRINUSE, so ONE real failure was reported as fifteen and
 * the actual cause sat buried under fourteen spurious ones. Measured: that turned a single broken
 * spec into a dozen turns of misdiagnosis.
 *
 * Escalates TERM → KILL and polls until the port is genuinely released, then says so plainly if it
 * cannot be — a diagnosis is worth more than a cascade.
 */
async function freePort() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    // No `-sTCP:LISTEN`: a socket being torn down still holds the port and still causes EADDRINUSE.
    const held = await sh(`lsof -tiTCP:${String(BRIDGE_PORT)} 2>/dev/null`);
    if (held === '') return;
    const signal = attempt < 3 ? '' : '-9';
    await sh(`kill ${signal} ${held.split('\n').join(' ')} 2>/dev/null; sleep 0.4`);
  }
  const stillHeld = await sh(`lsof -tiTCP:${String(BRIDGE_PORT)} 2>/dev/null`);
  if (stillHeld !== '') {
    process.stdout.write(
      `\n[e2e] port ${String(BRIDGE_PORT)} is STILL held by pid(s) ${stillHeld.split('\n').join(', ')} — ` +
        `every spec below will fail with EADDRINUSE for that reason and not their own.\n`,
    );
  }
}

let failed = 0;
for (const name of specs) {
  await freePort();
  process.stdout.write(`\n──────── ${name} ────────\n`);
  // `detached` puts the spec in its OWN process group, so anything it spawned — a browser, a server,
  // a daemon — can be cleaned up as a unit when it exits.
  //
  // The port sweep above only frees the BRIDGE port, which is the shape of the failure I happened to
  // hit rather than the shape of the failure itself: a spec binding any other port leaves the same
  // cascade behind. Measured: a spec holding :9960 failed every later run of itself the same way
  // :4400 did. Killing the group is port-agnostic and needs no list of ports to keep up to date.
  const child = spawn('node', [path.join(specsDir, `${name}.mjs`)], {
    stdio: 'inherit',
    detached: true,
  });
  const code = await new Promise((res) => child.on('close', res));
  try {
    // Negative pid targets the group. ESRCH just means everything already exited, which is the norm.
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* group already gone */
  }
  if (code !== 0) {
    failed += 1;
    process.stdout.write(`\n[e2e] ✗ ${name} FAILED (exit ${code})\n`);
  }
}

await freePort();
process.stdout.write(
  `\n================ e2e ${desktop ? 'desktop ' : ''}battery: ${specs.length - failed}/${specs.length} specs passed ================\n`,
);
process.exit(failed === 0 ? 0 : 1);
