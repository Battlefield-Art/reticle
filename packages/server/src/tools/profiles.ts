import { ReticleTool } from './tool-names.js';
import type { ToolDef } from './tools.js';

/**
 * Which MCP tool surface to expose. The advertised tool DEFINITIONS are re-sent to the model on
 * every turn, so a smaller surface is a per-turn token saving that compounds across a loop. Fewer
 * tools also makes the model wander less (fewer turns, higher accuracy). See bench/agent-loop-and-replay.md.
 *
 * MEASURED surface sizes (assert them with profile-reachability.test.ts rather than trusting prose —
 * every count previously written here was wrong, and the token figures below derive from those counts):
 *   core 15 · standard 32 · hybrid 15 · full 43 · dynamic 2
 * core and hybrid are both 14 because a trimmed profile now also advertises the two meta-tools, which
 * is what keeps an un-advertised tool reachable through reticle_run.
 *
 * core — the verify loop a coding agent actually needs: navigate→look→act→observe→assert,
 * WITH direct network + console + state observability (the highest-signal checks).
 * The recommended profile for agent-driven verification.
 * standard — core + common extras (inspect, sequences, animations, flows, session lifecycle,
 * scroll, baselines, …). For agents that need more than the bare loop.
 * hybrid — THE DEFAULT: core verify+oracle tools advertised directly + 2 meta-tools for on-demand
 * reach to everything else. Core accuracy/detection at ~64% less schema tax than full.
 * full — all tools advertised directly. Opt in via RETICLE_TOOL_PROFILE=full for hard-call scripts.
 */
export const TOOL_PROFILE = {
  /** dynamic — advertise only 2 meta-tools (reticle_tools + reticle_run); load real tools on demand.
   * Fixed ~hundreds of tokens/turn regardless of how many tools exist. See dynamic-tools.ts. */
  DYNAMIC: 'dynamic',
  /** hybrid — the core verify tools advertised directly (so the agent acts reliably) PLUS the 2
   * meta-tools for on-demand reach to every other tool. Core accuracy + full reach at ~core cost. */
  HYBRID: 'hybrid',
  CORE: 'core',
  STANDARD: 'standard',
  FULL: 'full',
} as const;
export type ToolProfile = (typeof TOOL_PROFILE)[keyof typeof TOOL_PROFILE];

export const TOOL_PROFILE_ENV = 'RETICLE_TOOL_PROFILE';

// The set an agent needs to verify a change end-to-end. Tool DEFINITIONS are re-sent every turn, so a
// smaller surface compounds.
//
// MEASURED per-turn `tools/list` cost — the bytes an MCP client re-sends EVERY turn — taken off the
// real wire (spawn `mcp`, read tools/list, measure the serialized result), not estimated:
//
//   dynamic     2 tools    1,531 B   ~383 tok/turn
//   core       15 tools   14,104 B  ~3,526 tok/turn
//   hybrid     15 tools   14,104 B  ~3,526 tok/turn
//   standard   32 tools   26,769 B  ~6,692 tok/turn
//   full       43 tools  105,061 B ~26,265 tok/turn
//
// These REPLACE the previous figures (core 6,479 / standard 13,951 / full 20,441), which the comment
// itself flagged as stale. Two of the three moved in opposite directions, which is why re-measuring
// mattered: the lean profiles got much CHEAPER because they now drop the advertised outputSchema,
// while `full` got much more EXPENSIVE because it still carries it — the gap between lean and full is
// 7.4x, not the ~3x the old numbers implied.
//
// Where the remaining cost sits, on the hybrid default: inputSchema is 76% of the payload (parameter
// descriptions are half of that), tool descriptions are 12%, and outputSchema is already ~0. So the
// next real saving is in parameter prose, not in dropping more tools.
//
// There is a floor, though: an 8-tool cut (dropping act/navigate/wait_for/sessions) was MEASURED to
// regress real-agent accuracy 5/5 -> 3/5, because the model loses scaffolding and wanders on harder
// flows. Direct network/console stay (far more discoverable than observe-with-filters -> fewer turns,
// better verdicts).
//
// Evidence status: the 5/5 figure came from a single gpt-4o run and is STALE as a justification.
// Current-model evidence is indirect but real — the cost-delta run (bench/fix-loop/COST-DELTA.md)
// drove this hybrid default on a current model and fixed 4/4 cells with ~25% FEWER tool calls than
// the baseline. A formal core-vs-hybrid A/B on a current model is still UNRUN; do not quote the 5/5
// number as if it were current. See bench/agent-loop-and-replay.md.
export const CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  ReticleTool.SESSIONS,
  ReticleTool.NAVIGATE,
  ReticleTool.SNAPSHOT,
  ReticleTool.QUERY,
  ReticleTool.ACT,
  ReticleTool.ACT_AND_WAIT,
  ReticleTool.OBSERVE,
  ReticleTool.NETWORK,
  ReticleTool.CONSOLE,
  ReticleTool.WAIT_FOR,
  ReticleTool.ASSERT,
  ReticleTool.STATE,
  // INSPECT is what turns a finding into an EDIT: it maps a DOM node to `src/App.tsx:104`. Finding a
  // bug is half the job; knowing which file to open is the half that makes the agent useful, and it
  // is the one capability here with no substitute in any other verification tool. It sat in
  // `standard`, so under the default profile an agent had to already know it existed and reach it
  // through reticle_run — which, observed over a full 43-tool drive, means it never gets called.
  // The measured floor that justifies a lean core was about CUTTING to 8 (accuracy 5/5 → 3/5), not
  // about holding at 12; one tool of schema tax to close the find→fix loop is the right trade.
  ReticleTool.INSPECT,
]);

