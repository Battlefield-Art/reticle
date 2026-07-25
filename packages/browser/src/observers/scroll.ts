import { EventType, ScrollDirection } from '@reticlehq/core';
import { refs } from '../dom/refs.js';
import { nativeSetTimeout, nativeClearTimeout } from '../timers/native-timers.js';
import type { Emit, Teardown } from './types.js';

const THROTTLE_MS = 100;
const REVEAL_SELECTOR = '[data-reticle-reveal], [data-reveal], section';

/** Observe scroll position + reveal-on-scroll for modern scroll-reactive UIs. */
export function installScroll(emit: Emit): Teardown {
  let lastEmit = 0;
  let lastY = 0;
  let trailingTimer: number | undefined;

  const emitPosition = (): void => {
    lastEmit = performance.now();
    const y = window.scrollY;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    emit(EventType.SCROLL_POSITION, {
      x: window.scrollX,
      y,
      percent: Math.round((y / max) * 100),
      direction: y >= lastY ? ScrollDirection.DOWN : ScrollDirection.UP,
    });
    lastY = y;
  };

  const onScroll = (): void => {
    const elapsed = performance.now() - lastEmit;
    if (elapsed >= THROTTLE_MS) {
      if (trailingTimer !== undefined) {
        nativeClearTimeout(trailingTimer);
        trailingTimer = undefined;
      }
      emitPosition();
      return;
    }
    // Leading-edge only dropped the FINAL, resting position — an agent asserting "scrolled to the
    // footer" saw the last mid-scroll sample, not where the page settled. Schedule a trailing emit.
    if (trailingTimer === undefined) {
      trailingTimer = nativeSetTimeout(() => {
        trailingTimer = undefined;
        emitPosition();
      }, THROTTLE_MS - elapsed);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  let io: IntersectionObserver | undefined;
  let mo: MutationObserver | undefined;
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            emit(
              EventType.REVEAL_SHOWN,
              { ratio: entry.intersectionRatio },
              refs.refFor(entry.target),
            );
          }
        }
      },
      { threshold: 0.25 },
    );
    const observer = io;
    for (const el of document.querySelectorAll(REVEAL_SELECTOR)) observer.observe(el);
    // Observe reveal targets mounted AFTER install too (lazy sections, infinite scroll) — a static
    // query at install missed every section that appeared later.
    if (typeof MutationObserver === 'function') {
      mo = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (node.matches(REVEAL_SELECTOR)) observer.observe(node);
            for (const nested of node.querySelectorAll(REVEAL_SELECTOR)) observer.observe(nested);
          }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  return () => {
    window.removeEventListener('scroll', onScroll);
    if (trailingTimer !== undefined) nativeClearTimeout(trailingTimer);
    io?.disconnect();
    mo?.disconnect();
  };
}
