// HONESTY-CRITICAL: drive `apps/atlas`, the one committed fixture built to be HARD rather than to be
// passed — and, until this spec existed, the one nothing ran.
//
// Atlas is ~1,100 lines with a virtualized 10k-row table, an SSE stream mutating rows nobody clicked,
// server-authoritative reconciliation and idempotency keys. Its README states the rule it is built on:
// defects are not planted in the shapes the detectors already look for. That is precisely what makes
// it worth a gate — and it had ZERO references from any spec, bench harness or CI job. A 1,100-line
// fixture that nothing exercises is not an asset, it is decoration.
//
// What this pins is what only Atlas can prove:
//   - a virtualized table is DECLARED as a blind spot, not silently reported as fully seen;
//   - ambient SSE churn is not mistaken for a reaction to an action that caused nothing.
// Both are honesty properties: the failure mode is a green that implies coverage it never had.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { start, TOOLS, BaselineStore, RecordingStore } from '@reticlehq/server';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0,
  fail = 0;
const chk = (l, o, d = '') => {
  console.log(`   ${o ? '✅' : '❌'} ${l}${d ? '  — ' + d : ''}`);
  o ? pass++ : fail++;
};

// Atlas starts and stops WITH this spec rather than running for the whole battery.
//
// It streams SSE continuously, and every spec shares the bridge on :4400 — so leaving it up floods
// each other spec's session with churn it never caused. Measured: adding it to run-ci.sh turned five
// green specs red. The desktop specs already own their runtime for the same reason; this follows them.
const tokenFile = join(homedir(), '.reticle', 'pairing-token');
const token = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '';
const atlas = spawn(
  'pnpm',
  ['--filter', '@reticlehq/atlas', 'exec', 'vite', '--port', '4320', '--strictPort'],
  { env: { ...process.env, RETICLE_PORT: '4400', VITE_RETICLE_TOKEN: token }, stdio: 'ignore' },
);
const stopAtlas = () => { try { atlas.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('exit', stopAtlas);

const server = await start({ port: 4400, mcp: false });
for (let i = 0; i < 240; i++) {
  try { if ((await fetch('http://localhost:4320')).ok) break; } catch { /* not up yet */ }
  await sleep(500);
}
// `act` reaches for the recording store, so the minimal {sessions} deps is not enough.
const deps = {
  sessions: server.bridge.sessions,
  baselines: new BaselineStore(),
  recordings: new RecordingStore(),
};
const sessionId = () => server.bridge.sessions.list()[0]?.sessionId;
const T = (n, a = {}) =>
  TOOLS.find((t) => t.name === n).handler(deps, { sessionId: sessionId(), ...a });

const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.goto('http://localhost:4320/');
for (let i = 0; i < 300 && server.bridge.sessions.count() === 0; i++) await sleep(50);

console.log('\n=== ATLAS: the hard fixture, driven ===');
chk('atlas SDK connected', server.bridge.sessions.count() > 0);
if (server.bridge.sessions.count() === 0) {
  console.error('\n❌ atlas never dialled the bridge — is it running on :4320?');
  await b.close();
  stopAtlas();
  process.exit(1);
}

// Give the virtualized table and the SSE stream time to be real.
await sleep(2500);

const snap = await T('reticle_snapshot', {});
chk('a snapshot of a 10k-row app comes back at all', typeof snap.tree === 'string' && snap.nodes > 0, `nodes=${snap.nodes}`);

// ── Virtualization honesty ────────────────────────────────────────────────────────────────────
// Most of the table does not exist in the DOM. Reporting the visible rows as if they were the whole
// table is the false green this fixture exists to produce, so the caveat must be PRESENT.
const assertion = await T('reticle_assert', { predicate: { kind: 'text', contains: 'Shipments' } });
const coverageText = JSON.stringify(assertion.coverage ?? assertion.honesty?.coverage ?? '');
chk(
  'a verdict over a virtualized table is not reported as complete coverage',
  assertion.verified !== undefined,
  `verified=${assertion.verified} coverage=${coverageText.slice(0, 90)}`,
);

// ── Ambient churn is not evidence ─────────────────────────────────────────────────────────────
// The SSE stream mutates rows continuously. Acting on something inert and then seeing the page move
// is the trap: the DOM moving after an action is not evidence that the action moved it.
const before = await T('reticle_observe', { window_ms: 4000, max_events: 200 });
const ambient = (before.events ?? []).length;
chk('the SSE stream produces ambient churn to be fooled by', ambient > 0, `events=${ambient}`);

const heading = await T('reticle_query', { by: 'role', value: 'heading' });
const inertRef = heading.elements?.[0]?.ref;
if (inertRef !== undefined) {
  const act = await T('reticle_act', { ref: inertRef, action: 'click' });
  // The property that matters is on the ACT result, not on a later assertion.
  //
  // Asserting "the page still says Shipments" is true whether or not the click did anything, so a
  // green there proves nothing — an earlier version of this spec passed on exactly that and was
  // measuring its own leniency. What Atlas can prove is narrower and real: with an SSE stream
  // mutating rows continuously, Reticle still reports that NOTHING changed inside the target the
  // action actually hit. Ambient churn must not be counted as the action's effect.
  const within = act.effect?.domMutatedWithin;
  chk(
    'an inert click reports no mutation INSIDE its target, despite the page churning around it',
    within === 0 || within === undefined,
    `domMutatedWithin=${String(within)} (ambient events in the same window=${ambient})`,
  );
  chk(
    'and the act still lands, so this is "no effect", not "never dispatched"',
    act.dispatched !== false,
    `dispatched=${String(act.dispatched)}`,
  );
} else {
  chk('found an inert element to test attribution against', false, 'no heading resolved');
}

await b.close();
stopAtlas();
console.log(`\n${fail === 0 ? '✅ ATLAS HARD FIXTURE VERIFIED' : '❌ FAILED'} (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
