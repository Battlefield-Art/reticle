import { describe, expect, it } from 'vitest';
import { EventType, type ReticleEvent } from '@reticlehq/core';
import { accumulateAmbient, excludeAmbient, isAmbient, DEFAULT_AMBIENT_THRESHOLD } from './ambient.js';

function evt(ref: string | undefined, actionId?: string): ReticleEvent {
  return {
    t: 0,
    seq: 0,
    type: EventType.DOM_ADDED,
    sessionId: 'demo',
    data: {},
    ...(ref === undefined ? {} : { ref }),
    ...(actionId === undefined ? {} : { actionId }),
  };
}

describe('ambient learning', () => {
  it('counts only unattributed, ref-bearing churn', () => {
    const counts = accumulateAmbient({}, [
      evt('chat'),
      evt('chat'),
      evt('chat', 'a1'), // attributed → not ambient
      evt(undefined), // no ref → ignored
    ]);
    expect(counts['chat']).toBe(2);
  });

  it('flags a ref as ambient once it passes the threshold', () => {
    let counts = {};
    const churn = Array.from({ length: DEFAULT_AMBIENT_THRESHOLD }, () => evt('ticker'));
    counts = accumulateAmbient(counts, churn);
    expect(isAmbient(counts, 'ticker')).toBe(true);
    expect(isAmbient(counts, 'submit-btn')).toBe(false);
    expect(isAmbient(counts, undefined)).toBe(false);
  });

  it('excludes ambient churn but keeps non-ambient and action-attributed events', () => {
    const counts = { ticker: 999 };
    const events = [evt('ticker'), evt('submit-btn'), evt('ticker', 'a1')];
    const kept = excludeAmbient(counts, events);
    // ambient ticker churn dropped; the button survives, and so does the action-attributed ticker event
    expect(kept.map((e) => e.ref)).toEqual(['submit-btn', 'ticker']);
    expect(kept[1]?.actionId).toBe('a1');
  });
});
