import {
  queryAllByRole,
  queryAllByText,
  queryAllByLabelText,
  queryAllByPlaceholderText,
  queryAllByTestId,
  queryAllByAltText,
} from '@testing-library/dom';
import {
  DATA_RETICLE_SOURCE_ATTR,
  ElementState,
  QueryBy,
  REDACTED_VALUE,
  type ElementDescriptor,
  type ElementQuery,
  type MatchResult,
  type PresentRegion,
  type QueryEmptyHint,
  type QueryResult,
  TRANSPORT_LIMITS,
} from '@reticlehq/core';
import { describe, getStates, isVisible } from './a11y.js';
import { isSensitiveKey } from '../security/serialization.js';
import { getCapabilities } from '../registry/capabilities.js';
import { identifyComponent } from '../registry/adapters.js';
import { refs } from './refs.js';

const TESTID_ATTR = 'data-testid';
const SOURCE_ATTR = DATA_RETICLE_SOURCE_ATTR;
const MAX_PRESENT_TESTIDS = 12;
/** Bound the fiber-walk fallback so a component-name query can't scan an unbounded DOM. */
const MAX_COMPONENT_CANDIDATES = 2000;
/** Likely-actionable elements considered when resolving a component anchor without a source stamp. */
const COMPONENT_CANDIDATE_SELECTOR = `[${SOURCE_ATTR}], [${TESTID_ATTR}], button, a, input, select, textarea, [role]`;

/**
 * Resolve a scope to its container. A container of `null` means a scope was GIVEN but resolved to
 * nothing (unmounted, or a selector that matches no element) — the caller must NOT fall back to the
 * whole page, or a scoped query silently widens into a phantom match. `scope === undefined` (no scope)
 * legitimately searches the body.
 */
function resolveContainer(scope: string | undefined): { container: HTMLElement | null; scopeMissing: boolean } {
  if (scope === undefined) return { container: document.body, scopeMissing: false };
  const byRef = refs.resolve(scope);
  if (byRef instanceof HTMLElement) return { container: byRef, scopeMissing: false };
  try {
    const found = document.querySelector(scope);
    if (found instanceof HTMLElement) return { container: found, scopeMissing: false };
  } catch {
    // invalid selector — treat as a missing scope, never a whole-page search
  }
  return { container: null, scopeMissing: true };
}

/**
 * Resolve an element by its SOURCE location — the precise, granular auto-anchor. The babel plugin
 * stamps `data-reticle-source="file:line:column"` on host elements, so a line-level starts-with match
 * pins the exact JSX element with a single fast attribute selector (no fiber walk). Column is
 * ignored so a small column drift doesn't unbind the anchor.
 */
function findBySource(
  container: HTMLElement,
  source: { file: string; line: number },
): HTMLElement[] {
  const prefix = `${source.file}:${source.line}:`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  try {
    return Array.from(container.querySelectorAll<HTMLElement>(`[${SOURCE_ATTR}^="${prefix}"]`));
  } catch {
    return [];
  }
}

/**
 * Resolve by component display name when no source stamp is available: scan a bounded set of
 * likely-actionable elements and keep those whose NEAREST enclosing component (via the registered
 * framework adapter) matches. Coarser than source (one component renders many hosts) — used as a
 * fallback / for frameworks without a source plugin.
 */
function findByComponentName(container: HTMLElement, component: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  let scanned = 0;
  for (const el of Array.from(
    container.querySelectorAll<HTMLElement>(COMPONENT_CANDIDATE_SELECTOR),
  )) {
    if (scanned >= MAX_COMPONENT_CANDIDATES) break;
    scanned += 1;
    const info = identifyComponent(el);
    if (info !== null && info.componentStack[0] === component) out.push(el);
  }
  return out;
}

/** Auto-anchor resolution: source (precise) first, then component name (coarse fallback). */
function findByComponent(container: HTMLElement, query: ElementQuery): HTMLElement[] {
  if (query.source !== undefined) {
    const bySource = findBySource(container, query.source);
    if (bySource.length > 0) return bySource;
  }
  if (query.component !== undefined && query.component.length > 0) {
    return findByComponentName(container, query.component);
  }
  return [];
}

