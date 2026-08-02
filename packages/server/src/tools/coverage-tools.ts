import { z } from 'zod';
import { ReticleCommand, SnapshotMode } from '@reticlehq/core';
import { ReticleTool } from './tool-names.js';
import type { ToolDef, ToolDeps } from './tools.js';
import { asString } from './tools-helpers.js';
import { commandOrThrow, sessionIdShape } from './tool-kit.js';

/**
 * `reticle_coverage` — which interactive controls this session has driven, and which it has not.
 *
 * Every other read here answers a question the agent already thought to ask, which bounds
 * verification by the agent's imagination — the documented weak link. This answers the one question
 * that tells the agent whether to STOP: an agent that exercised 4 of 17 controls and believes it
 * verified the page is exactly the confident-and-wrong case Reticle exists to prevent, and nothing
 * in the tool surface previously contradicted it.
 *
 * Note this is NOT the existing `blindSpots` coverage, which is about what the layer could not SEE
 * (closed shadow roots, cross-origin frames). This is about what the agent did not TOUCH. Both are
 * honesty signals; they answer different questions and neither substitutes for the other.
 *
 * Unadvertised by every profile: it costs nothing per turn and is reached through `reticle_run`.
 */

/** Refs as the snapshot tree spells them: `(ref=e12)`. The tree format is ours, so this is exact. */
const REF_IN_TREE = /\(ref=(e\d+)\)/g;

/** The label a tree line carries before its ref, e.g. `- button "Archive" (ref=e9)`. */
const LINE_WITH_REF = /^\s*-\s*(.+?)\s*\(ref=(e\d+)\)/;

interface Control {
  ref: string;
  label: string;
}

/** Parse the interactive snapshot into {ref,label} controls, preserving document order. */
export function parseControls(tree: string): Control[] {
  const controls: Control[] = [];
  const seen = new Set<string>();
  for (const line of tree.split('\n')) {
    const match = LINE_WITH_REF.exec(line);
    if (match === null) continue;
    const [, label, ref] = match;
    if (label === undefined || ref === undefined || seen.has(ref)) continue;
    seen.add(ref);
    controls.push({ ref, label });
  }
  // A ref can appear on a line this regex does not shape (nested formatting); count it regardless,
  // because under-reporting the denominator would overstate coverage — the one direction that lies.
  for (const match of tree.matchAll(REF_IN_TREE)) {
    const ref = match[1];
    if (ref !== undefined && !seen.has(ref)) {
      seen.add(ref);
      controls.push({ ref, label: '' });
    }
  }
  return controls;
}

export const COVERAGE_TOOLS: ToolDef[] = [
  {
    name: ReticleTool.COVERAGE,
    description:
      'Which interactive controls you have driven this session, and which you have NOT. Returns { total, exercised, untouched:[{ref,label}] } over the controls currently on the page. Use it to decide whether verification is finished: an untouched list that still holds the controls your change affects means you are not done. This is about what you did not TOUCH — distinct from the `coverage` field on an action result, which reports what the layer could not SEE.',
    example: {},
    inputSchema: { ...sessionIdShape },
    outputSchema: {
      total: z.number(),
      exercised: z.number(),
      untouched: z.array(z.object({ ref: z.string(), label: z.string() })),
    },
    handler: async (deps: ToolDeps, args) => {
      const sessionId = asString(args['sessionId']);
      const session = deps.sessions.resolve(sessionId);
      // INTERACTIVE mode is already the "controls only" view, so the denominator is the page's own
      // notion of what can be driven rather than a second, drifting definition maintained here.
      const result = await commandOrThrow(deps, sessionId, ReticleCommand.SNAPSHOT, {
        mode: SnapshotMode.INTERACTIVE,
      });
      const tree = asString((result as Record<string, unknown>)['tree']) ?? '';

      const acted = session.actedRefs();
      const controls = parseControls(tree);
      const untouched = controls.filter((control) => !acted.has(control.ref));
      return {
        total: controls.length,
        exercised: controls.length - untouched.length,
        untouched,
      };
    },
  },
];
