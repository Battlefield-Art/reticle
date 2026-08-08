import { z } from 'zod';
import type { ToolDef, ToolDeps } from './tools.js';
import { runTool } from './invoke-tool.js';
import { buildErrorPayload } from './error-recovery.js';
import { mergedNameRedirect, mergedNameMessage } from './merged-name-redirect.js';
import { ReticleTool } from './tool-names.js';
import { TOOL_PROFILE_ENV, type ToolProfileOrigin } from './profiles.js';
import { getSessionMetrics } from '../telemetry/session-metrics.js';

/**
 * On-demand tool loading for MCP — the answer to the per-turn tool-definition tax.
 *
 * A normal MCP server advertises every tool's full description + schema, and the client re-sends
 * all of them to the model on EVERY turn. Measured here: Reticle at ~5.6k–14.6k tokens/turn just for
 * definitions, which dominates a real agent loop and only grows as the tool surface grows.
 *
 * The `dynamic` profile advertises just TWO meta-tools (~hundreds of tokens, fixed regardless of
 * how many real tools exist):
 * reticle_tools — discover. No args ⇒ a compact catalog (name + one-line summary) of every tool.
 * names:[...] ⇒ full description + params for just those tools, loaded on demand.
 * reticle_run — invoke any tool by name. On a bad/unknown call it returns that tool's params as a
 * hint, so the model self-corrects without ever needing the schema up front.
 *
 * The model lists once, loads the 2–3 tools it actually needs, and calls them — paying for tool
 * detail only when used, not every turn. Works with any MCP client (no client-side support needed).
 */

/** First sentence (purpose) of a description — keeps the catalog one line per tool. */
function firstSentence(description: string): string {
  const nl = description.indexOf('\n');
  const base = nl >= 0 ? description.slice(0, nl) : description;
  const dot = base.search(/\.\s/);
  const sentence = dot >= 0 ? base.slice(0, dot + 1) : base;
  return sentence.length > 140 ? `${sentence.slice(0, 139)}…` : sentence;
}

interface ParamInfo {
  name: string;
  required: boolean;
  description: string;
}

/** Compact param list from a tool's zod shape — name/required/description (the description already
 * carries the type and any enum hints, so no JSON-Schema machinery is needed). */
function paramInfo(shape: z.ZodRawShape): ParamInfo[] {
  return Object.entries(shape).map(([name, schema]) => ({
    name,
    required: !schema.isOptional(),
    description: schema.description ?? '',
  }));
}

/**
 * Build the two dynamic meta-tools over the full tool table. `reticle_run` dispatches through the same
 * `runTool` chokepoint as a direct call, so session-health splicing and every other invariant hold.
 */
