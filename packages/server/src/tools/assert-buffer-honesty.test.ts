import { describe, expect, it } from 'vitest';
import { BUFFER_EVICTION_WARNING, SessionState } from '@reticlehq/core';
import { TOOLS, type ToolDef, type ToolDeps } from './tools.js';
import { ReticleTool } from './tool-names.js';
import type { Session, SessionManager } from '../session/session.js';

/**
 * The worst answer a verification layer can give is a confident green that rests on evidence it no
 * longer has. `reticle_assert { kind:'console', absent:true }` concludes "no errors" from the ring
 * buffer — which evicts on an age and size cap — so on a flow longer than the buffer's window, an
 * error logged early is gone by the time the assertion runs, and the verdict is `pass:true`.
 *
 * reticle_console has always disclosed this for the same window. The verdict path, which is the one
 * an agent actually gates on, did not. These tests pin the disclosure onto the verdict.
 *
 * The block stays OMITTED when nothing was dropped: silence has to keep meaning "the buffer was
 * intact", or it becomes noise on every healthy call and gets ignored.
 */
function depsWithBuffer(dropped: number): ToolDeps {
  const session: Partial<Session> = {
    id: 'demo',
    bufferHealth: () => ({ total: 12, dropped }),
    eventsSince: () => [],
    queryEvents: () => Promise.resolve([]),
    elapsed: () => 1000,
    lastActCursor: () => 0,
    health: () => ({ lastSeenMs: 5, throttled: false, focused: true, hidden: false }),
    getState: () => SessionState.ACTIVE,
    drainInbox: () => [],
  };
  const sessions: Partial<SessionManager> = { resolve: () => session as Session };
  return { sessions: sessions as SessionManager } as unknown as ToolDeps;
}

const tool = (name: string): ToolDef => {
  const found = TOOLS.find((t) => t.name === name);
  if (found === undefined) throw new Error(`${name} is not on the surface`);
  return found;
};

const absentConsole = {
  predicate: { kind: 'console', level: 'error', absent: true },
  timeout_ms: 0,
};

describe('a verdict reached over an evicted buffer says so', () => {
  it('reticle_assert discloses eviction on a PASSING absence assertion', async () => {
    const result = (await tool(ReticleTool.ASSERT).handler(
      depsWithBuffer(7),
      absentConsole,
    )) as { pass: boolean; buffer?: { dropped: number; note: string } };
    expect(result.pass).toBe(true);
    expect(result.buffer?.dropped).toBe(7);
    expect(result.buffer?.note).toBe(BUFFER_EVICTION_WARNING);
  });

  it('stays silent when the buffer is intact — silence must keep meaning trustworthy', async () => {
    const result = (await tool(ReticleTool.ASSERT).handler(depsWithBuffer(0), absentConsole)) as {
      pass: boolean;
      buffer?: unknown;
    };
    expect(result.pass).toBe(true);
    expect(result.buffer).toBeUndefined();
  });

  it('declares buffer in its output schema, or a strict client never sees it', () => {
    for (const name of [ReticleTool.ASSERT, ReticleTool.WAIT_FOR]) {
      expect(Object.keys(tool(name).outputSchema ?? {})).toContain('buffer');
    }
  });
});
