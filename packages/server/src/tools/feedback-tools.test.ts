import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as telemetryModule from '../telemetry/telemetry.js';
import { TOOLS } from './tools.js';
import { ReticleTool } from './tool-names.js';
import { TOOL_PROFILE, filterTools } from './profiles.js';
import { buildErrorPayload, FEEDBACK_ASK, RECOVERY } from './error-recovery.js';
import { resetFeedbackPrompt, takeFeedbackPrompt, VERIFICATION_TOOLS } from './feedback-tools.js';

describe('reticle_feedback', () => {
  const tool = TOOLS.find((t) => t.name === ReticleTool.FEEDBACK);

  it('is registered', () => {
    expect(tool).toBeDefined();
  });

  /**
   * The tool exists to be CALLED by an agent that was not told about it in advance. Under a trimmed
   * profile an unadvertised tool is only reachable if the agent already knows the name — which, for a
   * feedback channel, means it collects nothing and is indistinguishable from not existing.
   */
  it('is advertised under every profile, not left behind the meta-tool hatch', () => {
    for (const profile of [TOOL_PROFILE.CORE, TOOL_PROFILE.STANDARD, TOOL_PROFILE.FULL]) {
      expect(
        filterTools(TOOLS, profile).map((t) => t.name),
        `profile '${profile}'`,
      ).toContain(ReticleTool.FEEDBACK);
    }
  });

  it('tells the agent not to paste app data — instruction is the first line of defense', () => {
    expect(tool?.description).toMatch(/never include app source|secrets|user data/i);
  });

  it('files a report with no session connected — "nothing ever connects" is the report we most need', async () => {
    const deps = {
      sessions: {
        resolve: () => {
          throw new Error('no browser session connected');
        },
      },
    } as unknown as Parameters<NonNullable<typeof tool>['handler']>[0];
    const result = (await tool?.handler(deps, {
      kind: 'gap',
      text: 'the SDK never appeared in reticle_sessions after starting the dev server',
    })) as { note: string };
    expect(result.note).toBeTypeOf('string');
  });
});

describe('the error-envelope ask', () => {
  it('asks for feedback on an UNRECOGNIZED error — the case where we learn something', () => {
    const payload = buildErrorPayload('the widget imploded in an entirely novel way');
    expect(payload.feedback).toBe(FEEDBACK_ASK);
    expect(payload.recovery).toBeUndefined();
  });

  it('stays silent when a recovery hint already gives the agent a next move', () => {
    const payload = buildErrorPayload('no browser session connected');
    expect(payload.recovery).toBe(RECOVERY.NO_SESSION);
    expect(payload.feedback).toBeUndefined();
  });
});

describe('the one-shot human prompt', () => {
  beforeEach(() => {
    resetFeedbackPrompt();
  });

  it('never fires for a non-verification tool', () => {
    expect(takeFeedbackPrompt(ReticleTool.SNAPSHOT)).toBeUndefined();
  });

  /**
   * Under vitest telemetry is disabled outright, which is precisely the state that must produce
   * silence: asking someone for feedback we have already been told not to collect spends their
   * attention on a message with nowhere to go.
   */
  it('stays silent when the channel is off, even on a verification', () => {
    expect(takeFeedbackPrompt(ReticleTool.ASSERT)).toBeUndefined();
  });

  it('covers the tools that actually end a verification', () => {
    expect(VERIFICATION_TOOLS.has(ReticleTool.ASSERT)).toBe(true);
    expect(VERIFICATION_TOOLS.has(ReticleTool.FLOW_VERIFY)).toBe(true);
    expect(VERIFICATION_TOOLS.has(ReticleTool.VERIFY_CHANGE)).toBe(true);
  });
});

/**
 * Re-arming, and its ceiling. Strictly-once was too fragile — a daemon lives for days, the prompt
 * landed on the first verification, and if the agent did not relay it in that turn the signal went to
 * zero for the whole process with nothing to tell us.
 */
describe('the human prompt re-arms, but is capped', () => {
  beforeEach(() => {
    resetFeedbackPrompt();
    vi.restoreAllMocks();
  });

  const enableChannel = (): void => {
    vi.spyOn(telemetryModule, 'getTelemetry').mockReturnValue({
      emit: () => Promise.resolve(true),
      enabled: true,
      firstRun: false,
    });
  };

  it('asks on the first verification, then stays quiet through the next run of work', () => {
    enableChannel();
    expect(takeFeedbackPrompt(ReticleTool.ASSERT)).toBeDefined();
    for (let i = 0; i < 20; i += 1) {
      expect(takeFeedbackPrompt(ReticleTool.ASSERT), `verification ${i}`).toBeUndefined();
    }
  });

  it('asks again once enough verifications have gone by', () => {
    enableChannel();
    takeFeedbackPrompt(ReticleTool.ASSERT);
    let second: unknown;
    for (let i = 0; i < 40 && second === undefined; i += 1) {
      second = takeFeedbackPrompt(ReticleTool.ASSERT);
    }
    expect(second).toBeDefined();
  });

  it('never asks more than three times, however long the session runs', () => {
    enableChannel();
    let asks = 0;
    for (let i = 0; i < 500; i += 1) {
      if (takeFeedbackPrompt(ReticleTool.ASSERT) !== undefined) asks += 1;
    }
    expect(asks).toBe(3);
  });
});
