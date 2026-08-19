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

/**
 * Walk ancestors: true iff any element in the chain carries a data-reticle* attribute (Reticle's own
 * UI). The document scaffolding — `<html>` and `<body>` — is NOT part of that chain.
 *
 * Reticle marks the documentElement while annotate mode is live (`data-reticle-mark-active`, which
 * drives the crosshair cursor), and `<html>` is an ancestor of everything. Walking into it therefore
 * answered "yes, Reticle's own UI" for EVERY element on the page for as long as the mode was on.
 *
 * That is not cosmetic: `occlusion.ts` treats a yes here as "nothing to report" and returns null, so
 * occlusion detection silently stopped working across the whole page while annotating — and an
 * occluded control is a bug class Reticle advertises catching, which would have come back clean.
 *
 * Excluding the scaffolding costs nothing, because Reticle's own UI is always mounted INSIDE body:
 * an overlay, a dock, a mark root. Nothing it owns IS `<html>` or `<body>`, so nothing it owns is
 * missed by stopping there.
 */
export function isReticleUi(node: Element | null): boolean {
  const scaffolding: readonly (Element | null)[] = [
    node?.ownerDocument.documentElement ?? null,
    node?.ownerDocument.body ?? null,
  ];
  for (let n: Element | null = node; n !== null; n = n.parentElement) {
    if (scaffolding.includes(n)) continue;
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
