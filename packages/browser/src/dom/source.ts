/**
 * Where an element is defined in the codebase.
 *
 * This is the single most valuable thing Reticle can hand an agent that has to fix what Reticle just
 * found. Locating the right FILE is what turns a report into an edit; without it the agent pays for a
 * search loop that the instrumentation already knows the answer to.
 *
 * Two lookups, because the callers have very different cost budgets:
 *
 *   sourceFromDom  — reads the babel-stamped `data-reticle-source` off the nearest ancestor. One
 *                    native upward walk, bounded by tree depth. Safe to call per element on paths
 *                    that describe many elements at once (query results, snapshots).
 *   sourceFor      — prefers a framework adapter's answer (which knows the component that RENDERED
 *                    the element, not just the nearest stamped host) and falls back to the DOM. The
 *                    adapter path walks the fiber tree, so this belongs on single-element paths
 *                    (inspect, act, review) and not in a loop.
 *
 * Both report source independently of how the element is ANCHORED. Anchor answers "how do I find this
 * again", source answers "where is it written" — collapsing the two once meant that adding a
 * data-testid, which Reticle's own docs recommend, silently removed the source pointer.
 */

/** Stamped by @reticlehq/babel-plugin / @reticlehq/vite-plugin in dev as `file:line:column`. */
const SOURCE_ATTR = 'data-reticle-source';

export interface SourceLocation {
  file: string;
  line: number;
}

/** Parse a `data-reticle-source="file:line:column"` value into `{ file, line }` (column dropped). */
export function parseSourceAttr(value: string | null): SourceLocation | undefined {
  if (value === null) return undefined;
  const m = /^(.*):(\d+):(\d+)$/.exec(value);
  if (m === null) return undefined;
  const file = m[1];
  const line = Number(m[2]);
  if (file === undefined || file.length === 0 || !Number.isFinite(line)) return undefined;
  return { file, line };
}

/** The nearest babel-stamped source at or above this element. Cheap enough to call in bulk. */
export function sourceFromDom(el: Element): SourceLocation | undefined {
  const host = el.closest(`[${SOURCE_ATTR}]`);
  return host !== null ? parseSourceAttr(host.getAttribute(SOURCE_ATTR)) : undefined;
}

/** Best source for the element: the framework adapter's, else the nearest babel-stamped attribute. */
export function sourceFor(
  el: Element,
  adapterSource: SourceLocation | undefined,
): SourceLocation | undefined {
  if (adapterSource !== undefined) return { file: adapterSource.file, line: adapterSource.line };
  return sourceFromDom(el);
}

/**
 * `file:line` — the form an agent can act on directly.
 *
 * Deliberately a single compact string rather than an object: it costs a couple of dozen bytes on a
 * descriptor that may repeat hundreds of times in one response, and every consumer of it is either
 * opening an editor or printing it.
 */
export function formatSource(source: SourceLocation | undefined): string | undefined {
  return source === undefined ? undefined : `${source.file}:${String(source.line)}`;
}
