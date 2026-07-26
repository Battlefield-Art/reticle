import { describe, expect, it } from 'vitest';
import {
  EventAttribution,
  EventType,
  type JournalAction,
  type ReticleEvent,
} from '@reticlehq/core';
import { JournalRecorder, type JournalSink } from './journal-recorder.js';

function evt(seq: number): ReticleEvent {
  return { t: seq, seq, type: EventType.NET_REQUEST, sessionId: 'demo', data: {} };
}

/** A fake sink that records batches and actions in call order, for asserting attribution + ordering. */
function fakeSink(): JournalSink & {
  events: ReticleEvent[];
  actions: JournalAction[];
  log: string[];
} {
  const events: ReticleEvent[] = [];
  const actions: JournalAction[] = [];
  const log: string[] = [];
  return {
    events,
    actions,
    log,
    appendEvents(batch) {
      events.push(...batch);
      log.push(`events:${batch.length}`);
      return Promise.resolve();
    },
    appendAction(action) {
      actions.push(action);
      log.push(`action:${action.actionId}`);
      return Promise.resolve();
    },
  };
}

/** Injectable elapsed clock returning preset values in sequence, last value sticking. */
function stepClock(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe('JournalRecorder', () => {
  it('journals ambient events with no attribution when no action is active', async () => {
    const sink = fakeSink();
    const rec = new JournalRecorder(sink, { now: () => 0, flushAt: 100 });
    const out = rec.observe(evt(0));
    expect(out.actionId).toBeUndefined();
    await rec.flush();
    expect(sink.events).toHaveLength(1);
    expect(sink.actions).toHaveLength(0);
  });

  it('attributes events inside an action window and records seqRange + tRange', async () => {
    const sink = fakeSink();
    const rec = new JournalRecorder(sink, { now: stepClock([10, 42]), flushAt: 100 });
    rec.beginAction('c1', 'reticle_act', { ref: 'e7' }); // now->10 (tStart)
    const a = rec.observe(evt(3));
    const b = rec.observe(evt(5));
    expect(a.actionId).toBe('c1');
    expect(a.attribution).toBe(EventAttribution.WINDOW);
    expect(b.actionId).toBe('c1');
    rec.finishAction({ glyph: 'pass' }, true, 32); // now->42 (tEnd)
    await rec.flush();
    const action = sink.actions[0];
    expect(action?.actionId).toBe('c1');
    expect(action?.seqRange).toEqual({ from: 3, to: 5 });
    expect(action?.tRange).toEqual({ from: 10, to: 42 });
    expect(action?.settled).toBe(true);
    expect(action?.settledInMs).toBe(32);
  });

  it('flushes attributed events before the action that closes them (ordering)', async () => {
    const sink = fakeSink();
    const rec = new JournalRecorder(sink, { now: () => 0, flushAt: 100 });
    rec.beginAction('c1', 'reticle_act', {});
    rec.observe(evt(0));
    rec.finishAction();
    await rec.flush();
    expect(sink.log).toEqual(['events:1', 'action:c1']);
  });

  it('finishAction with no active action is a no-op', async () => {
    const sink = fakeSink();
    const rec = new JournalRecorder(sink, { now: () => 0 });
    rec.finishAction();
    await rec.flush();
    expect(sink.actions).toHaveLength(0);
  });

  it('auto-flushes a batch once flushAt events accumulate', async () => {
    const sink = fakeSink();
    const rec = new JournalRecorder(sink, { now: () => 0, flushAt: 2 });
    rec.observe(evt(0));
    rec.observe(evt(1)); // reaches flushAt -> flush
    await rec.flush();
    expect(sink.events.map((e) => e.seq)).toEqual([0, 1]);
  });

  it('an action with no observed events records no seqRange', async () => {
    const sink = fakeSink();
    const rec = new JournalRecorder(sink, { now: () => 0 });
    rec.beginAction('c9', 'reticle_navigate', {});
    rec.finishAction();
    await rec.flush();
    expect(sink.actions[0]?.seqRange).toBeUndefined();
  });
});
