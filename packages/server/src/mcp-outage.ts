/**
 * Reporting that the agent lost its Reticle tools.
 *
 * The proxy already writes a full account of an outage to ~/.reticle/mcp-proxy.log, which is exactly
 * where nobody looks and nothing aggregates. So the one question the transport must answer — how
 * often does a real user's MCP server go down, and does it come back — had no answer outside the
 * machine it happened on.
 *
 * Capped at two events per proxy process, and the cap is the design rather than a limitation. One
 * measured afternoon produced 547 proxy reconnects; an event per reconnect would bill for the
 * pathology instead of measuring it, which is the same mistake the per-call `tool` event made before
 * it was removed. What a dashboard needs is the SHARE OF SESSIONS that lose MCP at all (the first
 * outage) and the share where it never came back on its own (the budget being spent).
 */

import { TelemetryEventKind } from '@reticlehq/core';
import { getTelemetry } from './telemetry/telemetry.js';

/** Why the stream went away, as far as the proxy can tell. */
export const OutageStage = {
  /** The first drop of this proxy's life — the session has now experienced an outage. */
  FIRST: 'first',
  /** Retries exhausted; the proxy stopped retrying and went dormant until the client asks again. */
  BUDGET_SPENT: 'budget_spent',
} as const;
export type OutageStage = (typeof OutageStage)[keyof typeof OutageStage];

const reported = new Set<OutageStage>();

/** Reset between tests; a real process reports each stage at most once. */
export function resetOutageReporting(): void {
  reported.clear();
}

/**
 * Report one stage of an outage, at most once per process. Fire-and-forget on purpose: this runs on
 * the transport's recovery path, and a telemetry POST must never be the thing that delays — or
 * fails — the reconnect it is describing.
 */
export function reportMcpOutage(
  stage: OutageStage,
  facts: { reason: string; attempts: number },
): void {
  if (reported.has(stage)) return;
  reported.add(stage);
  void getTelemetry().emit(TelemetryEventKind.MCP_CONNECTION_LOST, { outage: { stage, ...facts } });
}
