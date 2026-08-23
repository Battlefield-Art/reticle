/**
 * The closing must name the one command that works before the client restart.
 *
 * Everything else `init` points at needs the MCP tools, and those do not exist until the client
 * restarts — which is exactly where the funnel breaks. `reticle demo` does not: it boots its own
 * daemon and its own browser, drives one control, and prints a verdict. It is the only path from a
 * finished `init` to a user actually SEEING Reticle work, and it runs immediately.
 *
 * So the closing names it, and names it BEFORE the restart, because that ordering is the whole
 * point: there is something to see first, and the restart is for what comes after.
 */

import { describe, expect, it } from 'vitest';
import { restartHint } from './closing-hint.js';
import { StepStatus } from './plan.js';
import { Framework } from './detect.js';

const closing = (s: StepStatus) => restartHint(Framework.VITE, s, 'pnpm dev');

describe('the closing names the command that needs no restart', () => {
  it.each([StepStatus.APPLY, StepStatus.ALREADY])('%s: names `demo`', (s) => {
    expect(closing(s)).toMatch(/server demo/);
  });

  it.each([StepStatus.APPLY, StepStatus.ALREADY])('%s: says it needs no restart', (s) => {
    expect(closing(s)).toMatch(/without waiting|no restart needed|right now|before/i);
  });

  /**
   * On a FIRST install the restart is real, and the demo is the thing that works before it. Naming
   * the demo after the restart would put the only immediate payoff behind the only wall.
   */
  it('puts the demo BEFORE the restart instruction on a first install', () => {
    const out = closing(StepStatus.APPLY);
    expect(out.search(/server demo/)).toBeLessThan(out.search(/restart your agent/i));
  });
});

describe('it does not oversell what the demo proves', () => {
  /**
   * A blind click grades `no-fault`, correctly. The closing must not promise a pass it cannot
   * deliver, or the first thing a new user meets is Reticle being wrong about itself.
   */
  it('does not claim the demo verifies anything', () => {
    expect(closing(StepStatus.APPLY)).not.toMatch(/demo.*(verifies|proves|passes)/i);
  });
});
