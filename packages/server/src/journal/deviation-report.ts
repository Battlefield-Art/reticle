import type { SegmentRollup } from './rollups.js';
import { compareSegment, type Deviation, type RouteEnvelope, MIN_ENVELOPE_SAMPLES } from './envelope.js';

/**
 * The deviation report — the push default. After any drive or replay, this is what the agent gets
 * instead of a raw event dump: the segments that ran outside their learned envelope, ranked, with the
 * in-envelope segments compressed to a single count. When no segment has a mature enough envelope to
 * judge (all below MIN_ENVELOPE_SAMPLES), it says so and the caller falls back to the causal summary.
 */
export interface DeviationReport {
  /** Every flagged metric across all judged segments, ranked most-severe first. */
  deviations: Deviation[];
  /** Judged segments with zero deviations (the "11 segments nominal" line). */
  nominalSegments: number;
  /** Segments whose envelope was mature enough to judge. */
  judgedSegments: number;
  /** True when nothing could be judged — the caller shows the causal summary instead. */
  insufficientSamples: boolean;
  /** One-line human/agent headline. */
  headline: string;
}

function headlineFor(report: Omit<DeviationReport, 'headline'>): string {
  if (report.insufficientSamples) {
    return `envelope too new (need ${String(MIN_ENVELOPE_SAMPLES)} runs) — see causal summary`;
  }
  if (report.deviations.length === 0) {
    return `${String(report.nominalSegments)} segment${report.nominalSegments === 1 ? '' : 's'} nominal`;
  }
  const routes = [...new Set(report.deviations.map((d) => d.route))].join(', ');
  const n = report.deviations.length;
  return `${String(n)} deviation${n === 1 ? '' : 's'}: ${routes}`;
}

/**
 * Judge observed segments against their per-route envelopes. Segments without a route, or whose
 * envelope is too green, are counted as unjudged rather than silently passed.
 */
export function buildDeviationReport(
  envelopes: ReadonlyMap<string, RouteEnvelope>,
  segments: readonly SegmentRollup[],
  zThreshold?: number,
): DeviationReport {
  const deviations: Deviation[] = [];
  let judged = 0;
  let nominal = 0;
  for (const segment of segments) {
    if (segment.route === undefined) continue;
    const envelope = envelopes.get(segment.route);
    if (envelope === undefined || envelope.samples < MIN_ENVELOPE_SAMPLES) continue;
    judged += 1;
    const segDeviations = compareSegment(envelope, segment, zThreshold);
    if (segDeviations.length === 0) nominal += 1;
    else deviations.push(...segDeviations);
  }
  deviations.sort((a, b) => b.z - a.z);
  const base = {
    deviations,
    nominalSegments: nominal,
    judgedSegments: judged,
    insufficientSamples: judged === 0,
  };
  return { ...base, headline: headlineFor(base) };
}
