import type { EnvelopeStore } from './envelope-store.js';
import { addSegmentToEnvelope, emptyEnvelope } from './envelope.js';
import { buildDeviationReport, type DeviationReport } from './deviation-report.js';
import type { SegmentRollup } from './rollups.js';

/**
 * The accumulate-and-compare loop behind the push default. Given the segments a drive/replay produced:
 * judge them against the envelopes learned from PAST runs, then fold them in so the baseline sharpens
 * over time. Order matters — compare first, learn second — so a run never grades itself against a
 * baseline it just polluted. Below MIN_ENVELOPE_SAMPLES the report says insufficientSamples and the
 * caller shows the causal summary instead.
 */
export async function reportAndAccumulate(
  store: EnvelopeStore,
  segments: readonly SegmentRollup[],
  zThreshold?: number,
): Promise<DeviationReport> {
  const envelopes = await store.load();
  const report = buildDeviationReport(envelopes, segments, zThreshold);
  for (const segment of segments) {
    if (segment.route === undefined) continue;
    // Never learn from a truncated sample — its understated counts would poison the baseline.
    if (segment.truncated === true) continue;
    const current = envelopes.get(segment.route) ?? emptyEnvelope(segment.route);
    envelopes.set(segment.route, addSegmentToEnvelope(current, segment));
  }
  await store.save(envelopes);
  return report;
}
