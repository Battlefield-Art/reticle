import { describe, expect, it, vi } from 'vitest';
import { Verified } from '@reticlehq/core';
import { VERIFY_CHANGE_TOOLS } from './verify-change-tools.js';
import { FLOW_TOOLS } from './flow-tools.js';
import { ReticleTool } from '../tools/tool-names.js';
import type { ToolDeps } from '../tools/tools.js';

const tool = VERIFY_CHANGE_TOOLS[0];
if (tool === undefined) throw new Error('reticle_verify_change is not defined');

/** Deps whose flow store is empty — nothing on disk covers anything. */
const depsWithNoFlows = (): ToolDeps =>
  ({
    fs: {
      exists: () => Promise.resolve(false),
      readDir: () => Promise.resolve([]),
      readFile: () => Promise.resolve(undefined),
      writeFile: () => Promise.resolve(),
      mkdir: () => Promise.resolve(),
    },
    reticleRoot: '/tmp/nonexistent-reticle-root',
    flows: { list: () => Promise.resolve([]) },
  }) as unknown as ToolDeps;

describe('reticle_verify_change — an uncovered change is never a pass', () => {
  /**
   * The property the whole tool exists to protect. "Nothing ran" and "everything passed" are the
   * same green to anyone reading a boolean, and reporting a change as verified on the strength of
   * having executed nothing is precisely the false green this project exists to remove.
   */
  it('says UNKNOWN — not YES — when no saved flow covers the changed files', async () => {
    const result = (await tool.handler(depsWithNoFlows(), {
      files: ['src/Untouched.tsx'],
    })) as Record<string, unknown>;

    expect(result['verified']).toBe(Verified.UNKNOWN);
    expect(result['verified']).not.toBe(Verified.YES);
    expect(String(result['because'])).toContain('no saved flow covers');
    expect(result['flowsRun']).toEqual([]);
  });

  it('tells the caller how to fix the gap rather than just naming it', async () => {
    const result = (await tool.handler(depsWithNoFlows(), { files: ['src/A.tsx'] })) as Record<
      string,
      unknown
    >;
    expect(String(result['because'])).toMatch(/reticle_flow_save|driving the app/);
  });

  it('says UNKNOWN when no files were given, instead of verifying nothing', async () => {
    const result = (await tool.handler(depsWithNoFlows(), {})) as Record<string, unknown>;
    expect(result['verified']).toBe(Verified.UNKNOWN);
    expect(String(result['because'])).toContain('nothing to decide');
  });
});

describe('reticle_verify_change — it delegates rather than reimplements', () => {
  const withFlows = (suite: Record<string, unknown>): ToolDeps => {
    const verify = FLOW_TOOLS.find((t) => t.name === ReticleTool.FLOW_VERIFY);
    if (verify === undefined) throw new Error('flow_verify missing');
    vi.spyOn(verify, 'handler').mockResolvedValue(suite);
    return depsWithNoFlows();
  };

  /**
   * The suite verdict must come from `reticle_flow_verify` itself. A second replay implementation
   * would be free to drift from the one the CLI and the e2e battery exercise, and the drift would
   * surface as two different answers to the same question.
   */
  it('reports NO when the covering flows failed', async () => {
    const deps = withFlows({ status: 'fail', total: 3, passed: 2, failed: 1 });
    // Force one affected flow by pretending provenance is unknown for a saved flow.
    const spy = vi
      .spyOn(await import('./flow-sources.js'), 'affectedSavedFlows')
      .mockReturnValue({ affected: ['checkout'], unknownProvenance: [] });

    const result = (await tool.handler(deps, { files: ['src/Checkout.tsx'] })) as Record<
      string,
      unknown
    >;
    expect(result['verified']).toBe(Verified.NO);
    expect(String(result['because'])).toContain('1 of 3');
    spy.mockRestore();
  });

  it('reports YES only when every covering flow passed', async () => {
    const deps = withFlows({ status: 'pass', total: 2, passed: 2, failed: 0 });
    const spy = vi
      .spyOn(await import('./flow-sources.js'), 'affectedSavedFlows')
      .mockReturnValue({ affected: ['checkout', 'login'], unknownProvenance: [] });

    const result = (await tool.handler(deps, { files: ['src/Checkout.tsx'] })) as Record<
      string,
      unknown
    >;
    expect(result['verified']).toBe(Verified.YES);
    expect(result['flowsRun']).toEqual(['checkout', 'login']);
    spy.mockRestore();
  });

  /**
   * A flow re-run only because Reticle cannot tell what it covers is weaker evidence than one that
   * demonstrably touches the change. Saying so keeps a green from reading stronger than it is.
   */
  it('discloses when flows were included only for unknown provenance', async () => {
    const deps = withFlows({ status: 'pass', total: 1, passed: 1, failed: 0 });
    const spy = vi
      .spyOn(await import('./flow-sources.js'), 'affectedSavedFlows')
      .mockReturnValue({ affected: ['legacy'], unknownProvenance: ['legacy'] });

    const result = (await tool.handler(deps, { files: ['src/A.tsx'] })) as Record<string, unknown>;
    expect(String(result['because'])).toContain('cannot tell');
    spy.mockRestore();
  });
});
