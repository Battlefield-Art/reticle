import { describe, expect, it } from 'vitest';
import { TelemetryBatchSchema, TelemetryEventKind } from '@reticlehq/core';
import { createTelemetry } from './telemetry.js';

/** A fetch double that records the last request instead of hitting the network. */
const recordingFetch = () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const impl = ((url: string, init: { body?: string }) => {
    calls.push({ url, body: JSON.parse(init.body ?? '{}') });
    return Promise.resolve(new Response(null, { status: 202 }));
  }) as unknown as typeof fetch;
  return { impl, calls };
};

describe('telemetry emitter', () => {
  it('is a no-op (and never sends) when opted out', async () => {
    const { impl, calls } = recordingFetch();
    const t = createTelemetry({
      version: '9.9.9',
      env: { RETICLE_TELEMETRY: '0' },
      fetchImpl: impl,
    });
    expect(t.enabled).toBe(false);
    await t.emit(TelemetryEventKind.INVOKE);
    expect(calls).toHaveLength(0);
  });

  it('respects the DO_NOT_TRACK convention', () => {
    expect(createTelemetry({ version: '1', env: { DO_NOT_TRACK: '1' } }).enabled).toBe(false);
  });

  it('sends a batch that satisfies the core wire schema', async () => {
    const { impl, calls } = recordingFetch();
    const t = createTelemetry({
      version: '2.2.0',
      env: { RETICLE_TELEMETRY_URL: 'http://example.test', CI: '1' },
      cwd: '/tmp/proj-a',
      now: () => 1700,
      fetchImpl: impl,
    });
    await t.emit(TelemetryEventKind.INVOKE);
    expect(calls[0]?.url).toBe('http://example.test/v1/telemetry');
    const parsed = TelemetryBatchSchema.safeParse(calls[0]?.body);
    expect(parsed.success).toBe(true);
    const event = parsed.success ? parsed.data.events[0] : undefined;
    expect(event?.event).toBe(TelemetryEventKind.INVOKE);
    expect(event?.ci).toBe(true);
    expect(event?.version).toBe('2.2.0');
    // The project fingerprint is a hash — never the raw path.
    expect(event?.projectId).not.toContain('proj-a');
  });

  it('never rejects when the network throws (best-effort)', async () => {
    const failing = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const t = createTelemetry({
      version: '1',
      env: { RETICLE_TELEMETRY_URL: 'http://x.test' },
      fetchImpl: failing,
    });
    await expect(t.emit(TelemetryEventKind.INVOKE)).resolves.toBeUndefined();
  });
});
