import { z } from 'zod';
import type { ToolDef, ToolDeps } from './tool-kit.js';

/**
 * Surface consolidation (W10.3). Tool definitions are re-sent to the model EVERY turn, so the named-def
 * count is a per-turn tax multiplied by loop length. This merges a family of sibling tools
 * (`baseline_save`/`baseline_list`/`diff`) into one action-dispatched tool (`reticle_baseline {action}`)
 * WITHOUT rewriting any handler — each original handler is kept verbatim and selected by `action`, so a
 * merge cannot change behavior, only the advertised shape.
 *
 * The merged input schema is `{ action }` plus the union of the members' fields, each made optional
 * (different actions need different fields). Every handler already narrows its own args, so validation
 * strength is unchanged in practice.
 */
export interface MergeSpec {
  name: string;
  description: string;
  /** action value → the original tool whose handler serves it. */
  actions: Record<string, ToolDef>;
}

/** The union of member input shapes, every field optional so one schema serves every action. */
function unionShape(actions: Record<string, ToolDef>): z.ZodRawShape {
  const shape: z.ZodRawShape = {};
  for (const tool of Object.values(actions)) {
    for (const [key, schema] of Object.entries(tool.inputSchema)) {
      // First definition wins; siblings share field names/meanings by construction.
      shape[key] ??= schema.isOptional() ? schema : schema.optional();
    }
  }
  return shape;
}

export function mergeTools(spec: MergeSpec): ToolDef {
  const actionNames = Object.keys(spec.actions);
  if (actionNames.length === 0) throw new Error(`mergeTools(${spec.name}): no actions`);
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: {
      action: z
        .enum(actionNames as [string, ...string[]])
        .describe(`Which operation to run: ${actionNames.join(' | ')}.`),
      ...unionShape(spec.actions),
    },
    handler: (deps: ToolDeps, args: Record<string, unknown>) => {
      const action = args['action'];
      const chosen = typeof action === 'string' ? spec.actions[action] : undefined;
      if (chosen === undefined) {
        return Promise.resolve({
          error: `unknown action '${String(action)}' for ${spec.name}`,
          expected: actionNames,
        });
      }
      return chosen.handler(deps, args);
    },
  };
}
