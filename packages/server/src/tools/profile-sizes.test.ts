/**
 * The documented profile sizes must match the real ones.
 *
 * `profiles.ts` carries a prose table of surface sizes, and its own comment says "every count
 * previously written here was wrong". They were wrong again: documented `core 15 · standard 32 ·
 * hybrid 15 · full 43` against an actual 16 / 33 / 16 / 46, reported from a field sweep. The token
 * and byte figures in that comment are derived from those counts, so the whole justification for the
 * default profile was computed from numbers that were never true.
 *
 * Prose cannot be trusted to stay in step with a list that grows every release, so the numbers live
 * here where a gate reads them, and the comment points at this file instead of restating them.
 */

import { describe, expect, it } from 'vitest';
import { TOOL_PROFILE, type ToolProfile } from './profiles.js';
import { advertisedTools } from '../mcp.js';
import { TOOLS } from './tools.js';

/** The advertised size of each profile. Update WITH the surface, never after it. */
const EXPECTED_SIZE: Record<ToolProfile, number> = {
  [TOOL_PROFILE.DYNAMIC]: 2,
  [TOOL_PROFILE.CORE]: 16,
  [TOOL_PROFILE.HYBRID]: 16,
  [TOOL_PROFILE.STANDARD]: 33,
  // 46 tools + the two meta-tools: every recovery message points at reticle_tools, so a profile
  // without it makes our own advice a dead end.
  [TOOL_PROFILE.FULL]: 48,
};

describe('advertised surface sizes', () => {
  it.each(Object.entries(EXPECTED_SIZE))('%s advertises %i tools', (profile, size) => {
    expect(advertisedTools(profile as ToolProfile)).toHaveLength(size);
  });

  it('full advertises the ENTIRE surface, which is what "full" has to mean', () => {
    const names = new Set(advertisedTools(TOOL_PROFILE.FULL).map((t) => t.name));
    for (const tool of TOOLS) expect(names.has(tool.name), tool.name).toBe(true);
  });

  it('EVERY profile can look up a tool\'s parameters', () => {
    // Recovery messages across the server say "Call reticle_tools { names: [...] }". A profile that
    // does not advertise it turns our own advice into a dead end — `full` used to be exactly that.
    for (const profile of Object.values(TOOL_PROFILE)) {
      const names = advertisedTools(profile).map((t) => t.name);
      expect(names, profile).toContain('reticle_tools');
      expect(names, profile).toContain('reticle_run');
    }
  });

  it('every trimmed profile is smaller than full, or it is not a trim', () => {
    const full = advertisedTools(TOOL_PROFILE.FULL).length;
    for (const profile of [TOOL_PROFILE.DYNAMIC, TOOL_PROFILE.CORE, TOOL_PROFILE.HYBRID, TOOL_PROFILE.STANDARD]) {
      expect(advertisedTools(profile).length, profile).toBeLessThan(full);
    }
  });
});
