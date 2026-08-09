import { ReticleTool } from './tool-names.js';
import type { ToolDef } from './tools.js';

/**
 * Which MCP tool surface to expose. The advertised tool DEFINITIONS are re-sent to the model on
 * every turn, so a smaller surface is a per-turn token saving that compounds across a loop. Fewer
 * tools also makes the model wander less (fewer turns, higher accuracy). See bench/agent-loop-and-replay.md.
 *
 * Surface sizes are NOT restated here — not as a current figure, not as a historical one. Three
 * generations of this comment got them wrong, and the third was the sentence that ANNOUNCED the rule
 * and then broke it in its own next clause, quoting a "correct" number that had gone stale since. A
 * count written down anywhere but the gate is a count nobody updates. They live in
 * profile-sizes.test.ts, which reads them off the real surface.
 *
 * There are three, because there are three surfaces that actually differ:
 *
 * dynamic — only the 2 meta-tools; every real tool is loaded on demand. A fixed, tiny per-turn cost
 * no matter how many tools exist. For the tightest token budgets.
 * hybrid — THE DEFAULT: the verify loop (navigate→look→act→observe→assert, with direct network +
 * console + state) advertised directly, plus the 2 meta-tools for on-demand reach to everything else.
 * full — every tool advertised directly. For scripts and suites that call by name and never discover.
 *
 * `core` and `standard` were retired: core was byte-identical to hybrid, and standard bought nothing
 * hybrid could not already reach. Both still resolve — see RETIRED_PROFILES.
 */
export const TOOL_PROFILE = {
  /** dynamic — advertise only 2 meta-tools (reticle_tools + reticle_run); load real tools on demand.
   * Fixed ~hundreds of tokens/turn regardless of how many tools exist. See dynamic-tools.ts. */
  DYNAMIC: 'dynamic',
  /** hybrid — THE DEFAULT: the core verify tools advertised directly (so the agent acts reliably)
   * PLUS the 2 meta-tools for on-demand reach to every other tool. Full reach at core cost. */
  HYBRID: 'hybrid',
  /** full — every tool advertised directly. For scripts and suites that call by name and never
   * discover. ~7x hybrid's per-turn cost, which is why it is opt-in. */
  FULL: 'full',
} as const;
export type ToolProfile = (typeof TOOL_PROFILE)[keyof typeof TOOL_PROFILE];

/**
 * Names that used to be profiles, and what they mean now.
 *
 * `core` was byte-identical to `hybrid` — 16 tools, 18,183 bytes, the same list — so it was one
 * behaviour behind two names, which is how "I set RETICLE_TOOL_PROFILE=core and nothing changed"
 * becomes a support question with no answer. `standard` advertised 17 more tools directly, costing
 * ~3,500 tokens EVERY TURN to save the occasional `reticle_tools` lookup that hybrid already
 * supports; nothing about it was characterisable as a use case.
 *
 * They still resolve, because they are a published env var and somebody has one in a shell profile.
 * Silently mapping them would repeat the original sin, so `describeToolProfile` says they retired.
 */
const RETIRED_PROFILES: Readonly<Record<string, ToolProfile>> = {
  core: TOOL_PROFILE.HYBRID,
  standard: TOOL_PROFILE.HYBRID,
};

export const TOOL_PROFILE_ENV = 'RETICLE_TOOL_PROFILE';

