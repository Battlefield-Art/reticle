/**
 * What to say when an agent calls a real Reticle tool that this profile does not advertise.
 *
 * The default profile advertises 16 of 46 tools. That is deliberate — every advertised tool's schema
 * is re-sent on every turn, and the trim is most of why `hybrid` is cheap — and the other 30 stay
 * fully callable through `reticle_run`, which `profile-reachability.test.ts` guards.
 *
 * The gap was in the ERROR. The MCP SDK answers `Tool <name> not found`, which is indistinguishable
 * from "this tool does not exist", so an agent that trusts it stops trying. Reported from a real
 * sweep of a Next app-router project: the first pass scored 25 failures that were nothing of the
 * kind — every one of those tools worked through `reticle_run` seconds later.
 *
 * So: a name Reticle owns never comes back as "not found". It comes back with the call that works
 * and the switch that makes it stop being necessary.
 */
import { ReticleTool } from './tool-names.js';
import { TOOL_SURFACE, TOOL_PROFILE_ENV } from './tool-surface.js';
import { mergedNameRedirect, mergedNameMessage } from './merged-name-redirect.js';

/**
 * Guidance for `name`, or undefined when there is nothing useful to add — the tool IS advertised (so
 * any error belongs to the call itself), or the name is not ours to explain.
 */
export function unadvertisedToolHelp(
  name: string,
  advertised: ReadonlySet<string>,
  known: ReadonlySet<string>,
): string | undefined {
  if (advertised.has(name)) return undefined;
  // A name that MOVED gets the move, not a profile lecture — it is not un-advertised, it is gone.
  const moved = mergedNameRedirect(name);
  if (moved !== undefined) return mergedNameMessage(name, moved);
  if (!known.has(name)) return undefined;
  return (
    `${name} exists and works, but is not advertised under this tool profile — the schemas for all ` +
    `tools are re-sent every turn, so the default advertises a subset and keeps the rest one call ` +
    `away. It is NOT missing: invoke it with ` +
    `${ReticleTool.RUN} { tool: "${name}", args: { ... } }. ` +
    `Call ${ReticleTool.TOOLS} { names: ["${name}"] } for its parameters. ` +
    `If you need it repeatedly, set ${TOOL_PROFILE_ENV}=${TOOL_SURFACE.ALL} to advertise ` +
    `every tool directly.`
  );
}