const STANDARD_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...CORE_TOOL_NAMES,
  ReticleTool.ACT_SEQUENCE,
  ReticleTool.NETWORK,
  ReticleTool.CONSOLE,
  ReticleTool.ANIMATIONS,
  ReticleTool.FLOW_SAVE,
  ReticleTool.FLOW_REPLAY,
  ReticleTool.FLOW_VERIFY,
  ReticleTool.FLOW_HEAL,
  ReticleTool.SESSION, // merged lifecycle/human-channel family
  ReticleTool.FLOW, // merged flow list/load/delete
  ReticleTool.RECORD, // merged record start/stop
  ReticleTool.BASELINE, // merged baseline save/list/diff
  ReticleTool.SCROLL_TO,
  ReticleTool.CRAWL,
  ReticleTool.REPLAY,
  ReticleTool.EXPLORE,
  ReticleTool.CONTRACT_SAVE,
  ReticleTool.NETWORK_MOCK,
  ReticleTool.VIEWPORT,
]);

export function resolveToolProfile(explicit?: string): ToolProfile {
  const raw = explicit ?? process.env[TOOL_PROFILE_ENV];
  if (raw === TOOL_PROFILE.DYNAMIC) return TOOL_PROFILE.DYNAMIC;
  if (raw === TOOL_PROFILE.HYBRID) return TOOL_PROFILE.HYBRID;
  if (raw === TOOL_PROFILE.CORE) return TOOL_PROFILE.CORE;
  if (raw === TOOL_PROFILE.STANDARD) return TOOL_PROFILE.STANDARD;
  if (raw === TOOL_PROFILE.FULL) return TOOL_PROFILE.FULL;
  // Default: hybrid — the core verify+oracle tools advertised directly (no detection loss, verified
  // 10/10 on the regression bench) PLUS the 2 meta-tools for on-demand reach to every other tool. ~64%
  // less per-turn schema than `full` at the same accuracy. Explicit `full` still opts into all tools.
  return TOOL_PROFILE.HYBRID;
}

export function filterTools(tools: ToolDef[], profile: ToolProfile): ToolDef[] {
  if (profile === TOOL_PROFILE.CORE) return tools.filter((t) => CORE_TOOL_NAMES.has(t.name));
  if (profile === TOOL_PROFILE.STANDARD)
    return tools.filter((t) => STANDARD_TOOL_NAMES.has(t.name));
  return tools;
}
