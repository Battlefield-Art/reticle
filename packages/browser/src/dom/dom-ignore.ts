/**
 * Selectors for Reticle's own presenter overlay (cursor, HUD, glow) + the annotator's
 * UI (`data-reticle-mark`) - never observed/snapshotted. The annotator mounts by DEFAULT with the
 * presenter, so omitting its selector here leaked annotation chrome into every snapshot.
 */
export const RETICLE_OVERLAY =
  '[data-reticle-overlay],[data-reticle-cursor],[data-reticle-hud],[data-reticle-glow],[data-reticle-mark]';

/** Known third-party dev overlays to keep out of snapshots (Agentation, Next dev UI). */
const DEV_OVERLAYS =
  '[data-agentation],#__next-build-watcher,nextjs-portal,[data-nextjs-dialog],[data-nextjs-toast]';

let extraIgnore = '';

/** Let the host app add selectors to exclude from snapshots (e.g. its own dev widgets). */
export function setIgnoreSelectors(selectors: string[]): void {
  extraIgnore = selectors.join(',');
}

/** True if the element is part of Reticle's own presenter overlay. */
export function isReticleOverlay(el: Element): boolean {
  return el.closest(RETICLE_OVERLAY) !== null;
}

/** Walk ancestors: true iff any element in the chain carries a data-reticle* attribute (Reticle's own UI). */
export function isReticleUi(node: Element | null): boolean {
  for (let n: Element | null = node; n !== null; n = n.parentElement) {
    for (const attr of Array.from(n.attributes)) {
      if (attr.name.startsWith('data-reticle')) return true;
    }
  }
  return false;
}

/** True if the element should be excluded from snapshots/queries (Reticle overlay or dev overlay). */
export function isIgnored(el: Element): boolean {
  const sel =
    extraIgnore.length > 0
      ? `${RETICLE_OVERLAY},${DEV_OVERLAYS},${extraIgnore}`
      : `${RETICLE_OVERLAY},${DEV_OVERLAYS}`;
  return el.closest(sel) !== null;
}
