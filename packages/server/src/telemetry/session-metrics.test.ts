import { describe, expect, it } from 'vitest';
import { BrowserLaunchKind, ConnectFailure } from '@reticlehq/core';
import { SessionMetrics } from './session-metrics.js';
import {
  errorSkeleton,
  fingerprintCrash,
  fingerprintError,
  reticleFrames,
} from './error-fingerprint.js';

const clock = (start = 0): (() => number) => {
  let t = start;
  return () => (t += 1000);
};

describe('SessionMetrics — one event instead of hundreds', () => {
  it('rolls tool calls into a histogram rather than a stream of events', () => {
    const m = new SessionMetrics(clock());
    m.recordToolCall('reticle_act');
    m.recordToolCall('reticle_act');
    m.recordToolCall('reticle_assert');
    const summary = m.summarize(true);
    expect(summary.toolCalls).toBe(3);
    expect(summary.toolCounts).toEqual({ reticle_act: 2, reticle_assert: 1 });
  });

  it('groups errors by FINGERPRINT so the same defect from many machines collapses to one row', () => {
    const m = new SessionMetrics(clock());
    // Same defect, different flow names — the whole reason fingerprints exist.
    m.recordToolError("no baseline named 'checkout-v3'", 'reticle_baseline');
    m.recordToolError("no baseline named 'login'", 'reticle_baseline');
    const errors = m.summarize(true).errors ?? [];
    expect(errors).toHaveLength(1);
    expect(errors[0]?.count).toBe(2);
    expect(m.summarize(true).toolErrors).toBe(2);
  });

  /**
   * A fingerprint alone could be RANKED and never DIAGNOSED — forty machines hitting `a3f2c1d8` with
   * no way to learn what `a3f2c1d8` was. The skeleton is the dictionary entry that makes the group
   * key mean something, and the tool is what separates the same message from two different bugs.
   */
  it('carries a readable skeleton and the tool, not just an opaque hash', () => {
    const m = new SessionMetrics(clock());
    m.recordToolError("no baseline named 'checkout-v3'", 'reticle_baseline');
    const error = (m.summarize(true).errors ?? [])[0];
    expect(error?.message).toBe('no baseline named *');
    expect(error?.tool).toBe('reticle_baseline');
    expect(error?.message).not.toContain('checkout-v3');
    expect(error?.fingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it('remembers the recent approach run, so a crash can say what the agent was doing', () => {
    const m = new SessionMetrics(clock());
    m.recordToolCall('reticle_snapshot');
    m.recordToolCall('reticle_act');
    m.recordToolCall('reticle_assert');
    expect(m.trail.breadcrumb).toEqual(['reticle_snapshot', 'reticle_act', 'reticle_assert']);
    expect(m.trail.inFlight).toBe('reticle_assert');
  });

  it('bounds the breadcrumb to the recent past rather than the whole session', () => {
    const m = new SessionMetrics(clock());
    for (let i = 0; i < 50; i += 1) m.recordToolCall(`reticle_tool_${i}`);
    expect(m.trail.breadcrumb.length).toBeLessThanOrEqual(12);
    expect(m.trail.breadcrumb.at(-1)).toBe('reticle_tool_49');
  });

  it('bounds the distinct error shapes it will hold, so a pathological loop cannot grow memory', () => {
    const m = new SessionMetrics(clock());
    for (let i = 0; i < 500; i += 1)
      m.recordToolError(`unique failure kind ${String.fromCharCode(i)}`);
    expect((m.summarize(true).errors ?? []).length).toBeLessThanOrEqual(40);
  });

  /**
   * The first version of this counted only successes — and counted them INCONSISTENTLY, incrementing
   * before the await on the CDP path and after it on the launch path, so one number meant attempts
   * and the others meant successes and nothing in the data said which. A connection metric that
   * cannot express failure misses the only question worth asking: how often can people not get a
   * browser?
   */
  it('counts attempts AND successes, so a failure is visible rather than absent', () => {
    const m = new SessionMetrics(clock());
    m.recordConnectAttempt(BrowserLaunchKind.LAUNCHED)();
    m.recordConnectAttempt(BrowserLaunchKind.POOLED)();
    m.recordConnectAttempt(BrowserLaunchKind.POOLED)(ConnectFailure.CHROMIUM_MISSING);
    const connections = m.summarize(true).connections ?? {};
    expect(connections['launched']).toEqual({ attempts: 1, successes: 1 });
    expect(connections['pooled']).toEqual({
      attempts: 2,
      successes: 1,
      failures: { chromium_missing: 1 },
    });
  });

  it('never double-settles a connection, however many times the closure is called', () => {
    const m = new SessionMetrics(clock());
    const settle = m.recordConnectAttempt(BrowserLaunchKind.LAUNCHED);
    settle();
    settle();
    settle(ConnectFailure.OTHER);
    expect(m.summarize(true).connections?.['launched']).toEqual({ attempts: 1, successes: 1 });
  });

  it('times each tool, keeping the worst call as well as the total', () => {
    const m = new SessionMetrics(clock());
    m.startToolCall('reticle_act')(120);
    m.startToolCall('reticle_act')(880);
    m.startToolCall('reticle_snapshot')(40);
    const summary = m.summarize(true);
    expect(summary.toolTiming?.['reticle_act']).toEqual({ totalMs: 1000, maxMs: 880 });
    // busyMs is the headline "how much time does verification actually cost" number.
    expect(summary.busyMs).toBe(1040);
  });

  /**
   * Timing must survive concurrency: several agents can be inside runTool at once, so a single
   * "last start" field would attribute one tool's duration to another.
   */
  it('measures peak concurrency and settles overlapping calls independently', () => {
    const m = new SessionMetrics(clock());
    const a = m.startToolCall('reticle_act');
    const b = m.startToolCall('reticle_assert');
    const c = m.startToolCall('reticle_query');
    c(10);
    b(20);
    a(30);
    const summary = m.summarize(true);
    expect(summary.peakConcurrentTools).toBe(3);
    expect(summary.toolTiming?.['reticle_act']?.totalMs).toBe(30);
    expect(summary.toolTiming?.['reticle_query']?.totalMs).toBe(10);
  });

  it('counts calls for tools that do not exist — a naming defect that was invisible', () => {
    const m = new SessionMetrics(clock());
    m.recordUnknownTool();
    m.recordUnknownTool();
    expect(m.summarize(true).unknownToolCalls).toBe(2);
  });

  it('samples the machine, so "out of memory" and "our bug" can be told apart', () => {
    const machine = new SessionMetrics(clock()).summarize(true).machine;
    expect(machine?.totalMemMb).toBeGreaterThan(0);
    expect(machine?.cpuCount).toBeGreaterThan(0);
    expect(machine?.rssMb).toBeGreaterThan(0);
  });

  it('reports empty for an idle daemon, so a periodic flush sends nothing', () => {
    const m = new SessionMetrics(clock());
    expect(m.empty).toBe(true);
    m.recordToolCall('reticle_snapshot');
    expect(m.empty).toBe(false);
  });

  it('reset zeroes the window so a non-final flush reports the NEXT window, not a running total', () => {
    const m = new SessionMetrics(clock());
    m.recordToolCall('reticle_act');
    m.reset();
    const after = m.summarize(false);
    expect(after.toolCalls).toBe(0);
    expect(after.toolCounts).toEqual({});
    expect(after.final).toBe(false);
  });
});

/**
 * The fingerprint tests are the privacy contract for error analytics: each case is a thing that must
 * NOT survive into the group key, plus the grouping behaviour that makes the key worth having.
 */
describe('error fingerprinting', () => {
  it.each([
    ['a quoted flow name', `no baseline named 'checkout-v3'`, 'checkout-v3'],
    ['a URL', 'failed to reach https://acme.internal/api/orders', 'acme'],
    ['a POSIX path', 'cannot read /Users/ada/work/secret-app/src/App.tsx', 'ada'],
    ['a Windows path', 'cannot read C:\\Users\\Ada\\app\\main.ts', 'Ada'],
    ['a uuid', 'session 3f2504e0-4f89-11d3-9a0c-0305e82c3301 is gone', '3f2504e0'],
  ])('strips %s out of the skeleton', (_label, message, secret) => {
    expect(errorSkeleton(message)).not.toContain(secret);
  });

  it('gives the same key to the same defect and different keys to different ones', () => {
    expect(fingerprintError("no baseline named 'a'")).toBe(
      fingerprintError("no baseline named 'b'"),
    );
    expect(fingerprintError('no baseline named "a"')).not.toBe(
      fingerprintError('the pool is empty'),
    );
  });

  /**
   * Frames are OUR published code, so they carry the function name and line — which is most of what a
   * root-cause analysis needs. The user's own frames are dropped entirely: those name their app and
   * their home directory, and are none of our business.
   */
  it('keeps only RETICLE frames, as function@basename:line', () => {
    const stack = [
      'TypeError: x is not a function',
      '    at doThing (/Users/ada/secret-app/src/checkout.tsx:42:9)',
      '    at Object.resolveAnchor (/home/ada/p/node_modules/@reticlehq/server/dist/tools/act-tools.js:88:3)',
      '    at async run (/home/ada/p/node_modules/@reticlehq/server/dist/tools/invoke-tool.js:12:1)',
      '    at node:internal/process/task_queues:95:5',
    ].join('\n');
    const frames = reticleFrames(stack);
    // `Object.` is V8 noise that would make one function look like two.
    expect(frames).toEqual(['resolveAnchor@act-tools.js:88', 'run@invoke-tool.js:12']);
    expect(frames.join()).not.toContain('checkout');
    expect(frames.join()).not.toContain('ada');
  });

  it('still fingerprints a crash with no Reticle frames, rather than dropping it', () => {
    const fp = fingerprintCrash('TypeError', 'at /somewhere/else.js:1:1', 'boom on port 3000');
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
    // Port numbers vary per machine; the same crash must still group.
    expect(fp).toBe(
      fingerprintCrash('TypeError', 'at /somewhere/else.js:1:1', 'boom on port 4400'),
    );
  });
});

/**
 * Distinct defects vs defect instances.
 *
 * `bug_found` fires once per occurrence, so a defect hit five times in a session is five events.
 * That is the right raw signal — how often users actually collide with a class of defect — but it
 * cannot answer "how many distinct defects did Reticle find", which is the number that would go in
 * front of anyone. Counting instances as defects inflates the claim; counting only distinct ones
 * throws away frequency. Both are needed, so the event carries which it is.
 *
 * Firstness is tracked in its own uncapped set rather than read off `#bugKinds`. That map is capped
 * at MAX_ERROR_KINDS, and once full a genuinely new kind is never inserted — so `has()` would answer
 * "not seen" forever and mark every later occurrence as first, inflating the distinct count exactly
 * where the data got interesting. The kind vocabulary is bounded and small; the set is not a leak.
 */
describe('recordBug reports whether this KIND is new to the session', () => {
  it('is first on the first occurrence and a repeat thereafter', () => {
    const m = new SessionMetrics(clock());
    expect(m.recordBug('signal-contradicted')).toBe(true);
    expect(m.recordBug('signal-contradicted')).toBe(false);
    expect(m.recordBug('signal-contradicted')).toBe(false);
  });

  it('tracks each kind independently', () => {
    const m = new SessionMetrics(clock());
    expect(m.recordBug('duplicate-request')).toBe(true);
    expect(m.recordBug('unit-mismatch')).toBe(true);
    expect(m.recordBug('duplicate-request')).toBe(false);
  });

  it('still counts every occurrence — firstness never suppresses the instance count', () => {
    const m = new SessionMetrics(clock());
    m.recordBug('stale-response-applied');
    m.recordBug('stale-response-applied');
    const snap = m.summarize(true) as unknown as {
      bugsFound?: number;
      bugKinds?: Record<string, number>;
    };
    expect(snap.bugsFound).toBe(2);
    expect(snap.bugKinds?.['stale-response-applied']).toBe(2);
  });

  it('keeps answering correctly past the kind-map cap, where a naive has() check would not', () => {
    const m = new SessionMetrics(clock());
    for (let i = 0; i < 60; i += 1) m.recordBug(`filler-kind-${String(i)}`);
    expect(m.recordBug('filler-kind-59')).toBe(false);
    expect(m.recordBug('a-genuinely-new-kind')).toBe(true);
    expect(m.recordBug('a-genuinely-new-kind')).toBe(false);
  });

  it('firstness survives a flush — reset() ends a WINDOW, not the session', () => {
    // This used to assert the opposite, which is what shipped the double-count: reset() is the
    // periodic roll-up, and the daemon process is the session. A defect re-found 5 minutes later is
    // the same defect. See session-window.test.ts.
    const m = new SessionMetrics(clock());
    expect(m.recordBug('route-rendered-nothing')).toBe(true);
    m.reset();
    expect(m.recordBug('route-rendered-nothing')).toBe(false);
  });
});
