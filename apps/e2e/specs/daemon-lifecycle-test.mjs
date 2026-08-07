// The daemon's LIFE CYCLE — the one behaviour neither gate could observe.
//
// Three separate bugs shipped behind this gap in a single night:
//
//   1. the idle watcher could never fire while an agent was attached, so a daemon spawned in a
//      directory with no app sat for a median of 28 minutes doing nothing (0.04% duty cycle);
//   2. the MCP proxy never respawned a dead daemon — it retried a dead port until the retry budget
//      ran out and then exited, taking the agent's whole Reticle surface with it, silently;
//   3. fixing both at once produced a SHUTDOWN/RESPAWN LOOP: the daemon exited as useless, the proxy
//      instantly brought back one just as useless, forever. Four processes in 200 seconds.
//
// Every one of them was found by watching pids on a live system. Unit tests never start a daemon,
// and the rest of this battery starts one and drives it immediately — so nothing here ever leaves a
// daemon idle for a grace window, which is exactly when all three misbehave.
//
// Runs with a short grace and a short check cadence (RETICLE_IDLE_SHUTDOWN_MS / RETICLE_IDLE_CHECK_MS)
// so the whole spec costs seconds rather than the minute-plus the 30s default would.
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { McpStdioClient } from '../../../bench/harness/mcp-client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = process.env.LIFECYCLE_PORT ?? '4699';
const GRACE_MS = 2000;
const CHECK_MS = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const chk = (label, ok, detail = '') => {
  console.log(`   ${ok ? '✅' : '❌'} ${label}${detail ? '  — ' + detail : ''}`);
  ok ? (pass += 1) : (fail += 1);
};

/** The pid listening on the bridge port, or null. The only honest way to watch a daemon's life. */
function daemonPid() {
  try {
    const out = execSync(`lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t`, { stdio: ['ignore', 'pipe', 'ignore'] });
    return out.toString().trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

async function waitFor(predicate, timeoutMs, stepMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(stepMs);
  }
  return false;
}

console.log('\n=== DAEMON LIFECYCLE: idle exit, no loop, wake on demand ===');

process.chdir(ROOT);
const client = new McpStdioClient(
  'node',
  ['packages/server/dist/cli.js', 'mcp', '--port', PORT],
  {
    RETICLE_PORT: PORT,
    RETICLE_TELEMETRY: '0',
    RETICLE_IDLE_SHUTDOWN_MS: String(GRACE_MS),
    RETICLE_IDLE_CHECK_MS: String(CHECK_MS),
  },
);
await client.start();

const call = async (name, args = {}) => {
  const r = await client.request('tools/call', { name, arguments: args }, 30_000);
  const text = (r?.content ?? []).map((c) => c.text ?? '').join('\n');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const born = await waitFor(() => daemonPid() !== null, 15_000);
const firstPid = daemonPid();
chk('a daemon comes up for the attached agent', born && firstPid !== null, `pid ${firstPid}`);

// 1. It exits when it has served nothing and no browser ever connected — even though an agent is
//    still attached. Before, `agentConnected` alone kept it alive for the whole editor session.
const exited = await waitFor(() => daemonPid() === null, 20_000);
chk('an attached-but-unused daemon shuts itself down', exited);

// 2. And STAYS down. This is the regression guard: a proxy that respawns on stream drop turns the
//    shutdown above into an endless cycle.
const pidsSeen = new Set();
for (let i = 0; i < 12; i++) {
  await sleep(700);
  const p = daemonPid();
  if (p !== null) pidsSeen.add(p);
}
chk(
  'it stays down — no shutdown/respawn loop',
  pidsSeen.size === 0,
  pidsSeen.size === 0 ? 'no daemon respawned unprompted' : `${pidsSeen.size} daemon(s): ${[...pidsSeen].join(',')}`,
);

// 3. Demand brings it back, and the agent never sees the difference.
const t0 = Date.now();
const result = await call('reticle_sessions');
const answeredMs = Date.now() - t0;
chk('the next tool call is answered anyway', Array.isArray(result?.sessions), JSON.stringify(result).slice(0, 60));
const secondPid = daemonPid();
chk('a fresh daemon was started on demand', secondPid !== null && secondPid !== firstPid, `pid ${firstPid} -> ${secondPid}`);
chk('and the agent waited a reasonable time for it', answeredMs < 15_000, `${answeredMs}ms`);

try {
  execSync(`node packages/server/dist/cli.js stop --port ${PORT}`, { stdio: 'ignore' });
} catch {
  /* already gone */
}

console.log(`\n${fail === 0 ? '✅ DAEMON LIFECYCLE VERIFIED' : '❌ FAILED'} (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
