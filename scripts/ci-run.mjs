/**
 * Run a CI command, and tell the difference between "this failed" and "the runner could not start
 * it".
 *
 * Windows runners intermittently refuse to start a process at all: the step exits
 * `-1073741502` (`0xC0000142`, STATUS_DLL_INIT_FAILED) with no output, sometimes 0.02s in, before a
 * single test has run. Observed twice in one day on two different steps, both re-running clean.
 *
 * The product is fine, and that is exactly the problem. The red is indistinguishable from a real
 * failure until somebody opens the log and recognises an obscure NT status code, and a `gate`
 * aggregator goes red behind it, so one infrastructure hiccup presents as two failing checks. This
 * repo already treats "reports the machine as a defect" as a bug class of its own.
 *
 * Two things, and the order matters:
 *
 *   1. NAME it. The log says in words that the runner failed to start the process and that this is
 *      an environment failure, not a test failure.
 *   2. Retry ONLY that. Safe here in a way a general retry is not: the process never started, so no
 *      user code ran and there is no partial state for a second attempt to be confused by.
 *
 * A retry without the naming would be worse than neither. Silently re-running a genuinely broken
 * build is how a flaky suite becomes a trusted-but-wrong one, so every retry is announced, and every
 * other exit code fails immediately with no second attempt.
 *
 * Usage: node scripts/ci-run.mjs <command> [args...]
 */

import { spawn } from 'node:child_process';

/**
 * Exit codes that mean the OS refused to start the process, never that the process failed.
 *
 * Node reports these as the signed 32-bit reading of the NT status, which is why they are negative.
 * Kept as a closed list rather than "any large negative number": a crash inside a real test can also
 * produce an unusual code, and retrying that would hide a genuine defect.
 */
export const RUNNER_LEVEL_EXIT_CODES = new Map([
  [-1073741502, '0xC0000142 STATUS_DLL_INIT_FAILED — a DLL failed to initialise at process start'],
  [-1073741819, '0xC0000005 STATUS_ACCESS_VIOLATION — the process died before running'],
]);

/**
 * Should this exit code be retried once, and what do we say about it?
 *
 * Pure, and exported so the decision is testable without spawning anything. `null` means "not a
 * runner-level failure": fail immediately, whatever the code.
 */
export function runnerLevelFailure(code) {
  if (code === null || code === undefined) return null;
  return RUNNER_LEVEL_EXIT_CODES.get(code) ?? null;
}

/** The sentence printed when one of these is seen. Named so the test asserts the claim, not prose. */
export function explain(code, detail, willRetry) {
  return (
    `[ci-run] the runner failed to START this process (exit ${String(code)}: ${detail}). ` +
    `This is an environment failure, not a test failure: no user code ran. ` +
    (willRetry ? 'Retrying once.' : 'The retry hit it as well, so this run is being failed.')
  );
}

function runOnce(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', (error) => {
      process.stderr.write(`[ci-run] could not spawn ${command}: ${error.message}\n`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code));
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined) {
    process.stderr.write('usage: node scripts/ci-run.mjs <command> [args...]\n');
    process.exit(2);
  }

  const first = await runOnce(command, args);
  const detail = runnerLevelFailure(first);
  if (detail === null) process.exit(first ?? 1);

  process.stderr.write(`${explain(first, detail, true)}\n`);
  const second = await runOnce(command, args);
  const again = runnerLevelFailure(second);
  if (again !== null) process.stderr.write(`${explain(second, again, false)}\n`);
  process.exit(second ?? 1);
}

// Only when run as a script; importing this for its pure helpers must not execute anything.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  await main();
}
