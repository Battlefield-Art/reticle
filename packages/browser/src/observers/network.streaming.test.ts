import { describe, it, expect, vi, afterEach } from 'vitest';
import { installNetwork } from './network.js';
import type { Emit, Teardown } from './types.js';

/**
 * Body capture must never make the app's own `fetch` wait.
 *
 * The observer reads a CLONE of the response so the app's stream stays untouched — but it awaited that
 * clone BEFORE returning the response. A clone of a stream only settles when the stream ends, and an
 * SSE stream does not end, so `await fetch('/api/chat')` never resolved. `text/event-stream` matches
 * `text/` in CAPTURABLE_CONTENT, so simply enabling body capture hung every streaming endpoint: a
 * permanently loading UI, and no reason for the developer to suspect the observability SDK.
 *
 * These tests assert the host app's control flow, not the emitted event — the app resolving is the
 * property that matters.
 */

const teardowns: Teardown[] = [];
afterEach(() => {
  for (const t of teardowns.splice(0)) t();
  vi.unstubAllGlobals();
});

function collect(): { emit: Emit; events: Array<{ type: string; data: Record<string, unknown> }> } {
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  return { emit: (type, data) => events.push({ type, data }), events };
}

/** A response whose body never completes — an SSE endpoint held open by the server. */
function neverEndingResponse(contentType: string): Response {
  const res = {
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    status: 200,
    ok: true,
    clone: () => ({ text: () => new Promise<string>(() => undefined) }),
  };
  return res as unknown as Response;
}

describe('body capture must not block the host app', () => {
  it('returns an SSE response to the app instead of waiting for the stream to end', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(neverEndingResponse('text/event-stream')));
    const { emit } = collect();
    teardowns.push(installNetwork(emit, { captureBodies: true }));

    // If the observer awaits the clone, this never settles and the test times out — which is exactly
    // what the host app experiences.
    const res = await Promise.race([
      window.fetch('/api/chat'),
      new Promise((resolve) => setTimeout(() => resolve('HUNG'), 1000)),
    ]);
    expect(res).not.toBe('HUNG');
  });

  it('returns a chunked JSON response promptly too (token-streaming model APIs)', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(neverEndingResponse('application/json')));
    const { emit } = collect();
    teardowns.push(installNetwork(emit, { captureBodies: true }));
    const res = await Promise.race([
      window.fetch('/api/completions'),
      // Bounded, not unbounded: a content-type-less stream costs the app the body deadline once,
      // never the lifetime of the stream.
      new Promise((resolve) => setTimeout(() => resolve('HUNG'), 1500)),
    ]);
    expect(res).not.toBe('HUNG');
  });

  it('still captures a normal, complete JSON body', async () => {
    const body = JSON.stringify({ ok: true });
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        headers: { get: () => 'application/json' },
        status: 200,
        ok: true,
        clone: () => ({ text: () => Promise.resolve(body) }),
      } as unknown as Response),
    );
    const { emit, events } = collect();
    teardowns.push(installNetwork(emit, { captureBodies: true }));
    await window.fetch('/api/thing');
    const withBody = events.find((e) => e.data['responseBody'] !== undefined);
    expect(String(withBody?.data['responseBody'])).toContain('ok');
  });
});
