/**
 * An empty session list must carry its own explanation.
 *
 * `reticle_sessions` is the probe an agent reaches for first, and for the largest cohort in the
 * funnel it is also the LAST tool they call: the app was never instrumented, the list comes back
 * empty, and `{"sessions":[]}` reads as a settled fact rather than a diagnosable state. The agent
 * cannot tell that apart from a daemon that is down or a tab that was closed, so it falls back to
 * static reasoning and hands the verification back to the human.
 *
 * The daemon already computes exactly this diagnosis for the error path. The only defect was that
 * the READ path never showed it.
 */

import { describe, expect, it } from 'vitest';
import { ReticleTool } from './tool-names.js';
import { TOOLS } from './tools.js';
import type { ToolDeps } from './tool-kit.js';

const sessionsTool = TOOLS.find((tool) => ReticleTool.SESSIONS === tool.name);

/** Only the two fields this handler reads — the rest of ToolDeps is irrelevant here. */
function depsWith(list: unknown[], hint: string | undefined): ToolDeps {
  return {
    sessions: { list: () => list, noSessionHint: () => hint },
  } as unknown as ToolDeps;
}

describe('reticle_sessions explains an empty list', () => {
  it('is a declared output field, so a strict client does not strip it', () => {
    expect(sessionsTool?.outputSchema).toHaveProperty('why');
  });

  it('carries the diagnosis when nothing is connected', async () => {
    const result = (await sessionsTool?.handler(
      depsWith([], 'run `reticle init` in the app'),
      {},
    )) as {
      sessions: unknown[];
      why?: string;
    };
    expect(result.sessions).toEqual([]);
    expect(result.why).toContain('reticle init');
  });

  it('stays silent when there is nothing to diagnose', async () => {
    const result = (await sessionsTool?.handler(depsWith([], undefined), {})) as { why?: string };
    expect(result.why).toBeUndefined();
  });

  it('does not editorialise when sessions ARE connected', async () => {
    const session = {
      sessionId: 's1',
      url: 'http://localhost:5173/',
      adapters: [],
      hasCapabilities: true,
      lastSeenMs: 0,
      throttled: false,
      focused: true,
      hidden: false,
    };
    const result = (await sessionsTool?.handler(depsWith([session], 'should not appear'), {})) as {
      sessions: unknown[];
      why?: string;
    };
    expect(result.sessions).toHaveLength(1);
    expect(result.why).toBeUndefined();
  });
});
