import { EventType, BlindSpotKind } from '@reticlehq/core';
import type { Emit, Teardown } from './types.js';

/**
 * Blind-spot sensor (W12.4). The SDK instruments the DOM, but a cross-origin iframe is a wall it cannot
 * see through — its contents, network, and console are invisible. Left unstated, a green verdict would
 * imply the whole page was verified. This detects cross-origin frames and emits a BLIND_SPOT event so the
 * server can mark results `coverage: partial` instead of lying by omission. Closed shadow roots and
 * virtualized-unmounted rows are the other kinds (detected elsewhere / by their tools); this sensor owns
 * the iframe case, the one that is cheaply and reliably detectable from the page.
 */

/**
 * Whether a frame is cross-origin (unobservable). A same-origin frame exposes its `contentDocument`; a
 * cross-origin one returns null (or THROWS a SecurityError on access). A src-less / about:blank frame is
 * same-origin and simply not navigated — not a blind spot.
 */
export function isCrossOriginFrame(frame: HTMLIFrameElement): boolean {
  const src = frame.getAttribute('src');
  if (src === null || src.length === 0) return false;
  try {
    return frame.contentDocument === null;
  } catch {
    return true; // SecurityError on access is itself proof of cross-origin
  }
}

/** How many of the given frames are cross-origin (unobservable). */
export function countCrossOriginFrames(frames: readonly HTMLIFrameElement[]): number {
  let count = 0;
  for (const frame of frames) if (isCrossOriginFrame(frame)) count += 1;
  return count;
}

function currentCount(): number {
  return countCrossOriginFrames(Array.from(document.querySelectorAll('iframe')));
}

/**
 * Watch the page for cross-origin iframes and emit BLIND_SPOT whenever the count CHANGES (install +
 * on any added/removed frame). Only the delta is emitted — never a per-mutation flood — so a static
 * embed reports once. Reversible: disconnects the observer on teardown.
 */
export function installBlindSpots(emit: Emit): Teardown {
  let last = -1;
  const report = (): void => {
    const count = currentCount();
    if (count === last) return;
    last = count;
    if (count > 0) {
      emit(EventType.BLIND_SPOT, { kind: BlindSpotKind.CROSS_ORIGIN_IFRAME, count });
    }
  };
  report();
  const observer = new MutationObserver((records) => {
    // Re-count only when an <iframe> was actually added or removed (cheap gate against unrelated churn).
    const touchedIframe = records.some((r) =>
      [...r.addedNodes, ...r.removedNodes].some(
        (n) => n instanceof HTMLElement && (n.tagName === 'IFRAME' || n.querySelector?.('iframe') !== null),
      ),
    );
    if (touchedIframe) report();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
}
