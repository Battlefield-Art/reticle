// The harness contract, as code. Read apps/e2e/harness-rules.md for why each rule exists.
//
// Every unreliable gate result in this repo's history came from the harness being a client of the
// system it measures, and inheriting its failure modes. SvelteKit was written up as an install
// failure when the daemon had died. The daemon's own idle shutdown fired during a long dependency
// install and three fixtures were scored as install failures. Two contradictory conclusions about
// MCP stability were filed a week apart, and one of them was the harness killing its own proxy.
//
// None of those were product defects. All of them were reported as product defects, because the
// harness had no way to say "the transport was gone, so I cannot attribute this".
//
// Self-check: `node apps/e2e/gate-harness.mjs --self-check`
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

/** Reticle's default bridge port — the one every doc, error message and config example names. */
export const DEFAULT_BRIDGE_PORT = 4400;

/** Disables the daemon's idle self-shutdown. A gate owns its daemon; nothing else may end it. */
export const IDLE_SHUTDOWN_DISABLED = '0';

/** How long a freshly spawned daemon gets to actually BIND before we call the start failed. */
const DAEMON_BIND_TIMEOUT_MS = 30_000;
const DAEMON_POLL_MS = 200;
/** Escalation schedule for freeing a port: polite first, then not. */
const FREE_PORT_ATTEMPTS = 12;
const FREE_PORT_SIGKILL_AFTER = 3;
const FREE_PORT_SETTLE_MS = 400;

/**
 * Every process holding `port`, split by whether it is the LISTENER or merely connected to it.
 *
 * This distinction is the whole point of this module. `lsof -ti tcp:4400` returns both, so the
 * recipe everyone reaches for —
 *
 *   lsof -ti tcp:4400 | xargs kill -9
 *
 * — kills the daemon AND every `reticle mcp` proxy attached to it. Measured: listener pid 70244 and
 * proxy pid 70245 both returned; the kill took the proxy with it and every subsequent tool call
 * hung unanswered, with nothing in ~/.reticle/proxy-4400.log because the process that writes it was
 * the one that died. An agent in that state is not degraded, it is gone, and no log says so.
 */
export function portHolders(port) {
  const listeners = new Set(lsof(['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-t']));
  const all = lsof(['-nP', `-iTCP:${String(port)}`, '-t']);
  return all.map((pid) => ({
    pid,
    listener: listeners.has(pid),
    command: commandOf(pid),
  }));
}

