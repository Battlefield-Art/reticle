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
