import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { buildDynamicTools } from './dynamic-tools.js';
import { ReticleTool } from './tool-names.js';
import type { ToolDef, ToolDeps } from './tools.js';

/**
 * The `dynamic` profile is the answer to the per-turn tool-definition tax — it advertises just two
 * meta-tools and loads real tool detail on demand. A bug in the catalog (a tool missing, a summary that
 * isn't one line, params not surfaced on load) breaks discovery, and the model can't find or call the
 * tool. These pin the pure catalog logic; the actual invocation path (runTool) is covered elsewhere.
 */
const fakeTools: ToolDef[] = [
  {
    name: 'reticle_alpha',
    description:
      'Do the alpha thing. A second sentence that must NOT appear in the catalog summary.',
    inputSchema: { ref: z.string().describe('the element'), count: z.number().optional() },
    handler: () => Promise.resolve({ ok: true }),
  },
  {
    name: 'reticle_beta',
    description: 'Do beta.',
    inputSchema: {},
    handler: () => Promise.resolve({ ok: true }),
  },
];

const NO_DEPS = {} as ToolDeps; // the discover/catalog + unknown-tool paths never touch deps

describe('buildDynamicTools — the dynamic profile meta-tools', () => {
  it('exposes exactly reticle_tools and reticle_run, whatever the real surface size', () => {
    const dyn = buildDynamicTools(fakeTools);
    expect(dyn.map((t) => t.name)).toEqual([ReticleTool.TOOLS, ReticleTool.RUN]);
  });

  it('reticle_tools with no args lists every tool as name + one-line summary', async () => {
    const tools = buildDynamicTools(fakeTools);
    const discover = tools.find((t) => t.name === ReticleTool.TOOLS);
    const out = (await discover?.handler(NO_DEPS, {})) as {
      tools: { name: string; summary: string }[];
    };
    expect(out.tools.map((t) => t.name)).toEqual(['reticle_alpha', 'reticle_beta']);
    // The summary is the FIRST sentence only — the second sentence must be dropped.
    expect(out.tools[0]?.summary).toBe('Do the alpha thing.');
    expect(out.tools[0]?.summary).not.toContain('second sentence');
  });

  it('reticle_tools with names loads full params for known tools and flags unknown ones', async () => {
    const tools = buildDynamicTools(fakeTools);
    const discover = tools.find((t) => t.name === ReticleTool.TOOLS);
    const out = (await discover?.handler(NO_DEPS, { names: ['reticle_alpha', 'nope'] })) as {
      tools: { name: string; params?: { name: string }[]; error?: string; description?: string }[];
    };
    const alpha = out.tools.find((t) => t.name === 'reticle_alpha');
    expect(alpha?.description).toContain('alpha');
    expect(alpha?.params?.map((p) => p.name)).toEqual(['ref', 'count']);
    expect(out.tools.find((t) => t.name === 'nope')?.error).toBe('unknown tool');
  });

  it('reticle_run on an unknown tool returns the available names (no invocation)', async () => {
    const tools = buildDynamicTools(fakeTools);
    const run = tools.find((t) => t.name === ReticleTool.RUN);
    const out = (await run?.handler(NO_DEPS, { tool: 'reticle_missing' })) as {
      error: string;
      available: string[];
    };
    expect(out.error).toContain('reticle_missing');
    expect(out.available).toEqual(['reticle_alpha', 'reticle_beta']);
  });
});
