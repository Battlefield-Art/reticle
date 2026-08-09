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
  // Also needs no browser and no servers: a fake MCP peer and a hand-rolled HELLO, both LYING about
  // their contract. Runs early for the same reason — it is a cheap check that the three pieces agree.
  'version-skew-test',
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
  // The other half of the transport story. daemon-lifecycle covers the daemon exiting on its OWN
  // terms; this one SIGKILLs it under a live client and asserts the stdio MCP server survives —
  // the failure a user experiences as "my tools vanished, open /mcp and reconnect". Also needs no
  // servers and no browser.
  'mcp-survives-test',
  // Brute force against the same transport: repeated kills, kills mid-call, concurrent bursts,
  // garbage on stdin, and a foreign process stealing the port. Survival is only half the bar — the
  // other half is that every request gets an ANSWER, because a hung call is a hung agent.
  'mcp-stress-test',
  // The wire under both of those: SDK <-> daemon. Session cap, oversized frames, malformed frames,
  // a message flood, and sockets killed mid-handshake. Owns its own daemon on its own port.
  'bridge-stress-test',
  // The other channel: daemon <-> page. Tabs closed mid-command, two tabs at once, a backgrounded
  // page, and a reload under a live ref. Needs the bench-app the dashboard specs use.
  'browser-stress-test',
  // Every shipped tool, called WRONG: empty, nulls, wrong types, junk keys, a 100KB argument.
  // The surface sweep proves the tools work; this proves they refuse safely — bounded, actionable,
  // and never blaming the caller's typo on Reticle. Needs the same bench-app.
  'tool-fuzz-test',
  'live-control-test',
  'real-world-tests',
  'multi-agent-lease-test',
  'atlas-hard-fixture-test',
  // Drives a real session and then checks that the EVENTS describe it — a different question from
  // telemetry-events-test, which only proves each kind can be sent. Owns a browser and writes a flow,
  // so it sits beside the sweep at the end.
  'telemetry-stitch-test',
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

/**
 * Warn when something that is NOT ours will join the bridge.
 *
 * The battery runs on 4400 — Reticle's default, and therefore the port every developer's own app
 * dials. A single fixture tab left open in a normal browser joins every daemon the battery starts,
 * and any spec that assumes it owns the session fails with "multiple sessions connected".
 *
 * That cost most of an afternoon: three different specs failed across three runs, each of them
 * correct, all of them poisoned by two Chrome tabs on :4310 and :7699. Every hypothesis about the
 * code was wrong, because the fault was not in the code.
 *
 * It has to BAIT them rather than just look: before the battery starts nothing is listening, so
 * there is nothing for a stray tab to be connected TO. The tabs reconnect to whatever appears on
 * 4400, so this stands a daemon up for a few seconds and sees who turns up. The first version of
 * this check polled an empty port, found nothing, and would have reported all-clear every time.
 *
 * Moving the battery to a private port is the real fix and is a bigger job: bench-app, next-smoke
 * and atlas each hardcode how they dial, and half of them silently stopped connecting when the port
 * moved. Until that is done, this names the cause in one line at the top of the run instead of
 * letting a different innocent spec fail each time.
 */
async function warnAboutForeignSessions() {
  await freePort();
  const daemon = spawn('node', ['packages/server/dist/cli.js', 'serve', '--port', String(BRIDGE_PORT)], {
    stdio: 'ignore',
    detached: true,
  });
  let sessions = [];
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const raw = await sh(
        `curl -s --max-time 2 http://localhost:${String(BRIDGE_PORT)}/status 2>/dev/null`,
      );
      if (raw === '') continue;
      try {
        sessions = JSON.parse(raw).sessions ?? [];
      } catch {
        /* daemon still coming up */
      }
      if (0 < sessions.length) break;
    }
  } finally {
    try {
      process.kill(-daemon.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    await freePort();
  }
  if (0 === sessions.length) return;
  process.stdout.write(
    `\n[e2e] WARNING: ${String(sessions.length)} FOREIGN session(s) joined :${String(BRIDGE_PORT)} before the battery started:\n` +
      sessions.map((session) => `        ${session.sessionId}  ${session.url}`).join('\n') +
      `\n        These are not ours — most likely app tabs open in your normal browser. They will join\n` +
      `        every daemon this battery starts, and any spec that assumes it owns the session will fail\n` +
      `        with "multiple sessions connected". The spec will look broken and will not be.\n` +
      `        Close those tabs before trusting a failure below.\n`,
  );
}

await warnAboutForeignSessions();

let failed = 0;
/** Names of the specs that failed, so the SUMMARY can name them — see below. */
const failures = [];
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
  // Capture the SIGNAL too. `close` reports (code, signal), and a spec killed by a signal arrives
  // with code === null — which the failure line then printed as "exit null", a message that says
  // only "something went wrong somewhere" and sent me to re-run the spec by hand to learn anything.
  const { code, signal } = await new Promise((res) =>
    child.on('close', (c, sig) => res({ code: c, signal: sig })),
  );
  try {
    // Negative pid targets the group. ESRCH just means everything already exited, which is the norm.
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* group already gone */
  }
  if (0 !== code) {
    const how = signal === null || signal === undefined ? `exit ${code}` : `killed by ${signal}`;
    failed += 1;
    failures.push(`${name} (${how})`);
    process.stdout.write(`\n[e2e] ✗ ${name} FAILED (${how})\n`);
  }
}

await freePort();
process.stdout.write(
  `\n================ e2e ${desktop ? 'desktop ' : ''}battery: ${specs.length - failed}/${specs.length} specs passed ================\n`,
);
// Name them HERE too, not only where they happened. The per-spec line is thousands of lines up by
// the time the battery ends, so "21/22" was in practice an unnamed failure: two intermittent ones
// were investigated from scratch because the summary — the part anyone actually reads, and all that
// survives in a CI tail — did not say which spec it was.
if (failures.length > 0) {
  process.stdout.write(`   failed: ${failures.join(', ')}\n`);
}
process.exit(failed === 0 ? 0 : 1);
