/**
 * Which published route brought an install in.
 *
 * Four install routes ship at once and none of them could be told apart, so every question about
 * where distribution effort is working had no data behind it at all.
 *
 * ONE mechanism: an environment variable a channel sets on itself. Everything else that looked like
 * a signal turned out not to be one — see `InstallSource` in core for why `npm_config_user_agent`,
 * a `.claude-plugin/` directory and an installed skill folder all fail to separate these routes.
 *
 * WHICH CHANNELS ARE GENUINELY DETECTABLE TODAY, so nobody later reads a small `unknown` as success:
 *  - `plugin` — real. The Claude Code plugin registers the MCP server itself and can set the marker
 *    in that server's `env`, so it is carried by the process without anybody typing anything.
 *  - `skill_file` / `npx_skill` / `docs_site` / `readme` — real ONLY where that channel's own copy
 *    of the install command carries the marker. Each is a separately published artifact, so a copy
 *    that has not been updated is indistinguishable from no channel at all.
 *  - `cli_direct` — NOT detectable. Nobody types a marker to say they typed a command. It exists so
 *    a wrapper can declare it, and until something does, a direct install reports `unknown`.
 *
 * `unknown` is therefore expected to be the largest bucket for as long as the marker is spreading,
 * and shrinking it is a distribution job, never a classifier job. A guessed attribution is worse
 * than none: it is the number distribution decisions get steered on, and a guess and a measurement
 * are indistinguishable once they are in the same column.
 */
import { InstallSource } from '@reticlehq/core';

/** The one marker. Set by a channel on the process that runs the install. */
export const INSTALL_SOURCE_ENV = 'RETICLE_INSTALL_SOURCE';

const KNOWN: ReadonlySet<string> = new Set(Object.values(InstallSource));

/**
 * The declared install source, or `unknown`.
 *
 * Narrowed against the closed list rather than echoed: an echo would forward whatever somebody
 * exported — a path, a URL, a campaign string — straight onto the wire, which is the rule this
 * whole contract is built on. Trimmed and lowercased first, because the marker travels through
 * shell snippets and copy-paste, and `Skill_File` is the same channel as `skill_file`.
 */
export function resolveInstallSource(env: NodeJS.ProcessEnv = process.env): InstallSource {
  const declared = (env[INSTALL_SOURCE_ENV] ?? '').trim().toLowerCase();
  return KNOWN.has(declared) ? (declared as InstallSource) : InstallSource.UNKNOWN;
}
