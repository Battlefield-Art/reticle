import { describe, expect, it } from 'vitest';
import { TelemetryEventSchema, TelemetryEventKind } from '@reticlehq/core';
import { createTelemetry } from './telemetry.js';

/** A key so the emitter is live in tests — dev builds ship an empty embedded key (telemetry off). */
const TEST_ENV = { RETICLE_TELEMETRY_KEY: 'phc_test', RETICLE_TELEMETRY_URL: 'http://example.test' };

/** The PostHog batch envelope the emitter builds (asserted, not assumed — this IS the wire). */
interface CapturedBatch {
  api_key: string;
  batch: Array<{
    event: string;
    distinct_id: string;
    timestamp: string;
    properties: Record<string, unknown>;
  }>;
}

/** A fetch double that records the last request instead of hitting the network. */
const recordingFetch = () => {
  const calls: Array<{ url: string; body: CapturedBatch }> = [];
  const impl = ((url: string, init: { body?: string }) => {
    calls.push({ url, body: JSON.parse(init.body ?? '{}') as CapturedBatch });
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as unknown as typeof fetch;
  return { impl, calls };
};

describe('telemetry emitter', () => {
  it('is a no-op (and never sends) when opted out', async () => {
    const { impl, calls } = recordingFetch();
    const t = createTelemetry({
      version: '9.9.9',
      env: { ...TEST_ENV, RETICLE_TELEMETRY: '0' },
      fetchImpl: impl,
    });
    expect(t.enabled).toBe(false);
    await t.emit(TelemetryEventKind.INVOKE);
    expect(calls).toHaveLength(0);
  });

  it('respects the DO_NOT_TRACK convention', () => {
    expect(
      createTelemetry({ version: '1', env: { ...TEST_ENV, DO_NOT_TRACK: '1' } }).enabled,
    ).toBe(false);
  });

  it('is a no-op under vitest (a test run must never phone home)', () => {
    expect(
      createTelemetry({ version: '1', env: { ...TEST_ENV, VITEST: 'true' } }).enabled,
    ).toBe(false);
  });

  it('is a no-op when no PostHog key is available', () => {
    expect(
      createTelemetry({ version: '1', env: { RETICLE_TELEMETRY_KEY: '' } }).enabled,
    ).toBe(false);
  });

  it('sends a PostHog batch whose payload satisfies the core wire schema', async () => {
    const { impl, calls } = recordingFetch();
    const t = createTelemetry({
      version: '2.2.0',
      env: { ...TEST_ENV, CI: '1' },
      cwd: '/tmp/proj-a',
      now: () => 1700,
      fetchImpl: impl,
    });
    await t.emit(TelemetryEventKind.INVOKE);
    expect(calls[0]?.url).toBe('http://example.test/batch/');
    const body = calls[0]?.body;
    expect(body?.api_key).toBe('phc_test');
    const item = body?.batch[0];
    expect(item?.event).toBe(TelemetryEventKind.INVOKE);
    expect(item?.timestamp).toBe(new Date(1700).toISOString());
    // Reassembled, the capture item must round-trip through the core contract.
    const parsed = TelemetryEventSchema.safeParse({
      ...item?.properties,
      anonymousId: item?.distinct_id,
      event: item?.event,
      ts: Date.parse(item?.timestamp ?? ''),
    });
    expect(parsed.success).toBe(true);
    expect(item?.properties['ci']).toBe(true);
    expect(item?.properties['version']).toBe('2.2.0');
    // Personless mode: anonymous-by-construction users must never create PostHog person profiles.
    expect(item?.properties['$process_person_profile']).toBe(false);
    // The project fingerprint is a hash — never the raw path.
    expect(item?.properties['projectId']).not.toContain('proj-a');
  });

  it('carries the tool name on TOOL events', async () => {
    const { impl, calls } = recordingFetch();
    const t = createTelemetry({ version: '1', env: TEST_ENV, fetchImpl: impl });
    await t.emit(TelemetryEventKind.TOOL, { tool: 'reticle_act' });
    const item = calls[0]?.body.batch[0];
    expect(item?.event).toBe(TelemetryEventKind.TOOL);
    expect(item?.properties['tool']).toBe('reticle_act');
  });

  it('hands a detached emit to a disowned child instead of fetching in-process', async () => {
    const spawns: Array<{ command: string; args: string[] }> = [];
    const t = createTelemetry({
      version: '1',
      env: TEST_ENV,
      spawnImpl: (command, args) => spawns.push({ command, args }),
    });
    await t.emit(TelemetryEventKind.INVOKE, { detach: true });
    expect(spawns).toHaveLength(1);
    const args = spawns[0]?.args ?? [];
    expect(args[2]).toBe('http://example.test/batch/');
    const body = JSON.parse(args[3] ?? '{}') as CapturedBatch;
    expect(body.api_key).toBe('phc_test');
    expect(body.batch[0]?.event).toBe(TelemetryEventKind.INVOKE);
  });

  it('never rejects when the network throws (best-effort)', async () => {
    const failing = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const t = createTelemetry({ version: '1', env: TEST_ENV, fetchImpl: failing });
    await expect(t.emit(TelemetryEventKind.INVOKE)).resolves.toBeUndefined();
  });
});
