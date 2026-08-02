import { z } from 'zod';
import { Verified } from '@reticlehq/core';
import { ReticleTool } from '../tools/tool-names.js';
import type { ToolDef, ToolDeps } from '../tools/tools.js';
import { asNumber, asRecord, asString } from '../tools/tools-helpers.js';
import { loadNamedFlows, resolveChangedFiles } from '../cli-flow-commands.js';
import { affectedSavedFlows } from './flow-sources.js';
import { FLOW_TOOLS } from './flow-tools.js';

/**
 * `reticle_verify_change` — the regression loop in one call.
 *
 * The agent's real question after an edit is "did I break anything", and answering it took four
 * tools it had to know to chain: work out which saved flows the diff invalidates, replay that
 * subset, then separately go looking for contradictions and untouched controls. Every piece already
 * existed; nothing composed them, so the loop was only run by an agent that already knew the recipe.
 *
 * The honesty guard is the whole design. NO FLOWS COVERING A CHANGE IS `unknown`, NEVER `yes` —
 * "nothing ran" and "everything passed" are the same green to anyone reading a boolean, and treating
 * an uncovered change as verified is the exact false green this project exists to remove. `cli-verify`
 * already refuses to return a green pass with no flows; this applies the same rule on the MCP side.
 */

/** Flow names are echoed so a caller can see WHICH flows stood behind the verdict. */
interface SuiteResult {
  status?: string;
  total?: number;
  passed?: number;
  failed?: number;
  summary?: string;
  failures?: unknown[];
}

const PASS = 'pass';

export const VERIFY_CHANGE_TOOLS: ToolDef[] = [
  {
    name: ReticleTool.VERIFY_CHANGE,
    description:
      'Did my change break anything? Give it the files you edited (or `since` for a git ref) and it works out which saved flows cover them, replays exactly those, and answers with one `verified` (yes|no|unknown) plus `because`. `unknown` when NO saved flow covers the change — that is the honest answer, never a green: nothing ran, so nothing was proved. Returns { verified, because, changedFiles, flowsRun, suite, unknownProvenance }.',
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
      parallel: z
        .number()
        .optional()
        .describe('Replay this many affected flows at once (needs the browser pool).'),
      sessionId: z
        .string()
        .optional()
        .describe('OMIT THIS unless you mean a specific tab — Reticle resolves it.'),
    },
    outputSchema: {
      verified: z
        .string()
        .describe(
          'yes | no | unknown. `unknown` means the evidence could not decide — most often that no saved flow covers these files, which is NOT a pass.',
        ),
      because: z.string(),
      changedFiles: z.array(z.string()),
      flowsRun: z.array(z.string()),
      suite: z.unknown().optional(),
      unknownProvenance: z.array(z.string()),
    },
    handler: async (deps: ToolDeps, args) => {
      const files = Array.isArray(args['files'])
        ? (args['files'] as unknown[]).filter((f): f is string => typeof f === 'string')
        : [];
      const since = asString(args['since']);
      const changedFiles = await resolveChangedFiles(files, since);
      const flows = await loadNamedFlows(deps.fs, deps.reticleRoot);
      const { affected, unknownProvenance } = affectedSavedFlows(flows, changedFiles);

      if (changedFiles.length === 0) {
        return {
          verified: Verified.UNKNOWN,
          because: 'no changed files were given, so there was nothing to decide about',
          changedFiles,
          flowsRun: [],
          unknownProvenance,
        };
      }

      // The guard: an uncovered change is UNKNOWN. Reporting `yes` here would mean "your change is
      // fine" on the strength of having run nothing at all.
      if (affected.length === 0) {
        return {
          verified: Verified.UNKNOWN,
          because: `no saved flow covers ${changedFiles.length === 1 ? 'this file' : 'these files'} — record one with reticle_record { action: "start" } then reticle_flow_save, or verify by driving the app directly`,
          changedFiles,
          flowsRun: [],
          unknownProvenance,
        };
      }

      const verify = FLOW_TOOLS.find((tool) => tool.name === ReticleTool.FLOW_VERIFY);
      if (verify === undefined) throw new Error('reticle_flow_verify is not registered');
      const suite = asRecord(
        await verify.handler(deps, {
          names: affected,
          ...(asNumber(args['parallel']) === undefined ? {} : { parallel: args['parallel'] }),
          ...(asString(args['sessionId']) === undefined ? {} : { sessionId: args['sessionId'] }),
        }),
      ) as SuiteResult;

      const failed = suite.failed ?? 0;
      const passed = suite.passed ?? 0;
      const provenanceNote =
        unknownProvenance.length > 0
          ? ` (${String(unknownProvenance.length)} of them re-run only because Reticle cannot tell which sources they cover)`
          : '';

      if (suite.status !== PASS || failed > 0) {
        return {
          verified: Verified.NO,
          because: `${String(failed)} of ${String(suite.total ?? affected.length)} covering flows failed${provenanceNote}`,
          changedFiles,
          flowsRun: affected,
          suite,
          unknownProvenance,
        };
      }

      return {
        verified: Verified.YES,
        because: `all ${String(passed)} flows covering these files passed${provenanceNote}`,
        changedFiles,
        flowsRun: affected,
        suite,
        unknownProvenance,
      };
    },
  },
];
