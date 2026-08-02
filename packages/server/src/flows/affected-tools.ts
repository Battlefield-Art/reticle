import { z } from 'zod';
import { ReticleTool } from '../tools/tool-names.js';
import type { ToolDef, ToolDeps } from '../tools/tools.js';
import { loadNamedFlows, resolveChangedFiles } from '../cli-flow-commands.js';
import { affectedSavedFlows } from './flow-sources.js';

/**
 * `reticle_affected` — which saved flows must re-verify for a set of changed files.
 *
 * This logic already existed as `reticle affected`, deliberately kept off the MCP surface because an
 * advertised tool costs tokens on every turn whether or not it is used. That reasoning is right, and
 * this does not change it: the tool is NOT advertised by any profile. It is reachable through
 * `reticle_run`, so it costs nothing per turn and is still discoverable via `reticle_tools`.
 *
 * What the reasoning missed is who holds the question. The AGENT is the one that just edited files
 * and has to decide what to re-check; a shell command it may not be able to run is not an answer for
 * an MCP client that has no shell. Leaving it CLI-only meant the party with the diff could not ask
 * the party with the index.
 *
 * Unknown-provenance flows are returned as affected (fail-safe) AND listed separately, so "re-verify
 * this" is never confused with "this definitely touches your change".
 */
export const AFFECTED_TOOLS: ToolDef[] = [
  {
    name: ReticleTool.AFFECTED,
    description:
      'Which saved flows must re-verify for a set of changed files. Pass the files you edited (and/or `since` for a git ref to diff against). Returns { changedFiles, affected, unknownProvenance } — `affected` is what to re-run, and `unknownProvenance` are flows included only because Reticle cannot tell which sources they cover, so they are re-verified by default rather than silently skipped.',
    example: { files: ['src/App.tsx'] },
    inputSchema: {
      files: z
        .array(z.string())
        .optional()
        .describe('Changed file paths, repo-relative (e.g. ["src/App.tsx"]).'),
      since: z
        .string()
        .optional()
        .describe('Git ref to diff against (e.g. "HEAD~1", "main"). Unioned with `files`.'),
    },
    outputSchema: {
      changedFiles: z.array(z.string()),
      affected: z.array(z.string()),
      unknownProvenance: z.array(z.string()),
    },
    handler: async (deps: ToolDeps, args) => {
      const files = Array.isArray(args['files'])
        ? (args['files'] as unknown[]).filter((f): f is string => typeof f === 'string')
        : [];
      const since = typeof args['since'] === 'string' ? args['since'] : undefined;
      const changedFiles = await resolveChangedFiles(files, since);
      const flows = await loadNamedFlows(deps.fs, deps.reticleRoot);
      const result = affectedSavedFlows(flows, changedFiles);
      return { changedFiles, ...result };
    },
  },
];