/** Run the appropriate Testing-Library query against ONE root (light DOM or a shadow root). */
function findIn(container: HTMLElement, query: ElementQuery): HTMLElement[] {
  const by = query.by;
  const value = query.value;

  // Explicit `by`+`value` form.
  if (by !== undefined && value !== undefined) {
    switch (by) {
      case QueryBy.ROLE:
        return queryAllByRole(
          container,
          value,
          query.name !== undefined ? { hidden: true, name: query.name } : { hidden: true },
        );
      case QueryBy.TEXT:
        return queryAllByText(container, value, { exact: false });
      case QueryBy.LABEL:
        return queryAllByLabelText(container, value, { exact: false });
      case QueryBy.PLACEHOLDER:
        return queryAllByPlaceholderText(container, value, { exact: false });
      case QueryBy.TESTID:
        return queryAllByTestId(container, value, { exact: true });
      case QueryBy.ALT:
        return queryAllByAltText(container, value, { exact: false });
      case QueryBy.COMPONENT:
        // value is the component name;.source (if present) still takes precedence inside.
        return findByComponent(container, { ...query, component: query.component ?? value });
      default:
        return [];
    }
  }

  // Auto-anchor (component / source) — checked before the role/text fields so a query carrying
  // both a component anchor and an incidental role resolves by the more durable anchor.
  if (query.component !== undefined || query.source !== undefined) {
    return findByComponent(container, query);
  }

  // Structured form (role+name, or any single field).
  if (query.role !== undefined) {
    const options =
      query.name !== undefined
        ? { hidden: true as const, name: query.name }
        : { hidden: true as const };
    return queryAllByRole(container, query.role, options);
  }
  if (query.text !== undefined) return queryAllByText(container, query.text, { exact: false });
  if (query.label !== undefined) {
    return queryAllByLabelText(container, query.label, { exact: false });
  }
  if (query.placeholder !== undefined) {
    return queryAllByPlaceholderText(container, query.placeholder, { exact: false });
  }
  if (query.testid !== undefined) return queryAllByTestId(container, query.testid, { exact: true });
  if (query.alt !== undefined) return queryAllByAltText(container, query.alt, { exact: false });
  return [];
}

/**
 * Every open shadow root at or beneath `root`, in document order.
 *
 * A closed root is deliberately unreachable — `element.shadowRoot` is null by design, and the SDK
 * reports that as a blind spot rather than pretending to see through it.
 */
function openShadowRootsUnder(root: HTMLElement): ShadowRoot[] {
  const found: ShadowRoot[] = [];
  const walk = (node: ParentNode): void => {
    for (const el of node.querySelectorAll<HTMLElement>('*')) {
      const shadow = el.shadowRoot;
      if (shadow !== null) {
        found.push(shadow);
        walk(shadow); // nested web components
      }
    }
  };
  walk(root);
  return found;
}

/**
 * NOTE ON COST. The walk above is a `querySelectorAll('*')` over the container, and `reticle_query` is
 * a hot-path tool, so every query on every app pays it — including the overwhelming majority that hold
 * no web components.
 *
 * A cache invalidated by a MutationObserver was written and then REMOVED, because it is not sound:
 * `attachShadow` on an element that is already in the document mutates only the shadow tree, which an
 * observer watching documentElement's subtree never sees. The cached "no shadow roots here" would
 * persist and the content would be silently missed — a false negative indistinguishable from a genuinely
 * absent element, which is the exact bug the piercing was added to fix.
 *
 * Correctness wins until there is a measurement saying the walk actually matters. The allocation is
 * avoided (iterate the live NodeList rather than copying it); the traversal itself stays.
 */
/**
 * Run the query against the light DOM AND every open shadow root beneath the scope.
 *
 * Testing Library only walks the light DOM, so a control inside a web component returned zero matches
 * on a completely healthy page — a miss indistinguishable from a genuinely absent element. The
 * snapshot has always pierced open roots; this makes `query` agree with it.
 */
