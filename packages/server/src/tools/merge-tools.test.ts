import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mergeTools } from './merge-tools.js';
import type { ToolDef, ToolDeps } from './tool-kit.js';

const deps = {} as ToolDeps;

function member(name: string, extra: z.ZodRawShape = {}): ToolDef {
  return {
    name,
    description: `${name} desc`,
    inputSchema: extra,
    handler: (_d, args) => Promise.resolve({ ran: name, got: args }),
  };
}

describe('mergeTools (W10.3 surface consolidation)', () => {
  const merged = mergeTools({
    name: 'reticle_baseline',
    description: 'baseline family',
    actions: {
      save: member('reticle_baseline_save', { name: z.string() }),
      list: member('reticle_baseline_list'),
      diff: member('reticle_diff', { against: z.string().optional() }),
    },
  });

  it('advertises ONE tool with an action enum covering every member', () => {
    expect(merged.name).toBe('reticle_baseline');
    const action = merged.inputSchema['action'];
    expect(action).toBeDefined();
    expect(() => z.object({ action: action as z.ZodTypeAny }).parse({ action: 'save' })).not.toThrow();
    expect(() => z.object({ action: action as z.ZodTypeAny }).parse({ action: 'nope' })).toThrow();
  });

  it('routes each action to its ORIGINAL handler, unmodified', async () => {
    expect(await merged.handler(deps, { action: 'save', name: 'x' })).toEqual({
      ran: 'reticle_baseline_save',
      got: { action: 'save', name: 'x' },
    });
    expect(await merged.handler(deps, { action: 'list' })).toMatchObject({
      ran: 'reticle_baseline_list',
    });
    expect(await merged.handler(deps, { action: 'diff' })).toMatchObject({ ran: 'reticle_diff' });
  });

  it('unions member fields and makes them optional (one schema serves every action)', () => {
    // `name` is required on save but absent on list — merged it must be optional or list breaks.
    expect(merged.inputSchema['name']?.isOptional()).toBe(true);
    expect(merged.inputSchema['against']?.isOptional()).toBe(true);
  });

  it('returns a legible error (never throws) for an unknown action', async () => {
    const out = (await merged.handler(deps, { action: 'bogus' })) as {
      error?: string;
      expected?: string[];
    };
    expect(out.error).toContain('bogus');
    expect(out.expected).toEqual(['save', 'list', 'diff']);
  });
});
