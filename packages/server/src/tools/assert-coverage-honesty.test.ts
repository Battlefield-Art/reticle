import { describe, expect, it } from 'vitest';
import { SessionState } from '@reticlehq/core';
import { TOOLS, type ToolDef, type ToolDeps } from './tools.js';
import { ReticleTool } from './tool-names.js';
import type { Session, SessionManager } from '../session/session.js';

/**
 * A green verdict must never imply more coverage than the SDK actually had.
 *
 * `reticle_act_and_wait` has always carried a coverage statement, so a cross-origin iframe or a closed
 * shadow root downgrades its verdict to `partial`. Plain `reticle_assert` did not — and assert is the
 * cheaper, more-used verdict path, the one an agent gates on. So on a page with an unobservable
 * region, a passing assert read as "the page is correct" when the only honest claim available was
 * "nothing failed in the part I could see". That is the exact false-green shape this project exists to
 * prevent, sitting on the most-travelled route.
 *
 * The field stays OMITTED at full coverage: its PRESENCE is the warning, so emitting it always would
 * make it noise on every healthy call and it would stop being read.
 */
function depsWithBlindSpots(blindSpots: Record<string, number>): ToolDeps {
  const session: Partial<Session> = {
    id: 'demo',
    lastActSource: () => undefined,
    bufferHealth: () => ({ total: 5, dropped: 0 }),
    blindSpots: () => blindSpots,
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

/** An absence assertion — the shape most vulnerable to an unobserved region hiding the failure. */
const absentConsole = {
  predicate: { kind: 'console', level: 'error', absent: true },
  timeout_ms: 0,
};

describe('reticle_assert discloses partial coverage', () => {
  it('a PASSING assertion on a page with a cross-origin iframe reports partial coverage', async () => {
    const result = (await tool(ReticleTool.ASSERT).handler(
      depsWithBlindSpots({ 'cross-origin-iframe': 1 }),
      absentConsole,
    )) as Record<string, unknown>;

    expect(result['pass']).toBe(true);
    expect(result['coverage']).toBeTypeOf('string');
    expect(String(result['coverage'])).toContain('partial');
  });

  it('names which regions were unobservable, so the agent can act on it', async () => {
    const result = (await tool(ReticleTool.ASSERT).handler(
      depsWithBlindSpots({ 'cross-origin-iframe': 2 }),
      absentConsole,
    )) as Record<string, unknown>;

    const spots = result['coverage_spots'] as { kind: string; count: number }[] | undefined;
    expect(spots?.[0]).toMatchObject({ kind: 'cross-origin-iframe', count: 2 });
  });

  it('OMITS coverage entirely when the page was fully observable', async () => {
    // Silence has to keep meaning "I saw everything", or the field becomes noise and gets ignored.
    const result = (await tool(ReticleTool.ASSERT).handler(
      depsWithBlindSpots({}),
      absentConsole,
    )) as Record<string, unknown>;

    expect(result['pass']).toBe(true);
    expect('coverage' in result).toBe(false);
    expect('coverage_spots' in result).toBe(false);
  });

  it('a zero-count blind spot is not a blind spot', async () => {
    // The sensor emits on change, so a region that was unobservable and then went away reports 0.
    const result = (await tool(ReticleTool.ASSERT).handler(
      depsWithBlindSpots({ 'cross-origin-iframe': 0 }),
      absentConsole,
    )) as Record<string, unknown>;

    expect('coverage' in result).toBe(false);
  });
});
