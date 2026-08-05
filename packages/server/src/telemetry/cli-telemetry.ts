/**
 * The one telemetry event a human directly causes: they typed a `reticle` command.
 *
 * Lives in its own module so `cli.ts` stays a dispatcher, and so the `_daemon` exclusion below sits
 * next to the explanation of why it exists rather than buried in a startup function.
 */
import { TelemetryActor, TelemetryEventKind } from '@reticlehq/core';
import { DAEMON_INNER_COMMAND, knownCommand } from '../cli-parse.js';
import { getTelemetry } from './telemetry.js';
import { describeCliFlags } from './argument-shape.js';

/**
 * Report that a person ran a `reticle` subcommand.
 *
 * `_daemon` is EXCLUDED, and that exclusion is the whole point of this function. `reticle mcp` and
 * `reticle serve` start the daemon by re-running this very binary, so the child re-entered the CLI
 * entry point and emitted a second event for what a person experienced as ONE action. The old
 * `invoke` metric was therefore inflated ~2x — and inflated worst on the agent-driven sessions that
 * matter most, while one-shot commands like `version` counted once. That skewed the RATIO between
 * commands, not merely the scale, which is the kind of error you cannot correct for after the fact.
 * The daemon\'s own lifecycle is already reported by `daemon_started` / `daemon_stopped`; a spawned
 * daemon is not a CLI run.
 */
export function reportCliRun(argv: readonly string[]): void {
  const firstArg = argv[0];
  if (firstArg === DAEMON_INNER_COMMAND) return;
  const telemetry = getTelemetry();
  // `detach` so a quick command (`version`/`gate`) exits immediately instead of waiting out the POST.
  if (telemetry.firstRun)
    void telemetry.emit(TelemetryEventKind.RETICLE_INSTALLED, { detach: true });
  void telemetry.emit(TelemetryEventKind.CLI_COMMAND_RUN, {
    detach: true,
    actor: TelemetryActor.HUMAN,
    // A fixed, low-cardinality vocabulary WE define, so it is safe to send whole and it is the closest
    // honest read we have on intent: `verify` and `gate` mean something very different from `status`.
    // An unrecognized first arg reports as `unknown` rather than being echoed — an echo would put
    // whatever someone mistyped, including a path or a URL, straight onto the wire.
    command: knownCommand(firstArg),
    // Which flags were PRESENT, by name only — never their values. `--http-token` alone makes that
    // rule absolute rather than case-by-case; `--drive` and `--storage-state` carry a URL and a path.
    flags: describeCliFlags(argv),
  });
}