function findCandidates(query: ElementQuery): { candidates: HTMLElement[]; scopeMissing: boolean } {
  const { container, scopeMissing } = resolveContainer(query.scope);
  // A given-but-missing scope searches NOTHING — never the whole page. The empty result plus the
  // scopeMissing flag is what keeps "gone scope" distinct from "absent element".
  if (container === null) return { candidates: [], scopeMissing: true };
  const seen = new Set<HTMLElement>();
  const out: HTMLElement[] = [];
  const collect = (els: HTMLElement[]): void => {
    for (const el of els) {
      if (seen.has(el)) continue; // reachable from both host and root — count once
      seen.add(el);
      out.push(el);
    }
  };
  collect(findIn(container, query));
  for (const shadow of openShadowRootsUnder(container)) {
    // A ShadowRoot is a DocumentFragment; the Testing-Library queries accept any HTMLElement-like
    // container, and every call site below only reads from it.
    collect(findIn(shadow as unknown as HTMLElement, query));
  }
  return { candidates: out, scopeMissing };
}

/** Longest attribute value returned; one enormous href must not blow the response budget. */
export const ATTR_VALUE_MAX = 512;
/** Most attributes projected per element — a guard against a caller asking for everything. */
const ATTR_KEYS_MAX = 12;

/**
 * Read the requested attributes off an element.
 *
 * Absent attributes are OMITTED rather than returned empty, so "not present" and "present but blank"
 * stay distinguishable. Credential-bearing names are redacted with the same rule the network and
 * storage paths use — a projection API must not become an exfiltration path.
 */
