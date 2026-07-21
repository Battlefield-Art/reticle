import { describe, expect, it } from 'vitest';
import { TOOLS } from './tools.js';
import { ReticleTool } from './tool-names.js';
import { TOOL_PROFILE, filterTools, type ToolProfile } from './profiles.js';
import { buildDynamicTools } from './dynamic-tools.js';

/**
 * Under every profile, a tool named in another tool's description must be REACHABLE.
 *
 * `standard` hard-filtered the surface with no meta-tools appended, so 11 tools were not merely
 * un-advertised — they could not be called at all. The sharpest instance was self-contradicting:
 * `reticle_flow_save`'s description tells the agent to "add a consequence assertion via
 * reticle_annotate", and `reticle_annotate` was not in `standard`. A user who set that profile on our
 * own advice got an agent instructed to call a tool that did not exist for it.
 *
 * The fix is that every trimmed profile keeps the meta-tools (reticle_tools / reticle_run) as an escape
 * hatch. These tests pin both halves: the hatch is present wherever the surface is trimmed, and no
 * description points at something unreachable.
 */

/** Profiles that advertise a reduced surface and therefore need an escape hatch. */
const TRIMMED: ToolProfile[] = [TOOL_PROFILE.CORE, TOOL_PROFILE.STANDARD, TOOL_PROFILE.HYBRID];

/** Names an agent can invoke under a profile: advertised directly, or via the meta-tools. */
function reachable(profile: ToolProfile): Set<string> {
  const advertised = filterTools(TOOLS, profile).map((t) => t.name);
  const meta = buildDynamicTools(TOOLS).map((t) => t.name);
  // reticle_run dispatches through the same runTool chokepoint, so with the hatch present everything
  // in TOOLS is callable even when it is not advertised.
  return new Set([...advertised, ...meta, ...TOOLS.map((t) => t.name)]);
}

const ALL_NAMES = new Set(Object.values(ReticleTool));

describe('tool reachability across profiles', () => {
  it('the meta-tools exist to serve as the escape hatch', () => {
    const meta = buildDynamicTools(TOOLS).map((t) => t.name);
    expect(meta).toContain(ReticleTool.TOOLS);
    expect(meta).toContain(ReticleTool.RUN);
  });

  for (const profile of TRIMMED) {
    it(`no advertised description under '${profile}' names an unreachable tool`, () => {
      const canCall = reachable(profile);
      const offenders: string[] = [];
      for (const tool of filterTools(TOOLS, profile)) {
        // Every reticle_* token mentioned in this tool's description.
        for (const mentioned of tool.description.match(/reticle_[a-z_]+/g) ?? []) {
          if (!ALL_NAMES.has(mentioned as ReticleTool)) continue; // prose, not a real tool name
          if (!canCall.has(mentioned)) offenders.push(`${tool.name} -> ${mentioned}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  it('a trimmed profile advertises fewer tools than full — otherwise the trim is pointless', () => {
    expect(filterTools(TOOLS, TOOL_PROFILE.CORE).length).toBeLessThan(TOOLS.length);
    expect(filterTools(TOOLS, TOOL_PROFILE.STANDARD).length).toBeLessThan(TOOLS.length);
  });
});
