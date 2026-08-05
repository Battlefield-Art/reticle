import { describe, expect, it } from 'vitest';
import { ContradictionKind, EventType, type ReticleEvent } from '@reticlehq/core';
import { findStaleResponses } from './stale-response.js';

/**
 * The negatives matter more than the positive here. A race is reported as a hard contradiction, so a
 * rule that fires on ordinary traffic would train agents to ignore the field — which costs more than
 * never having built it.
 */
let seq = 0;
const pending = (t: number, url: string, id = `r${String((seq += 1))}`, method = 'GET') =>
  ({ type: EventType.NET_PENDING, t, data: { id, url, method } }) as unknown as ReticleEvent;
const settled = (t: number, id: string) =>
  ({ type: EventType.NET_REQUEST, t, data: { id, status: 200 } }) as unknown as ReticleEvent;

describe('stale response detection', () => {
  it('reports overlapping reads of one endpoint that settled out of order', () => {
    const events = [
      pending(0, '/api/shipments?status=all', 'a'),
      pending(60, '/api/shipments?status=held', 'b'),
      settled(150, 'b'), // the newer query answered first
      settled(700, 'a'), // the superseded one landed last and overwrote it
    ];
    const found = findStaleResponses(events);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe(ContradictionKind.STALE_RESPONSE_APPLIED);
    expect(found[0]?.counter).toContain('550ms AFTER');
    expect(found[0]?.counter).toContain('status=all');
  });

  it('stays silent when the responses settled in order', () => {
    expect(
      findStaleResponses([
        pending(0, '/api/shipments?status=all', 'a'),
        pending(60, '/api/shipments?status=held', 'b'),
        settled(200, 'a'),
        settled(300, 'b'),
      ]),
    ).toEqual([]);
  });

  it('stays silent for SEQUENTIAL requests — no overlap means no race', () => {
    expect(
      findStaleResponses([
        pending(0, '/api/shipments?status=all', 'a'),
        settled(100, 'a'),
        pending(200, '/api/shipments?status=held', 'b'),
        settled(250, 'b'),
      ]),
    ).toEqual([]);
  });

  it('stays silent for a retry — same query is a duplicate, not a supersede', () => {
    expect(
      findStaleResponses([
        pending(0, '/api/shipments?status=all', 'a'),
        pending(10, '/api/shipments?status=all', 'b'),
        settled(50, 'b'),
        settled(400, 'a'),
      ]),
    ).toEqual([]);
  });

  it('stays silent for two DIFFERENT endpoints racing', () => {
    expect(
      findStaleResponses([
        pending(0, '/api/shipments?page=1', 'a'),
        pending(10, '/api/carriers?page=1', 'b'),
        settled(50, 'b'),
        settled(400, 'a'),
      ]),
    ).toEqual([]);
  });

  it('ignores writes — two overlapping POSTs are a different problem', () => {
    expect(
      findStaleResponses([
        pending(0, '/api/dispatch?id=1', 'a', 'POST'),
        pending(10, '/api/dispatch?id=2', 'b', 'POST'),
        settled(50, 'b'),
        settled(400, 'a'),
      ]),
    ).toEqual([]);
  });

  it('ignores a request whose start is outside the window — its ordering is unknowable', () => {
    expect(
      findStaleResponses([
        pending(60, '/api/shipments?status=held', 'b'),
        settled(150, 'b'),
        settled(700, 'a'), // no pending for 'a' in this window
      ]),
    ).toEqual([]);
  });

  it('stays silent on a quiet window', () => {
    expect(findStaleResponses([])).toEqual([]);
  });
});

describe('parallel fan-out is not a race', () => {
  // Measured on a synthetic dashboard fetching pages in parallel: every run reported a race, because
  // the requests genuinely overlap and genuinely settle out of order. They are not superseding each
  // other — the app wants both results — and accusing every paginating app would be worse than the
  // detection is worth.
  it('stays silent when two overlapping reads differ only by page', () => {
    expect(
      findStaleResponses([
        pending(0, '/api/list?status=all&page=1', 'a'),
        pending(5, '/api/list?status=all&page=2', 'b'),
        settled(100, 'b'),
        settled(900, 'a'),
      ]),
    ).toEqual([]);
  });

  it.each(['offset=0/offset=50', 'cursor=x/cursor=y', 'limit=10/limit=20'])(
    'stays silent for %s',
    (pair) => {
      const [one, two] = pair.split('/');
      expect(
        findStaleResponses([
          pending(0, `/api/list?${String(one)}`, 'a'),
          pending(5, `/api/list?${String(two)}`, 'b'),
          settled(100, 'b'),
          settled(900, 'a'),
        ]),
      ).toEqual([]);
    },
  );

  it('STILL reports a race when a selecting parameter changed alongside the page', () => {
    // Changing the filter is what makes the older request obsolete; that the page moved too is
    // incidental, and treating the pair as enumeration would hide a real race.
    const found = findStaleResponses([
      pending(0, '/api/list?status=all&page=1', 'a'),
      pending(5, '/api/list?status=held&page=2', 'b'),
      settled(100, 'b'),
      settled(900, 'a'),
    ]);
    expect(found).toHaveLength(1);
  });

  it('compares only within one endpoint — two different paths never race', () => {
    expect(
      findStaleResponses([
        pending(0, '/api/list?status=all', 'a'),
        pending(5, '/api/other?status=held', 'b'),
        settled(100, 'b'),
        settled(900, 'a'),
      ]),
    ).toEqual([]);
  });
});