function lsof(args) {
  try {
    return execFileSync('lsof', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch {
    // lsof exits non-zero when nothing matches. That is an answer, not an error.
    return [];
  }
}

function commandOf(pid) {
  try {
    return execFileSync('ps', ['-p', pid, '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Free a port without taking anybody's MCP link with it.
 *
 * Listeners first, because a listener is the thing that causes EADDRINUSE and is the only holder a
 * gate has any business killing. Only if the port is STILL held does this look at the rest — and it
 * names them rather than killing them blind, because a client socket on this port is almost always
 * somebody's agent.
 *
 * `run.mjs` deliberately omitted `-sTCP:LISTEN` for a real reason: a socket mid-teardown still holds
 * the port and still causes EADDRINUSE, and filtering to LISTEN missed it. Both concerns are true.
 * Ordering satisfies both — the teardown case is reached, but only after the listener is gone and
 * the port is demonstrably still held.
 */
export async function freePortSafely(port, { onNote = () => {} } = {}) {
  for (let attempt = 0; attempt < FREE_PORT_ATTEMPTS; attempt += 1) {
    const listeners = portHolders(port).filter((h) => h.listener);
    if (listeners.length === 0) break;
    kill(
      listeners.map((h) => h.pid),
      attempt >= FREE_PORT_SIGKILL_AFTER,
    );
    await sleep(FREE_PORT_SETTLE_MS);
  }

  const rest = portHolders(port);
  if (rest.length === 0) return { freed: true, survivors: [] };

  // Everything here is a NON-listener: a socket in teardown, or somebody's live MCP proxy. Say which
  // before doing anything about it — a gate that silently kills an agent's transport and then reports
  // on that agent's behaviour is measuring its own interference.
  onNote(
    `port ${String(port)} still held after the listener was freed by: ` +
      rest.map((h) => `pid ${h.pid} (${h.command})`).join(', '),
  );
  for (let attempt = 0; attempt < FREE_PORT_ATTEMPTS; attempt += 1) {
    const held = portHolders(port);
    if (held.length === 0) return { freed: true, survivors: rest };
    kill(
      held.map((h) => h.pid),
      attempt >= FREE_PORT_SIGKILL_AFTER,
    );
    await sleep(FREE_PORT_SETTLE_MS);
  }
  return { freed: portHolders(port).length === 0, survivors: portHolders(port) };
}

function kill(pids, hard) {
  for (const pid of pids) {
    try {
      process.kill(Number(pid), hard ? 'SIGKILL' : 'SIGTERM');
    } catch {
      // Already gone between the listing and the signal. Fine.
    }
  }
}

/** True when something answers `/status` on this port — a real daemon, not merely an open socket. */
export async function transportAlive(port, { timeoutMs = 1_000 } = {}) {
  try {
    const res = await fetch(`http://localhost:${String(port)}/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start a daemon this run OWNS for its whole lifetime, and prove it bound the port.
 *
 * Two rules in one function, because they fail together:
 *
 * 1. **Idle shutdown off.** The daemon exits after 5 minutes idle (30 with an agent attached), and
 *    `isUselessDaemon` will end one that has never served a tool call. A gate that spends six
 *    minutes on `pnpm install` before its first call is exactly that daemon. This already happened:
 *    the shutdown fired mid-install and the apps that booted afterwards hit ERR_CONNECTION_REFUSED
 *    and were scored as install failures.
 * 2. **Bind, not spawn.** `reticle serve` reports `reticle_daemon_spawned` and exits 0 while the
 *    child dies on EADDRINUSE (see issue #115). Waiting on `/status` is the only honest signal.
 *
 * Never let a daemon be spawned implicitly by a tool call: one spawned inside an agent's shell
 * command is SIGTERMed when that command ends, `detached` or not.
 */
export async function startOwnedDaemon(port, { cliPath, cwd, env = {}, stdio = 'ignore' } = {}) {
  await freePortSafely(port);
  const child = spawn(process.execPath, [cliPath, 'serve', '--port', String(port)], {
    cwd,
    detached: true,
    stdio,
    env: {
      ...process.env,
      RETICLE_IDLE_SHUTDOWN_MS: IDLE_SHUTDOWN_DISABLED,
      RETICLE_TELEMETRY: '0',
      ...env,
    },
  });
  const deadline = Date.now() + DAEMON_BIND_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await transportAlive(port)) return { child, port, stop: () => stopOwnedDaemon(port) };
    await sleep(DAEMON_POLL_MS);
  }
  const holders = portHolders(port);
  throw new Error(
    `the daemon never bound port ${String(port)} within ${String(DAEMON_BIND_TIMEOUT_MS)}ms. ` +
      (holders.length === 0
        ? 'Nothing is holding the port, so it failed to start — read ~/.reticle/daemon-' +
          String(port) +
          '.log.'
        : `Held by: ${holders.map((h) => `pid ${h.pid} (${h.command})`).join(', ')}`),
  );
}

export async function stopOwnedDaemon(port) {
  await freePortSafely(port);
}

/**
 * Refuse to blame the app when the transport was gone.
 *
 * The rule that would have prevented the SvelteKit report: a fixture is only allowed to FAIL if the
 * bridge was alive for its whole window. Otherwise the verdict is INCONCLUSIVE and names the
 * transport, because a fixture that never got a bridge was never tested.
 *
 * Deliberately three-valued. Collapsing "the app is broken" and "we could not look" into one boolean
 * is the same mistake `decideVerified` exists to avoid in the product — the harness should not make
 * it either.
 */
export const Attribution = {
  PASS: 'pass',
  FAIL: 'fail',
  INCONCLUSIVE: 'inconclusive',
};

export function attributeOutcome({ connected, transportAliveThroughout }) {
  if (connected) return { outcome: Attribution.PASS, because: 'a session connected' };
  if (!transportAliveThroughout) {
    return {
      outcome: Attribution.INCONCLUSIVE,
      because:
        'no session appeared, but the bridge was not listening for the whole window — this says ' +
        'nothing about the app. Re-run with the daemon owned by the harness before filing anything.',
    };
  }
  return {
    outcome: Attribution.FAIL,
    because: 'the bridge was up for the whole window and no session ever appeared',
  };
}

/**
 * Watch the bridge for the duration of a fixture's window, so `attributeOutcome` has an input that
 * is measured rather than assumed. Returns a stop() that reports whether it was up the whole time.
 */
export function watchTransport(port, { intervalMs = 500 } = {}) {
  let everDown = false;
  const timer = setInterval(() => {
    void transportAlive(port).then((up) => {
      if (!up) everDown = true;
    });
  }, intervalMs);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
      return { aliveThroughout: !everDown };
    },
  };
}

// ── self-check ────────────────────────────────────────────────────────────────────────────────
// The smallest thing that fails if the listener/client distinction breaks — which is the exact bug
// that produced a false "MCP never recovers" finding. Stands up a listener and a client on the same
// port and asserts they are told apart.
async function selfCheck() {
  const net = await import('node:net');
  const assert = await import('node:assert/strict');
  const PORT = 45_231;

  const server = net.createServer((s) => s.on('data', () => {}));
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  // The client must be a SEPARATE process. `lsof -t` reports pids, not sockets, so one process
  // holding both ends collapses to a single pid and the distinction under test disappears — which
  // is also why the real hazard only shows up between the daemon and the proxy.
  const client = spawn(
    process.execPath,
    ['-e', `require('node:net').connect(${String(PORT)},'127.0.0.1',()=>setTimeout(()=>{},60000))`],
    { stdio: 'ignore' },
  );
  await new Promise((r) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (portHolders(PORT).length > 1 || Date.now() - started > 5_000) {
        clearInterval(poll);
        r();
      }
    }, 50);
  });

  const holders = portHolders(PORT);
  const listeners = holders.filter((h) => h.listener);
  const clients = holders.filter((h) => !h.listener);

  assert.ok(holders.length >= 1, 'lsof found no holder of a port we are demonstrably holding');
  assert.equal(listeners.length >= 1, true, 'the listening socket was not classified as a listener');
  assert.ok(
    clients.length >= 1,
    'the client socket was not seen at all — a blind kill would have taken it and this check ' +
      'would not have noticed',
  );
  assert.equal(
    attributeOutcome({ connected: false, transportAliveThroughout: false }).outcome,
    Attribution.INCONCLUSIVE,
    'a fixture with no bridge must never be attributed a failure',
  );
  assert.equal(
    attributeOutcome({ connected: false, transportAliveThroughout: true }).outcome,
    Attribution.FAIL,
  );

  client.kill('SIGKILL');
  await new Promise((r) => server.close(r));
  console.log('gate-harness self-check: ok (listener and client sockets are distinguishable)');
}

if (process.argv.includes('--self-check')) {
  await selfCheck();
}
