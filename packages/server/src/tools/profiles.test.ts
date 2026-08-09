import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOOLS } from './tools.js';
import {
  CORE_TOOL_NAMES,
  TOOL_PROFILE,
  TOOL_PROFILE_ENV,
  describeToolProfile,
  filterTools,
  resolveToolProfile,
} from './profiles.js';

describe('tool profiles', () => {
  const original = process.env[TOOL_PROFILE_ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[TOOL_PROFILE_ENV];
    else process.env[TOOL_PROFILE_ENV] = original;
  });
  beforeEach(() => {
    delete process.env[TOOL_PROFILE_ENV];
  });

  it('1: the HYBRID filter returns exactly the core tool set', () => {
    const names = filterTools(TOOLS, TOOL_PROFILE.HYBRID).map((t) => t.name);
    expect(new Set(names)).toEqual(CORE_TOOL_NAMES);
    expect(names).toHaveLength(CORE_TOOL_NAMES.size);
  });

  it('2: FULL filter returns every tool (the full surface, ≥35)', () => {
    const tools = filterTools(TOOLS, TOOL_PROFILE.FULL);
    expect(tools).toHaveLength(TOOLS.length);
    expect(TOOLS.length).toBeGreaterThanOrEqual(35);
  });

  it('3: every CORE_TOOL_NAMES entry actually exists in TOOLS (no dangling name)', () => {
    const all = new Set(TOOLS.map((t) => t.name));
    for (const name of CORE_TOOL_NAMES) expect(all.has(name)).toBe(true);
  });

  it('4: the core set is a strict subset — fewer tools than FULL', () => {
    expect(CORE_TOOL_NAMES.size).toBeLessThan(TOOLS.length);
  });

  it('4b: server-management ops are NOT on the MCP surface (CLI-only — they restart the daemon)', () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const retired of ['reticle_version_info', 'reticle_apply_update', 'reticle_rollback'])
      expect(names.has(retired)).toBe(false);
  });

  it('5: resolveToolProfile — explicit value wins over env', () => {
    process.env[TOOL_PROFILE_ENV] = TOOL_PROFILE.FULL;
    expect(resolveToolProfile(TOOL_PROFILE.DYNAMIC)).toBe(TOOL_PROFILE.DYNAMIC);
  });

  it('6: resolveToolProfile — falls back to env when no explicit value', () => {
    process.env[TOOL_PROFILE_ENV] = TOOL_PROFILE.FULL;
    expect(resolveToolProfile()).toBe(TOOL_PROFILE.FULL);
  });

  it('7: resolveToolProfile — defaults to HYBRID, an unknown value fails open to HYBRID, explicit full is honored', () => {
    expect(resolveToolProfile()).toBe(TOOL_PROFILE.HYBRID);
    expect(resolveToolProfile('bogus')).toBe(TOOL_PROFILE.HYBRID);
    expect(resolveToolProfile(TOOL_PROFILE.FULL)).toBe(TOOL_PROFILE.FULL);
  });
});

/**
 * Five profiles, three distinct surfaces.
 *
 * Measured off the real wire (spawn `mcp`, read tools/list, with a FRESH daemon per profile —
 * the env var is read by the daemon at startup, so reusing one silently measures the first):
 *
 *   dynamic    2 tools    1,543 B     ~386 tok/turn
 *   core      16 tools   18,183 B   ~4,546 tok/turn
 *   hybrid    16 tools   18,183 B   ~4,546 tok/turn
 *   standard  33 tools   32,234 B   ~8,059 tok/turn
 *   full      48 tools  127,903 B  ~31,976 tok/turn
 *
 * `core` and `hybrid` were byte-identical — one behaviour behind two names, which is how "I set
 * RETICLE_TOOL_PROFILE=core and nothing changed" becomes a support question with no answer. And
 * `standard` paid ~3,500 tokens EVERY TURN to advertise 17 tools directly that hybrid already
 * reaches on demand through reticle_run — a permanent per-turn cost to save an occasional lookup.
 *
 * So the surface is now the three that differ: minimum, default, everything. The retired names still
 * resolve — to hybrid, which is what `core` already was and the nearest honest answer for `standard`
 * — because they are a published env var and somebody has them in a shell profile.
 */
describe('the profile list stays small, and retiring a name does not break anybody', () => {
  it('offers exactly the three surfaces that actually differ', () => {
    expect(new Set(Object.values(TOOL_PROFILE))).toEqual(new Set(['dynamic', 'hybrid', 'full']));
  });

  it.each([['core'], ['standard']])('resolves the retired name %s to hybrid', (name) => {
    expect(resolveToolProfile(name)).toBe(TOOL_PROFILE.HYBRID);
  });

  it('says a retired name was retired, rather than "did not take effect"', () => {
    // The existing unknown-name message blames the daemon's startup environment, which is the wrong
    // diagnosis here and sends the reader to check something that is fine.
    const origin = describeToolProfile(TOOL_PROFILE.HYBRID, 'standard');
    expect(origin.source).toMatch(/retired/i);
    expect(origin.source).toMatch(/hybrid/);
  });

  it('still reports a genuinely unknown name as unknown, not as retired', () => {
    const origin = describeToolProfile(TOOL_PROFILE.HYBRID, 'banana');
    expect(origin.source).not.toMatch(/retired/i);
  });
});
