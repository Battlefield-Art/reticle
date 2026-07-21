import { describe, it, expect, afterEach } from 'vitest';
import { EventType, BlindSpotKind } from '@reticlehq/core';
import { isCrossOriginFrame, countCrossOriginFrames } from './blind-spots.js';
import type { Emit, Teardown } from './types.js';

/** A minimal iframe stand-in — enough surface for the pure predicate. */
function frame(src: string | null, contentDocument: unknown, throwOnAccess = false): HTMLIFrameElement {
  return {
    getAttribute: (n: string) => (n === 'src' ? src : null),
    get contentDocument() {
      if (throwOnAccess) throw new DOMException('cross-origin');
      return contentDocument as Document | null;
    },
  } as unknown as HTMLIFrameElement;
}

describe('isCrossOriginFrame', () => {
  it('flags a src-bearing frame whose contentDocument is null (cross-origin)', () => {
    expect(isCrossOriginFrame(frame('https://pay.stripe.com', null))).toBe(true);
  });

  it('flags a frame that throws on contentDocument access (SecurityError)', () => {
    expect(isCrossOriginFrame(frame('https://other.example', null, true))).toBe(true);
  });

  it('does NOT flag a same-origin frame (contentDocument present)', () => {
    expect(isCrossOriginFrame(frame('/local.html', {}))).toBe(false);
  });

  it('does NOT flag a srcless / about:blank frame (same-origin, just not navigated)', () => {
    expect(isCrossOriginFrame(frame(null, null))).toBe(false);
    expect(isCrossOriginFrame(frame('', null))).toBe(false);
  });
});

describe('countCrossOriginFrames', () => {
  it('counts only the cross-origin frames in a list', () => {
    const frames = [
      frame('https://pay.stripe.com', null),
      frame('/local.html', {}),
      frame('https://widget.other', null, true),
    ];
    expect(countCrossOriginFrames(frames)).toBe(2);
  });
});

describe('installBlindSpots', () => {
  let teardown: Teardown | undefined;
  afterEach(() => {
    teardown?.();
    teardown = undefined;
  });

  it('emits BLIND_SPOT once on install when a cross-origin frame is present', async () => {
    // jsdom doesn't fetch, so a foreign-src iframe still exposes a same-origin blank doc — we can't get a
    // real cross-origin frame here. Stub querySelectorAll to hand the sensor a genuinely-foreign frame.
    const foreign = frame('https://pay.stripe.com', null);
    const original = document.querySelectorAll.bind(document);
    document.querySelectorAll = ((sel: string) =>
      sel === 'iframe' ? [foreign] : original(sel)) as typeof document.querySelectorAll;

    const events: { type: EventType; data: Record<string, unknown> }[] = [];
    const emit: Emit = (type, data) => events.push({ type, data });
    try {
      const { installBlindSpots } = await import('./blind-spots.js');
      teardown = installBlindSpots(emit);
      const spots = events.filter((e) => e.type === EventType.BLIND_SPOT);
      expect(spots).toHaveLength(1); // reported once, not per-mutation
      expect(spots[0]?.data['kind']).toBe(BlindSpotKind.CROSS_ORIGIN_IFRAME);
      expect(spots[0]?.data['count']).toBe(1);
    } finally {
      document.querySelectorAll = original;
    }
  });
});
