/**
 * A flow graded "asserted" that passes when its assertion is false.
 *
 * Driven end to end against the bench app, following the documented path exactly:
 *
 *   reticle_annotate { kind: 'assert-signal', name: 'signal-that-never-fires' }
 *     -> ok: true, "will assert signal signal-that-never-fires"
 *   reticle_flow_save
 *     -> grade: "asserted", hasConsequenceAssertion: true, consequenceSteps: 1
 *   reticle_flow_replay
 *     -> status: "ok"          <-- PASSES. The signal never fired.
 *
 * `flow-replay` evaluates exactly two things per step: `expect.element.testid` is present, and
 * `expect.state` holds. A per-step `signal` or `net` expect is counted as a consequence by
 * `classifyFlowAssertions` and then never evaluated by anything.
 *
 * So the grade is the lie: the flow claims to assert an observable consequence and cannot go red on
 * it. "A green that cannot go red is no longer a pass" is this repo's own rule, and this is the
 * feature that rule was written for.
 *
 * The FLOW-LEVEL `success` expect does not have this problem — `assertSuccess` compiles it through
 * `successToPredicate` and evaluates it, signal and net included. So the fix is to stop counting the
 * unenforced STEP kinds, and point the agent at `success-state`, which works.
 */

import { describe, expect, it } from 'vitest';
import { classifyFlowAssertions, FlowAssertionGrade } from './flow-classify.js';
import { compileAnnotation } from './annotate.js';
import { AnnotationKind } from '@reticlehq/core';
import type { FlowFile } from '@reticlehq/core';

const flow = (step: Record<string, unknown>, success?: Record<string, unknown>): FlowFile =>
  ({
    version: 1,
    name: 'probe',
    steps: [{ tool: 'reticle_act', anchor: { kind: 'testid', value: 'x' }, ...step }],
    ...(success === undefined ? {} : { success }),
  }) as unknown as FlowFile;

describe('a step expect only counts as a consequence if replay can CHECK it', () => {
  it('a step signal expect does NOT make the flow "asserted" — replay never evaluates it', () => {
    const c = classifyFlowAssertions(flow({ expect: { signal: 'never-fires' } }));
    expect(c.hasConsequenceAssertion, 'nothing evaluates a step signal on replay').toBe(false);
    expect(c.grade).not.toBe(FlowAssertionGrade.ASSERTED);
  });

  it('nor does a step net expect', () => {
    expect(
      classifyFlowAssertions(flow({ expect: { net: { urlContains: '/api/x' } } }))
        .hasConsequenceAssertion,
    ).toBe(false);
  });

  it('a step STATE expect does count — assertStepState evaluates it', () => {
    const c = classifyFlowAssertions(flow({ expect: { state: { path: 'cart.total', equals: 1 } } }));
    expect(c.hasConsequenceAssertion).toBe(true);
    expect(c.grade).toBe(FlowAssertionGrade.ASSERTED);
  });

  it('a FLOW-LEVEL success signal still counts — assertSuccess really does evaluate it', () => {
    // The working path must not be downgraded by this fix, or the honest option looks broken too.
    const c = classifyFlowAssertions(flow({}, { signal: 'deploy:shipped' }));
    expect(c.hasConsequenceAssertion).toBe(true);
    expect(c.grade).toBe(FlowAssertionGrade.ASSERTED);
  });

  it('a step element expect is still presence-only, as before', () => {
    const c = classifyFlowAssertions(flow({ expect: { element: { testid: 'toast' } } }));
    expect(c.grade).toBe(FlowAssertionGrade.PRESENCE_ONLY);
  });
});

describe('annotate stops promising a check that never runs', () => {
  it('assert-signal says so, and names the kind that IS enforced', () => {
    const out = compileAnnotation({ kind: AnnotationKind.ASSERT_SIGNAL, name: 'never-fires' }, 1);
    expect(out.result.ok).toBe(true);
    if (!out.result.ok) return;
    expect(out.result.note, 'the caller is told replay will not check this').toContain(
      'success-state',
    );
  });

  it('assert-state carries no such caveat — that one is checked', () => {
    const out = compileAnnotation(
      { kind: AnnotationKind.ASSERT_STATE, statePath: 'cart.total', equals: 1 },
      1,
    );
    expect(out.result.ok && out.result.note).toBeUndefined();
  });
});
