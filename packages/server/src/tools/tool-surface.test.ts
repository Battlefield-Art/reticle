import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOOLS } from './tools.js';
import {
  CORE_TOOL_NAMES,
  TOOL_SURFACE,
  TOOL_PROFILE_ENV,
  ADVERTISE_ALL_ENV,
  describeToolSurface,
  filterTools,
  resolveToolSurface,
} from './tool-surface.js';

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
    const names = filterTools(TOOLS, TOOL_SURFACE.DEFAULT).map((t) => t.name);
    expect(new Set(names)).toEqual(CORE_TOOL_NAMES);
    expect(names).toHaveLength(CORE_TOOL_NAMES.size);
  });

  it('2: FULL filter returns every tool (the full surface, ≥35)', () => {
    const tools = filterTools(TOOLS, TOOL_SURFACE.ALL);
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

  it('5: resolveToolSurface — an explicit value wins over the environment', () => {
    process.env[TOOL_PROFILE_ENV] = 'full';
    expect(resolveToolSurface(TOOL_SURFACE.DEFAULT)).toBe(TOOL_SURFACE.DEFAULT);
  });

  it('6: resolveToolSurface — falls back to the retired env var when no explicit value', () => {
    process.env[TOOL_PROFILE_ENV] = 'full';
    expect(resolveToolSurface()).toBe(TOOL_SURFACE.ALL);
  });

  it('7: resolveToolSurface — defaults to HYBRID, an unknown value fails open to HYBRID, explicit full is honored', () => {
    expect(resolveToolSurface()).toBe(TOOL_SURFACE.DEFAULT);
    expect(resolveToolSurface('bogus')).toBe(TOOL_SURFACE.DEFAULT);
    expect(resolveToolSurface(TOOL_SURFACE.ALL)).toBe(TOOL_SURFACE.ALL);
  });
});

/**
 * There is ONE tool surface. Everything else is a retired name or a verification switch.
 *
 * Measured off the real wire, fresh daemon per reading:
 *
 *   dynamic     2 tools    1,543 B     ~386 tok/turn
 *   core       16 tools   18,183 B   ~4,546 tok/turn
 *   hybrid     16 tools   18,183 B   ~4,546 tok/turn
 *   standard   33 tools   32,234 B   ~8,059 tok/turn
 *   full       48 tools  127,903 B  ~31,976 tok/turn
 *
 * `core` was byte-identical to `hybrid`. `standard` charged ~3,500 tokens every turn for reach that
 * `reticle_run` already provided. `dynamic` was selected by nothing in this repo and is contradicted
 * by our own measurement — a pure on-demand surface does not hold accuracy with a generic model.
 *
 * `full` is the one that survives, and NOT as a profile: it is the only mode that advertises
 * `outputSchema`, which is what makes the MCP layer validate tool OUTPUT. Folding that into the
 * default was measured at 18,183 -> 41,117 bytes (2.26x, +5,733 tok/turn), so it cannot be the
 * default; deleting it would lose the defect class the surface sweep catches. So it is a switch,
 * named for what it does, and no user is asked to choose it.
 *
 * Every retired value still resolves, because they were a published env var.
 */
describe('one surface, plus a verification switch', () => {
  it('offers exactly two internal surfaces and no menu', () => {
    expect(new Set(Object.values(TOOL_SURFACE))).toEqual(new Set(['default', 'all']));
  });

  it.each([['core'], ['standard'], ['hybrid'], ['dynamic']])(
    'resolves the retired value %s to the one default surface',
    (name) => {
      expect(resolveToolSurface(name)).toBe(TOOL_SURFACE.DEFAULT);
    },
  );

  it('resolves the retired value full to the ALL surface, so a script that set it still works', () => {
    expect(resolveToolSurface('full')).toBe(TOOL_SURFACE.ALL);
  });

  it('says the setting retired, and points at the switch that replaced it', () => {
    const origin = describeToolSurface(TOOL_SURFACE.DEFAULT, 'standard');
    expect(origin.source).toMatch(/RETIRED/);
    expect(origin.source).toMatch(/RETICLE_ADVERTISE_ALL_TOOLS/);
  });

  it('says so for a value that was never even one of its names', () => {
    const origin = describeToolSurface(TOOL_SURFACE.DEFAULT, 'banana');
    expect(origin.source).toMatch(/RETIRED/);
    expect(origin.source).toMatch(/banana/);
  });

  it('turns the ALL surface on from the switch', () => {
    process.env[ADVERTISE_ALL_ENV] = '1';
    expect(resolveToolSurface()).toBe(TOOL_SURFACE.ALL);
    delete process.env[ADVERTISE_ALL_ENV];
  });

  it('treats a non-truthy switch value as off, rather than as "set"', () => {
    process.env[ADVERTISE_ALL_ENV] = '0';
    expect(resolveToolSurface()).toBe(TOOL_SURFACE.DEFAULT);
    delete process.env[ADVERTISE_ALL_ENV];
  });
});
