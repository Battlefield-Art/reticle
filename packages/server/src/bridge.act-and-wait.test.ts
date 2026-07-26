import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventType } from '@reticlehq/core';
import { Bridge } from './bridge.js';
import { TOOLS, type ToolDeps } from './tools/tools.js';
import { FakeBrowser, callTool, makeDeps, waitUntil } from './bridge.test-harness.js';

interface ActAndWaitResult {
  effect: { ok: boolean; ref?: string; action?: string };
  verdict: { pass: boolean; failureReason?: string };
  trace: { window_ms: number; summary: { network: number } };
}

describe('reticle_act_and_wait (composite)', () => {
  let bridge: Bridge;
  let deps: ToolDeps;
  let browser: FakeBrowser;

  beforeAll(async () => {
    bridge = new Bridge({ port: 0 });
    const port = await bridge.ready;
    deps = makeDeps(bridge);
    browser = new FakeBrowser(port, 'demo');
    await browser.open();
    await waitUntil(() => bridge.sessions.count() === 1);
  });

  afterAll(async () => {
    browser.close();
    await bridge.close();
  });

  it('is registered with ref/action/until in its schema', () => {
    const tool = TOOLS.find((t) => t.name === 'reticle_act_and_wait');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema['ref']).toBeDefined();
    expect(tool?.inputSchema['action']).toBeDefined();
    expect(tool?.inputSchema['until']).toBeDefined();
  });

  it('acts and returns effect + passing verdict + trace when the predicate holds', async () => {
    browser.matcher = (q) => q.role === 'dialog' || (q.name ?? '').includes('Order confirmed');
    const result = (await callTool(deps, 'reticle_act_and_wait', {
      ref: 'e7',
      action: 'click',
      timeout_ms: 1000,
      until: {
        kind: 'element',
        query: { role: 'dialog', name: 'Order confirmed' },
        state: 'visible',
      },
    })) as ActAndWaitResult;

    expect(result.effect.ok).toBe(true);
    expect(result.verdict.pass, result.verdict.failureReason).toBe(true);
    expect(result.trace).toBeDefined();
    expect(typeof result.trace.window_ms).toBe('number');
    browser.matcher = () => false;
  });

  it('captures post-act network events in the trace and passes on the late event', async () => {
    // Start the act-and-wait first; the predicate is NOT yet satisfiable.
    const pending = callTool(deps, 'reticle_act_and_wait', {
      ref: 'e7',
      action: 'click',
      timeout_ms: 2000,
      until: { kind: 'net', method: 'POST', urlContains: '/api/order', status: 200 },
    }) as Promise<ActAndWaitResult>;

    // The app reacts after the act: the poll inside waitForPredicate catches it.
    browser.emit(EventType.NET_REQUEST, { method: 'POST', url: '/api/order', status: 200 });

    const result = await pending;
    expect(result.effect.ok).toBe(true);
    expect(result.verdict.pass, result.verdict.failureReason).toBe(true);
    expect(result.trace.summary.network).toBeGreaterThanOrEqual(1);
  });

  it('still returns effect + trace when the predicate times out', async () => {
    const result = (await callTool(deps, 'reticle_act_and_wait', {
      ref: 'e7',
      action: 'click',
      timeout_ms: 200,
      until: { kind: 'route', pathname: '/never-happens' },
    })) as ActAndWaitResult;

    expect(result.effect.ok).toBe(true);
    expect(result.verdict.pass).toBe(false);
    expect(result.verdict.failureReason).toBeTruthy();
    expect(result.trace).toBeDefined();
  });

  it('evaluates the predicate once when timeout_ms is 0', async () => {
    browser.matcher = (q) => q.role === 'dialog' || (q.name ?? '').includes('Order confirmed');
    const result = (await callTool(deps, 'reticle_act_and_wait', {
      ref: 'e7',
      action: 'click',
      timeout_ms: 0,
      until: {
        kind: 'element',
        query: { role: 'dialog', name: 'Order confirmed' },
        state: 'visible',
      },
    })) as ActAndWaitResult;

    expect(result.verdict.pass).toBe(true);
    browser.matcher = () => false;
  });
});

/**
 * A red verdict is the moment the agent most needs to know which file to open, and the file is
 * already in hand — the browser captures it alongside the anchor at act time. It used to sit nested
 * inside the effect block (when it was captured at all), which is most of the way to not reporting it.
 *
 * Promoted on RED only: on a passing action nobody reads it and it is pure noise on the path the
 * agent walks most.
 */
