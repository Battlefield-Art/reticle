// Brute force against the MCP transport — the single point whose failure takes everything with it.
//
// `mcp-survives-test` proves the server outlives ONE daemon death. This one tries to break it on
// purpose: kill the daemon repeatedly and mid-call, steal its port, flood it with garbage, and fire
// bursts of concurrent work while all of that is happening.
//
// TWO acceptance bars, and the second is the one that is easy to forget:
//   1. the stdio server stays alive — an exit is what makes a human open /mcp;
//   2. every request gets an ANSWER. A call that never settles is not "degraded", it is a hung
//      agent, which is indistinguishable from a disconnect to the person waiting on it. An error is
//      an acceptable answer here; silence is not.
//
// Deliberately NOT asserting that calls succeed while the daemon is dead. The product's promise is
// that the transport survives and answers, not that it can drive a browser that is not there.
import path from 'node:path';
import net from 'node:net';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { McpStdioClient } from '../../../bench/harness/mcp-client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = process.env.MCP_STRESS_PORT ?? '4731';
const SQUAT_PORT = process.env.MCP_SQUAT_PORT ?? '4732';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const chk = (label, ok, detail = '') => {
  console.log(`   ${ok ? '✅' : '❌'} ${label}${detail ? '  — ' + detail : ''}`);
  ok ? (pass += 1) : (fail += 1);
};

function daemonPid(port = PORT) {
  try {
    return (
      execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim()
        .split('\n')[0] || null
    );
  } catch {
    return null;
  }
}

function killDaemon(port = PORT) {
  const pid = daemonPid(port);
  if (pid === null) return false;
  try {
    process.kill(Number(pid), 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

const alive = (c) => c.proc !== null && c.proc.exitCode === null && !c.proc.killed;

/** Settled = answered at all. A rejection is an answer; a timeout is the failure this hunts. */
async function settled(promise) {
  try {
    await promise;
    return { answered: true, how: 'ok' };
  } catch (err) {
    const msg = String(err);
    return { answered: !/timeout after/.test(msg), how: msg.slice(0, 60) };
  }
}

console.log('\n=== MCP STRESS: brute force against the transport ===');
process.on('unhandledRejection', () => undefined);

const client = new McpStdioClient('node', ['packages/server/dist/cli.js', 'mcp', '--port', PORT], {
  RETICLE_PORT: PORT,
  RETICLE_TELEMETRY: '0',
  // Reach the retry budget in seconds rather than minutes — the same override the survival spec uses.
  RETICLE_RECONNECT_ATTEMPTS: '3',
});
process.chdir(ROOT);
await client.start();
chk('the server comes up and advertises tools', (await client.listTools()).length > 0);

// ── 1. Kill the daemon ten times in a row, calling a tool after each ──────────────────────────
// The field log on a real machine showed 1,770 reconnects and one give-up; this compresses that
// pattern into ten seconds.
let answered = 0;
let killed = 0;
for (let i = 0; i < 10; i++) {
  if (killDaemon()) killed += 1;
  const r = await settled(client.request('tools/call', { name: 'reticle_sessions', arguments: {} }, 30_000));
  if (r.answered) answered += 1;
  else console.log(`      (round ${i}: ${r.how})`);
}
chk('survives ten consecutive daemon kills', alive(client), `killed ${killed}/10`);
chk('  and answered every call in between', 10 === answered, `${answered}/10 answered`);

// ── 2. Killed WITH a request in flight ────────────────────────────────────────────────────────
// The nastiest ordering: the daemon dies after accepting the request and before replying, so the
// answer can only come from the proxy noticing and recovering.
{
  const inFlight = client.request('tools/call', { name: 'reticle_sessions', arguments: {} }, 30_000);
  await sleep(60);
  killDaemon();
  const r = await settled(inFlight);
  chk('a request in flight when the daemon dies still settles', r.answered, r.how);
  chk('  and the server is still alive after that', alive(client));
}

// ── 3. A burst of concurrent calls across a kill ──────────────────────────────────────────────
{
  const burst = Array.from({ length: 20 }, () =>
    settled(client.request('tools/call', { name: 'reticle_sessions', arguments: {} }, 30_000)),
  );
  await sleep(40);
  killDaemon();
  const results = await Promise.all(burst);
  const ok = results.filter((r) => r.answered).length;
  chk('20 concurrent calls across a kill all settle', 20 === ok, `${ok}/20`);
  chk('  server still alive', alive(client));
}

// ── 4. Garbage on stdin ───────────────────────────────────────────────────────────────────────
// A malformed frame must not be able to kill the transport. Anything reading a socket has to
// tolerate what a buggy client sends.
{
  client.proc.stdin.write('this is not json\n');
  client.proc.stdin.write('{"jsonrpc":"2.0"}\n'); // no id, no method
  client.proc.stdin.write('{broken\n');
  client.proc.stdin.write(`${'x'.repeat(200_000)}\n`); // a very long line
  await sleep(300);
  chk('garbage on stdin does not kill the server', alive(client));
  const r = await settled(client.request('tools/list', {}, 20_000));
  chk('  and it still answers a valid request afterwards', r.answered, r.how);
}

// ── 5. A foreign process steals the bridge port ───────────────────────────────────────────────
// The documented real-world case: another project's daemon, or a half-dead process, holding 4400.
{
  killDaemon();
  await sleep(200);
  const squatter = net.createServer((s) => s.destroy());
  await new Promise((r) => squatter.listen(Number(PORT), '127.0.0.1', r));
  const r = await settled(client.request('tools/call', { name: 'reticle_sessions', arguments: {} }, 30_000));
  chk('a squatter on the port does not hang the client', r.answered, r.how);
  chk('  server still alive with the port stolen', alive(client));
  await new Promise((r) => squatter.close(r));
  // …and it recovers once the port is free again.
  await sleep(300);
  const back = await settled(client.request('tools/call', { name: 'reticle_sessions', arguments: {} }, 45_000));
  chk('recovers once the port is free again', back.answered, back.how);
}

// ── 6. Still alive, still useful ──────────────────────────────────────────────────────────────
{
  const tools = await client.listTools().catch(() => []);
  chk('after all of it, the tool surface is still there', tools.length > 0, `${tools.length} tools`);
}

await client.stop();
killDaemon();
console.log(`\n${0 === fail ? '✅' : '❌'} MCP STRESS (${pass} passed, ${fail} failed)`);
process.exit(0 === fail ? 0 : 1);
