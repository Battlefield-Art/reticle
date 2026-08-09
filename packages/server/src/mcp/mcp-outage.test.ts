/**
 * The metric that says whether the MCP transport is actually fixed.
 *
 * Two fixes landed for "the agent lost its tools" — the proxy no longer exits when its retry budget
 * runs out, and it no longer dies on its own uncaught exception. Neither is verifiable from here:
 * the only evidence that matters comes from real installs, and there was no event carrying it.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TelemetryEventKind } from '@reticlehq/core';
import { OutageStage, reportMcpOutage, resetOutageReporting } from './mcp-outage.js';
import { getTelemetry } from '../telemetry/telemetry.js';

describe('reportMcpOutage', () => {
  beforeEach(() => {
    resetOutageReporting();
  });

  it('reports the first outage of a session with its cause', () => {
    const emit = vi.spyOn(getTelemetry(), 'emit').mockResolvedValue(true);
    reportMcpOutage(OutageStage.FIRST, { reason: 'stream ended', attempts: 1 });
    expect(emit).toHaveBeenCalledWith(TelemetryEventKind.MCP_CONNECTION_LOST, {
      outage: { stage: OutageStage.FIRST, reason: 'stream ended', attempts: 1 },
    });
    emit.mockRestore();
  });

  /**
   * The cap IS the design. 547 reconnects were measured in one afternoon; billing per reconnect
   * would pay for the pathology instead of measuring it — the mistake the per-call `tool` event
   * already made here once.
   */
  it('reports each stage at most once, however many times the stream drops', () => {
    const emit = vi.spyOn(getTelemetry(), 'emit').mockResolvedValue(true);
    for (let i = 0; i < 50; i++) {
      reportMcpOutage(OutageStage.FIRST, { reason: 'stream ended', attempts: i + 1 });
    }
    expect(emit).toHaveBeenCalledTimes(1);
    emit.mockRestore();
  });

  it('reports the severe stage separately — stopping retrying is a different fact', () => {
    const emit = vi.spyOn(getTelemetry(), 'emit').mockResolvedValue(true);
    reportMcpOutage(OutageStage.FIRST, { reason: 'stream ended', attempts: 1 });
    reportMcpOutage(OutageStage.BUDGET_SPENT, { reason: 'no daemon', attempts: 61 });
    expect(emit).toHaveBeenCalledTimes(2);
    emit.mockRestore();
  });

  it('never awaits the POST — the transport must not wait on telemetry to reconnect', () => {
    const emit = vi.spyOn(getTelemetry(), 'emit').mockReturnValue(new Promise(() => undefined));
    expect(() => {
      reportMcpOutage(OutageStage.FIRST, { reason: 'stream ended', attempts: 1 });
    }).not.toThrow();
    emit.mockRestore();
  });
});
