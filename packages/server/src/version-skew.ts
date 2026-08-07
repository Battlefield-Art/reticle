/**
 * Name a version-skewed SDK/daemon pair, because the alternative is silence.
 *
 * `protocolVersion` catches an incompatible WIRE FORMAT and nothing else. An older SDK against a
 * newer daemon agrees on the protocol, connects, and then disagrees about tool behaviour — a user hit
 * exactly that with a 2.2.1 SDK (pnpm resolved it from a stale metadata cache) against a 2.3.0
 * daemon, and all they saw was `-32000`. Nothing on either side said "these are different versions".
 *
 * Deliberately reports NOTHING when the SDK version is unknown. A hand-wired connect has no build
 * plugin to supply one, and reporting "in sync" for an unknown is the same silence in a green hat.
 */
/**
 * The CLI and the daemon it attached to.
 *
 * `ensureDaemon` probes the port and attaches to whatever is listening. A daemon outlives every
 * agent on purpose, so after an upgrade the NEW cli talks to the OLD daemon and every fix in the new
 * package is simply absent — silently, with the version on disk saying otherwise. Hit while QA-ing
 * this build: three fixes were rebuilt, passed their unit tests, and did not appear over MCP.
 *
 * Undefined when the daemon reports no version: a daemon older than this field is not evidence of a
 * mismatch, and crying skew on every in-flight upgrade trains the reader to ignore the message.
 */
export function describeDaemonSkew(
  daemonVersion: string | undefined,
  cliVersion: string,
): string | undefined {
  if (daemonVersion === undefined || daemonVersion.length === 0) return undefined;
  if (daemonVersion === cliVersion) return undefined;
  return (
    `version skew: the daemon already running on this port is ${daemonVersion}, but this CLI is ` +
    `${cliVersion}. A daemon outlives the agents attached to it, so it is still serving its OWN ` +
    `code — anything fixed in ${cliVersion} is absent until it restarts. Run \`reticle stop\` and ` +
    `retry to replace it (other agents attached to that daemon will need to reconnect).`
  );
}

export function describeVersionSkew(
  sdkVersion: string | undefined,
  daemonVersion: string,
): string | undefined {
  if (sdkVersion === undefined || sdkVersion.length === 0) return undefined;
  if (sdkVersion === daemonVersion) return undefined;
  return (
    `version skew: this page runs @reticlehq/* ${sdkVersion} but the daemon is ${daemonVersion}. ` +
    `They connect and then disagree about tool behaviour, which usually surfaces as a bare -32000. ` +
    `Install the matching SDK (\`npm i -D @reticlehq/react@${daemonVersion}\`) or run \`reticle update\`, ` +
    `then restart your dev server.`
  );
}