function projectAttrs(el: Element, keys: readonly string[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const key of keys.slice(0, ATTR_KEYS_MAX)) {
    const raw = el.getAttribute(key);
    if (raw === null) continue;
    out[key] = isSensitiveKey(key) ? REDACTED_VALUE : raw.slice(0, ATTR_VALUE_MAX);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function inState(el: Element, state: ElementState, memo?: Map<Element, boolean>): boolean {
  return getStates(el, isVisible(el, memo)).includes(state);
}

/**
 * How many matches are DESCRIBED, however many are found.
 *
 * describe() is the expensive part of a query: it resolves the accessible name and forces a style
 * computation for every ancestor to decide visibility. Describing every match on a page with
 * thousands of them freezes the main thread for seconds — and then the wire discards all but the
 * first `MAX_COLLECTION_ITEMS` anyway, so the work past that point was never observable by anyone.
 * Matching one to the other means the cost of a broad query is bounded by the transport rather than
 * by the size of the page.
 */
const MAX_DESCRIBED = TRANSPORT_LIMITS.MAX_COLLECTION_ITEMS;

/**
 * Match an element predicate against the live DOM.
 *
 * `count` is every match; `elements` is the described prefix. Keeping those separate is what lets
 * "how many?" stay exact while the answer stays affordable.
 */
export function matchQuery(
  query: ElementQuery,
  state?: ElementState,
  limit: number = MAX_DESCRIBED,
): MatchResult {
  let elements: HTMLElement[];
  let scopeMissing = false;
  try {
    const found = findCandidates(query);
    elements = found.candidates;
    scopeMissing = found.scopeMissing;
  } catch {
    elements = [];
  }
  // One visibility cache for the whole (synchronous) query pass. isVisible is an O(depth) forced-style
  // walk; the state filter runs it over EVERY candidate (the count must be exact) — on a match-heavy
  // page (e.g. a 3k-row grid) that is tens of thousands of getComputedStyle calls on the host's main
  // thread. The memo makes each element's ancestors resolve once, then short-circuit for every sibling.
  const visMemo = new Map<Element, boolean>();
  const filtered =
    state === undefined ? elements : elements.filter((el) => inState(el, state, visMemo));
  const attrs = query.attrs;
  const described = filtered.slice(0, Math.max(0, Math.min(limit, MAX_DESCRIBED)));
  const descriptors: ElementDescriptor[] = described.map((el) => {
    const base = describe(el, visMemo);
    if (attrs === undefined || attrs.length === 0) return base;
    const projected = projectAttrs(el, attrs);
    return projected === undefined ? base : { ...base, attrs: projected };
  });
  return {
    matched: filtered.length > 0,
    count: filtered.length,
    elements: descriptors,
    ...(scopeMissing ? { scopeMissing: true } : {}),
  };
}

/** Resolve `aria-labelledby` (one or more element IDs) to the referenced elements' text — a bare ID is
 * not a human-readable name. Undefined when unset or nothing resolves. */
function resolveLabelledBy(el: Element): string | undefined {
  const ids = el.getAttribute('aria-labelledby');
  if (ids === null) return undefined;
  const text = ids
    .split(/\s+/)
    .map((id) => (id.length > 0 ? (el.ownerDocument.getElementById(id)?.textContent?.trim() ?? '') : ''))
    .filter((t) => t.length > 0)
    .join(' ');
  return text.length > 0 ? text : undefined;
}

/** Structural clusters of the page — the successor to the raw testid list in zero-match hints. */
function buildPresentRegions(query: ElementQuery): PresentRegion[] {
  // For the diagnostic hint we WANT the page's orientation even when the scope is gone, so fall back
  // to the body here (the match path above already reported scopeMissing, so this can't mask it).
  const container = resolveContainer(query.scope).container ?? document.body;
  const regions: PresentRegion[] = [];
  const CONTAINER_ROLES = [
    'list',
    'listbox',
    'grid',
    'table',
    'tree',
    'treegrid',
    'dialog',
    'alertdialog',
    'navigation',
    'main',
    'banner',
    'form',
    'search',
    'menu',
    'menubar',
    'tablist',
  ] as const;
  for (const role of CONTAINER_ROLES) {
    let containers: HTMLElement[];
    try {
      containers = queryAllByRole(container, role, { hidden: true });
    } catch {
      continue;
    }
    for (const el of containers) {
      const name =
        el.getAttribute('aria-label') ??
        resolveLabelledBy(el) ?? // aria-labelledby is an element ID — resolve it to the referenced TEXT
        el.getAttribute('data-testid') ??
        undefined;
      const children = el.querySelectorAll('[role]');
      const sample: string[] = [];
      for (const child of Array.from(children)) {
        if (sample.length >= 3) break;
        const childRole = child.getAttribute('role');
        const childName =
          child.getAttribute('aria-label') ??
          child.getAttribute('data-testid') ??
          child.textContent?.trim().slice(0, 40) ??
          '';
        if (childRole !== null && childName.length > 0) {
          sample.push(`${childRole}[${childName}]`);
        }
      }
      const region: PresentRegion = { role, childCount: children.length, sample };
      if (name !== undefined && name.length > 0) region.name = name;
      regions.push(region);
      if (regions.length >= 10) return regions;
    }
  }
  return regions;
}

/** Diagnostic hint for a zero-match query: what testids ARE present in the searched scope. */
function buildEmptyHint(query: ElementQuery): QueryEmptyHint {
  const container = resolveContainer(query.scope).container ?? document.body;
  const all = container.querySelectorAll(`[${TESTID_ATTR}]`);
  const present: string[] = [];
  for (const el of Array.from(all)) {
    const id = el.getAttribute(TESTID_ATTR);
    if (id !== null && id.length > 0 && !present.includes(id)) {
      present.push(id);
      if (present.length >= MAX_PRESENT_TESTIDS) break;
    }
  }
  const registered = getCapabilities().testids;
  const knownEmptyState = present.some((id) => registered.includes(id));
  const route = `${location.pathname}${location.search}`;
  return {
    route,
    presentTestids: present,
    presentRegions: buildPresentRegions(query),
    knownEmptyState,
  };
}

/**
 * Resolve a query to descriptors for the `query` MCP tool.
 *
 * `count` is carried through deliberately: the server reports match totals from it rather than from
 * the array, because the array is capped in transit. Dropping it here — which this function used to
 * do — silently put the server back to counting survivors and calling that the answer.
 */
export function runQuery(query: ElementQuery, limit?: number): QueryResult {
  const result = matchQuery(query, undefined, limit);
  const scopeFields = result.scopeMissing === true ? { scopeMissing: true as const } : {};
  if (result.elements.length === 0) {
    return { elements: result.elements, count: result.count, hint: buildEmptyHint(query), ...scopeFields };
  }
  return { elements: result.elements, count: result.count, ...scopeFields };
}
