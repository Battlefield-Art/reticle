/**
 * The self-update command pair — `reticle update` and `reticle rollback`.
 *
 * Split out of cli.ts, which sits at the 600-line cap: these two are one cohesive unit (swap the
 * installed version, restart) and the file they came from is the CLI's dispatch table, which grows
 * for entirely different reasons.
 */
import { checkForUpdate } from './update/update-checker.js';
import { updateTarget } from './update/update-nudge.js';
import { applyUpdate, rollback } from './update/updater.js';
import { SERVER_VERSION } from './server-version.js';
import { log } from './log.js';

/** `reticle update` — install the latest server version and restart. */
export async function handleUpdate(): Promise<void> {
  try {
    const manifest = await checkForUpdate(SERVER_VERSION, () => Date.now());
    // Direction, not inequality: the registry being DIFFERENT is not the registry being newer, and
    // the old gate happily installed a downgrade — reported by a user. See updateTarget.
    const target = updateTarget(manifest);
    if (target === undefined) {
      log('reticle_update', {
        ok: false,
        message: 'already on the latest version',
        version: SERVER_VERSION,
      });
      return;
    }
    log('reticle_update', { ok: true, from: SERVER_VERSION, to: target });
    await applyUpdate(target); // calls process.exit; Claude Code restarts
  } catch (error) {
    log('reticle_update_failed', { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}

/** `reticle rollback` — restore the previous server version and restart. */
export async function handleRollback(): Promise<void> {
  try {
    await rollback(); // calls process.exit
  } catch (error) {
    log('reticle_rollback_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}
