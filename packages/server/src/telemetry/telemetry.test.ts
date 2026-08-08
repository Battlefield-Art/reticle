import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TelemetryEventSchema, TelemetryEventKind } from '@reticlehq/core';
import { createTelemetry, describeTelemetry, setTelemetryEnabled } from './telemetry.js';

/** A key so the emitter is live in tests — dev builds ship an empty embedded key (telemetry off). */
const TEST_ENV = {
  RETICLE_TELEMETRY_KEY: 'phc_test',
  RETICLE_TELEMETRY_URL: 'http://example.test',
};

/**
 * A cwd OUTSIDE this repository. Telemetry is disabled whenever it runs from a Reticle source
 * checkout — developing the library is not using it — and these tests run from inside one, so they
 * must state plainly that they are simulating a user's project. Without this every emitter test
 * would assert against a no-op and pass for the wrong reason.
 */
const USER_PROJECT = '/tmp/some-user-app';

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
    await t.emit(TelemetryEventKind.CLI_COMMAND_RUN);
    expect(calls).toHaveLength(0);
  });

  it('respects the DO_NOT_TRACK convention', () => {
    expect(createTelemetry({ version: '1', env: { ...TEST_ENV, DO_NOT_TRACK: '1' } }).enabled).toBe(
      false,
    );
  });

  it('is a no-op under vitest (a test run must never phone home)', () => {
    expect(createTelemetry({ version: '1', env: { ...TEST_ENV, VITEST: 'true' } }).enabled).toBe(
      false,
    );
  });

  it('is a no-op when no PostHog key is available', () => {
    expect(createTelemetry({ version: '1', env: { RETICLE_TELEMETRY_KEY: '' } }).enabled).toBe(
      false,
    );
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
    // A DAEMON event, because that is the shape carrying every optional block. The CLI event's own
    // (deliberately session-less) shape is asserted in the case below.
    await t.emit(TelemetryEventKind.DAEMON_STARTED);
    expect(calls[0]?.url).toBe('http://example.test/batch/');
    const body = calls[0]?.body;
    expect(body?.api_key).toBe('phc_test');
    const item = body?.batch[0];
    expect(item?.event).toBe(TelemetryEventKind.DAEMON_STARTED);
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

  /**
   * There is deliberately no per-tool-call event any more: a verification loop is 50-200 calls and
   * PostHog bills per event, so tool usage now rides out ONCE inside the session summary. This asserts
   * the replacement carries the same answer -- which tool was used how often -- in one event.
   */
  it('carries the tool histogram on the session summary, not one event per call', async () => {
    const { impl, calls } = recordingFetch();
    const t = createTelemetry({
      cwd: USER_PROJECT,
      version: '1',
      env: TEST_ENV,
      fetchImpl: impl,
    });
    await t.emit(TelemetryEventKind.DAEMON_STOPPED, {
      session: {
        durationMs: 1000,
        toolCalls: 3,
        toolCounts: { reticle_act: 2, reticle_assert: 1 },
        toolErrors: 0,
        verifications: 1,
        final: true,
      },
    });
    const item = calls[0]?.body.batch[0];
    expect(item?.event).toBe(TelemetryEventKind.DAEMON_STOPPED);
    // Flattened under a prefix so PostHog breakdowns can reach it without raw HogQL...
    expect(item?.properties['session_toolCalls']).toBe(3);
    expect(item?.properties['session_final']).toBe(true);
    // ...but the open-ended maps stay objects: flattening them would mint unbounded property names.
    expect(item?.properties['session_toolCounts']).toEqual({ reticle_act: 2, reticle_assert: 1 });
  });

  it('hands a detached emit to a disowned child instead of fetching in-process', async () => {
    const spawns: Array<{ command: string; args: string[] }> = [];
    const t = createTelemetry({
      cwd: USER_PROJECT,
      version: '1',
      env: TEST_ENV,
      spawnImpl: (command, args) => spawns.push({ command, args }),
    });
    await t.emit(TelemetryEventKind.CLI_COMMAND_RUN, { detach: true });
    expect(spawns).toHaveLength(1);
    const args = spawns[0]?.args ?? [];
    expect(args[2]).toBe('http://example.test/batch/');
    const body = JSON.parse(args[3] ?? '{}') as CapturedBatch;
    expect(body.api_key).toBe('phc_test');
    expect(body.batch[0]?.event).toBe(TelemetryEventKind.CLI_COMMAND_RUN);
  });

  it('persists and lifts the machine-wide opt-out (`reticle telemetry disable`/`enable`)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reticle-telemetry-'));
    try {
      expect(describeTelemetry({}, dir, USER_PROJECT).enabled).toBe(true);
      setTelemetryEnabled(false, dir);
      expect(describeTelemetry({}, dir, USER_PROJECT).enabled).toBe(false);
      setTelemetryEnabled(true, dir);
      expect(describeTelemetry({}, dir, USER_PROJECT).enabled).toBe(true);
      // The env-var opt-out wins regardless of the file state.
      expect(describeTelemetry({ RETICLE_TELEMETRY: '0' }, dir, USER_PROJECT).enabled).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never rejects when the network throws — and reports the failure rather than hiding it', async () => {
    const failing = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const t = createTelemetry({
      cwd: USER_PROJECT,
      version: '1',
      env: TEST_ENV,
      fetchImpl: failing,
    });
    // Resolving is the contract — a lost metric must never surface to a user. But it resolves FALSE,
    // because one caller (reticle_feedback) shows a receipt to an agent and must not claim delivery.
    await expect(t.emit(TelemetryEventKind.CLI_COMMAND_RUN)).resolves.toBe(false);
  });

  /**
   * The other half of the same contract. `reticle_feedback` returned `sent: true` unconditionally
   * while the send could fail silently, so a DNS miss and a 4xx both read as filed — on the only
   * qualitative channel the product has. `emit` now answers whether the event actually landed.
   */
  it('reports TRUE when the event actually lands', async () => {
    const { impl } = recordingFetch();
    const t = createTelemetry({ cwd: USER_PROJECT, version: '1', env: TEST_ENV, fetchImpl: impl });
    await expect(t.emit(TelemetryEventKind.CLI_COMMAND_RUN)).resolves.toBe(true);
  });

  it('reports FALSE when the endpoint REJECTS the payload — a 4xx is not a delivery', async () => {
    const rejecting = (() =>
      Promise.resolve({ ok: false, status: 400 })) as unknown as typeof fetch;
    const t = createTelemetry({
      cwd: USER_PROJECT,
      version: '1',
      env: TEST_ENV,
      fetchImpl: rejecting,
    });
    await expect(t.emit(TelemetryEventKind.CLI_COMMAND_RUN)).resolves.toBe(false);
  });
});