export function buildDynamicTools(allTools: ToolDef[], profile?: ToolProfileOrigin): ToolDef[] {
  const byName = new Map(allTools.map((t) => [t.name, t]));
  // The profile is a DAEMON-startup decision, so an agent that exported RETICLE_TOOL_PROFILE into its
  // own environment sees no change and has, until now, no way to tell. Reported with the catalog.
  const profileBlock =
    profile === undefined
      ? {}
      : {
          profile: {
            ...profile,
            // NOT "every tool is reachable via reticle_run under any profile" — measured false:
            // `full` advertises all 46 tools DIRECTLY and carries no meta-tools at all, so
            // reticle_run does not exist there. Saying otherwise sends the agent to a tool the
            // profile does not have.
            note: `The profile is read once at daemon startup — change ${TOOL_PROFILE_ENV} and restart the daemon, or it has no effect. Under this profile every unadvertised tool is reachable through reticle_run; under \`full\` there are no meta-tools because every tool is advertised directly.`,
          },
        };

  const reticleTools: ToolDef = {
    name: ReticleTool.TOOLS,
    description:
      'Discover Reticle tools on demand. Call with no arguments to list every tool (name + one-line summary); call with names:["reticle_network", …] to load full descriptions and parameters for specific tools. Then invoke them with reticle_run. This avoids paying for every tool definition on every turn. To make a verification REUSABLE (record once, replay free forever), the flow workflow lives here: reticle_record{action:"start"} → act → reticle_flow_save → reticle_flow_verify (and reticle_flow_heal on drift). Load those names when you want to save or re-run a flow.',
    inputSchema: {
      names: z
        .array(z.string())
        .optional()
        .describe('Tool names to load full params for. Omit to list all tools with summaries.'),
    },
    handler: (_deps: ToolDeps, args: Record<string, unknown>) => {
      const names = Array.isArray(args['names'])
        ? (args['names'] as unknown[]).filter((n): n is string => 'string' === typeof n)
        : undefined;
      if (names === undefined || 0 === names.length) {
        return Promise.resolve({
          tools: allTools.map((t) => ({ name: t.name, summary: firstSentence(t.description) })),
          ...profileBlock,
          next: 'Load params with reticle_tools { names:[…] }, then call reticle_run { tool, args }.',
        });
      }
      return Promise.resolve({
        tools: names.map((n) => {
          const t = byName.get(n);
          return t === undefined
            ? { name: n, error: 'unknown tool' }
            : { name: n, description: t.description, params: paramInfo(t.inputSchema) };
        }),
      });
    },
  };

  const reticleRun: ToolDef = {
    name: ReticleTool.RUN,
    description:
      "Invoke any Reticle tool by name (discover names/params first with reticle_tools). On an unknown tool or bad arguments it returns the available names or the tool's params, so you can correct and retry.",
    inputSchema: {
      tool: z.string().describe('Tool name to invoke, e.g. reticle_network.'),
      args: z.record(z.unknown()).optional().describe('Arguments object for that tool.'),
    },
    handler: async (deps: ToolDeps, args: Record<string, unknown>) => {
      const name = 'string' === typeof args['tool'] ? args['tool'] : '';
      const callArgs =
        'object' === typeof args['args'] && args['args'] !== null
          ? (args['args'] as Record<string, unknown>)
          : {};
      const target = byName.get(name);
      if (target === undefined) {
        // A non-zero count here means our advertised surface is confusing the agent — it reached for
        // something it believed existed. That is a docs/naming defect, and it was invisible.
        getSessionMetrics().recordUnknownTool();
        // ...and for 22 of those names the capability DOES exist, it just moved when tools merged.
        // Answering "unknown tool" there is simply wrong; see merged-name-redirect.
        const moved = mergedNameRedirect(name);
        if (moved !== undefined) {
          return {
            error: mergedNameMessage(name, moved),
            tool: moved.tool,
            ...(moved.action === undefined ? {} : { action: moved.action }),
          };
        }
        return { error: `unknown tool '${name}'`, available: allTools.map((t) => t.name) };
      }
      // The escape hatch is where a typo is MOST likely, because an unadvertised tool's parameters
      // are not in front of the agent at all — and it is the one path the SDK's own validation never
      // sees, since `reticle_run`'s own args (`tool`, `args`) are perfectly valid. Left unchecked,
      // `reticle_run { tool: "reticle_clock", args: { action: "freeze" } }` returned
      // `{"frozen":false}`: a well-formed answer to a question nobody asked.
      const declared = new Set(Object.keys(target.inputSchema));
      const unknown = Object.keys(callArgs).filter((key) => !declared.has(key));
      if (unknown.length > 0) {
        return {
          error: `unknown ${1 === unknown.length ? 'parameter' : 'parameters'} for ${name}: ${unknown.join(', ')} — NOT applied, so any result would be an answer to a different question`,
          tool: name,
          params: paramInfo(target.inputSchema),
          ...(target.example === undefined ? {} : { example: target.example }),
          hint: 'fix the arguments and call reticle_run again',
        };
      }
      try {
        return await runTool(target, deps, callArgs);
      } catch (error) {
        // The SAME payload the direct tool path builds — recovery included. Answering every failure
        // with "fix the arguments" threw that away, and under the default profile nearly every tool
        // is reached through here: a stale ref, a paused session, a missing pairing token all came
        // back as the agent's arguments being wrong, which is advice that spends the retry.
        const message = error instanceof Error ? error.message : String(error);
        return { ...buildErrorPayload(message), tool: name };
      }
    },
  };

  return [reticleTools, reticleRun];
}