describe('reticle_act_and_wait reports where the failure came from', () => {
  let bridge: Bridge;
  let deps: ToolDeps;
  let browser: FakeBrowser;

  beforeAll(async () => {
    bridge = new Bridge({ port: 0 });
    const port = await bridge.ready;
    deps = makeDeps(bridge);
    browser = new FakeBrowser(port, 'demo');
    await browser.open();
    await waitUntil(() => bridge.sessions.count() === 1);
  });

  afterAll(async () => {
    browser.close();
    await bridge.close();
  });

  const act = async (): Promise<{ verdict: { pass: boolean }; source?: string }> =>
    (await callTool(deps, 'reticle_act_and_wait', {
      ref: 'e7',
      action: 'click',
      timeout_ms: 50,
      until: {
        kind: 'element',
        query: { role: 'dialog', name: 'never appears' },
        state: 'visible',
      },
    })) as { verdict: { pass: boolean }; source?: string };

  it('names the file:line on a failing action', async () => {
    browser.matcher = () => false;
    browser.actSource = { file: 'src/views/Checkout.tsx', line: 88 };
    const result = await act();
    expect(result.verdict.pass).toBe(false);
    expect(result.source).toBe('src/views/Checkout.tsx:88');
  });

  it('omits source when the app was not built with the stamp', async () => {
    browser.matcher = () => false;
    browser.actSource = undefined;
    const result = await act();
    expect(result.verdict.pass).toBe(false);
    expect(result.source).toBeUndefined();
  });

  it('stays quiet on a passing action', async () => {
    browser.actSource = { file: 'src/views/Checkout.tsx', line: 88 };
    browser.matcher = (q) => q.role === 'dialog';
    const result = (await callTool(deps, 'reticle_act_and_wait', {
      ref: 'e7',
      action: 'click',
      timeout_ms: 1000,
      until: { kind: 'element', query: { role: 'dialog' }, state: 'visible' },
    })) as { verdict: { pass: boolean }; source?: string };
    expect(result.verdict.pass).toBe(true);
    expect(result.source).toBeUndefined();
    browser.matcher = () => false;
  });
});

/**
 * Coverage is LEVEL state, not an event stream.
 *
 * The SDK emits BLIND_SPOT only when the count changes, so a page that mounts two cross-origin frames
 * at load announces them once at t=0 and is silent forever after. Deriving coverage from a single
 * act's window therefore saw nothing and reported `coverage: { pct: 100, partial: false }` — a
 * positive claim to have observed a page a third of which the SDK cannot see. The act tool's own
 * description tells harnesses to gate on that block, so the wrong value was load-bearing.
 */
describe('coverage reflects blind spots reported before this act', () => {
  let bridge: Bridge;
  let deps: ToolDeps;
  let browser: FakeBrowser;

  beforeAll(async () => {
    bridge = new Bridge({ port: 0 });
    const port = await bridge.ready;
    deps = makeDeps(bridge);
    browser = new FakeBrowser(port, 'demo');
    await browser.open();
    await waitUntil(() => bridge.sessions.count() === 1);
  });

  afterAll(async () => {
    browser.close();
    await bridge.close();
  });

  const actOnce = async (): Promise<{
    honesty: { coverage: { pct?: number; partial: boolean } };
  }> =>
    (await callTool(deps, 'reticle_act_and_wait', {
      ref: 'e7',
      action: 'click',
      timeout_ms: 50,
      until: { kind: 'element', query: { role: 'dialog' }, state: 'visible' },
    })) as { honesty: { coverage: { pct?: number; partial: boolean } } };

  it('reports full coverage when nothing blind was ever reported', async () => {
    browser.matcher = () => false;
    const result = await actOnce();
    expect(result.honesty.coverage.partial).toBe(false);
    expect(result.honesty.coverage.pct).toBe(100);
  });

  it('still reports partial on a LATER act, long after the one-shot blind-spot event', async () => {
    browser.emit(EventType.BLIND_SPOT, { kind: 'cross-origin-iframe', count: 2 });
    await waitUntil(() => bridge.sessions.list().length === 1);
    // Two acts: by the second, the announcing event is well outside this act's window — which is
    // exactly the situation that used to report 100%.
    await actOnce();
    const result = await actOnce();
    expect(result.honesty.coverage.partial).toBe(true);
    expect(result.honesty.coverage.pct).toBeUndefined();
  });
});