// The set an agent needs to verify a change end-to-end. Tool DEFINITIONS are re-sent every turn, so a
// smaller surface compounds.
//
// MEASURED per-turn `tools/list` cost — the bytes an MCP client re-sends EVERY turn — taken off the
// real wire (spawn `mcp`, read tools/list, measure the serialized result), not estimated.
//
// Measure with a FRESH DAEMON PER PROFILE. RETICLE_TOOL_PROFILE is read by the daemon at startup, so
// a loop that reuses one daemon reports the first profile's surface five times and looks like proof
// that the setting does nothing. That happened while taking this very reading.
//
//   dynamic     1,543 B    ~386 tok/turn     2 tools
//   hybrid     18,183 B  ~4,546 tok/turn    16 tools
//   full      127,903 B ~31,976 tok/turn    48 tools
//
// full is 7.03x hybrid. The previously documented 7.4x was stale; so were the byte figures, by
// 21-30%. Treat these as the SHAPE of the gap and re-measure before quoting one. Tool COUNTS are
// deliberately not asserted from this comment — they live in profile-sizes.test.ts.
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
// the baseline. A formal A/B of hybrid against a leaner surface on a current model is still UNRUN.
// See bench/agent-loop-and-replay.md.
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
  // through reticle_run — which, observed over a drive of the whole surface, means it never gets called.
  // The measured floor that justifies a lean core was about CUTTING to 8 (accuracy 5/5 → 3/5), not
  // about holding at 12; one tool of schema tax to close the find→fix loop is the right trade.
  ReticleTool.INSPECT,
  // FEEDBACK is in every profile for the same reason INSPECT is: a tool an agent has to already know
  // about, and reach through reticle_run, is a tool that never gets called. That is fatal here in a way
  // it is not elsewhere — an unadvertised feedback channel collects nothing, which is indistinguishable
  // from not having built one. It is also the cheapest tool on the surface to carry (three params) and
  // the only one whose whole purpose is telling us which of the other fifteen are failing.
  ReticleTool.FEEDBACK,
]);


export function resolveToolProfile(explicit?: string): ToolProfile {
  const raw = explicit ?? process.env[TOOL_PROFILE_ENV];
  if (raw === TOOL_PROFILE.DYNAMIC) return TOOL_PROFILE.DYNAMIC;
  if (raw === TOOL_PROFILE.HYBRID) return TOOL_PROFILE.HYBRID;
  if (raw === TOOL_PROFILE.FULL) return TOOL_PROFILE.FULL;
  const retired = raw === undefined ? undefined : RETIRED_PROFILES[raw];
  if (retired !== undefined) return retired;
  // Default: hybrid — the core verify+oracle tools advertised directly (no detection loss, verified
  // 10/10 on the regression bench) PLUS the 2 meta-tools for on-demand reach to every other tool — a
  // third of full's advertised surface at the same accuracy. Explicit `full` still opts into all tools.
  return TOOL_PROFILE.HYBRID;
}

/** The live profile plus where it came from — see describeToolProfile. */
export interface ToolProfileOrigin {
  active: ToolProfile;
  source: string;
}

/**
 * Which profile is live, and what chose it.
 *
 * `RETICLE_TOOL_PROFILE` is read by the DAEMON at startup, never by the client, so exporting it in an
 * agent's environment while a daemon is already running changes nothing at all — two different
 * profiles then look identical from the agent's side, which is exactly the observation that produced
 * a "standard and full advertise the same tools" report. Documenting that was not enough; the setting
 * failing to take has to be VISIBLE, so this rides along in the reticle_tools catalog.
 */
export function describeToolProfile(active: ToolProfile, requested?: string): ToolProfileOrigin {
  const env = requested ?? process.env[TOOL_PROFILE_ENV];
  // A retired name is not a mistake and not a daemon-environment problem, so it must not be reported
  // as either — the unknown-name message below sends the reader to check something that is fine.
  if (env !== undefined && env in RETIRED_PROFILES) {
    return {
      active,
      source: `${TOOL_PROFILE_ENV}=${env} is a RETIRED profile name; using '${active}' instead (core and standard were folded into hybrid)`,
    };
  }
  if (env === undefined || 0 === env.length) {
    return active === resolveToolProfile()
      ? { active, source: `default (${TOOL_PROFILE_ENV} unset when the daemon started)` }
      : { active, source: 'set explicitly when the daemon was started' };
  }
  if (active !== env) {
    return {
      active,
      source: `${TOOL_PROFILE_ENV}=${env} did NOT take effect (unknown profile name, or the daemon was started with an explicit one)`,
    };
  }
  return { active, source: `${TOOL_PROFILE_ENV}=${env} in the DAEMON's environment at startup` };
}

export function filterTools(tools: ToolDef[], profile: ToolProfile): ToolDef[] {
  // CORE_TOOL_NAMES survives the collapse as what it always really was: the set hybrid advertises
  // directly. It was never the interesting thing about the `core` PROFILE — that profile's only
  // distinction from hybrid was a second name for the same output.
  if (profile === TOOL_PROFILE.HYBRID) return tools.filter((t) => CORE_TOOL_NAMES.has(t.name));
  return tools;
}
