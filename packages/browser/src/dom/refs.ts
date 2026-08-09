import { TRANSPORT_LIMITS, asRef, type Ref } from '@reticlehq/core';
/**
 * Stable, human-meaningful element handles. Each element gets a ref like `e7`; the same
 * element keeps its ref across snapshots, and a ref re-resolves to its element as long as
 * the element is still in the document.
 */
/**
 * How many ref -> element entries are retained.
 *
 * The forward map is weak, so elements are always collectable; this bounds the BOOKKEEPING, which was
 * not. Refs are minted far more often than an agent asks about them — every meaningful DOM addition,
 * every transitionend, every scroll reveal — and the only eviction used to be "the agent happened to
 * resolve this exact dead ref". A busy app over a long session therefore accumulated entries for
 * elements that had been garbage for hours.
 *
 * Sized generously because eviction is not free of consequence (see refFor): the useful lifetime of a
 * ref is one agent turn, and this is far more than any one turn produces.
 */
export const MAX_TRACKED_REFS = 10000;

/** Marks a ref that was too long to echo in full. */
const REF_ELISION = '…';

/**
 * A ref, made safe to interpolate into an error message.
 *
 * A ref Reticle mints is `e7` — three characters. A ref a CALLER passes is whatever they typed, and
 * an agent guessing at the schema can pass 100KB of it. Every stale-ref message interpolates that
 * value directly, so the caller's own bad argument came back as a 100KB error.
 *
 * The server caps error messages centrally, but it cannot help here: the browser's transport
 * serializer truncates from the TAIL first, which severs "… no longer resolves to an element" — the
 * exact substring the server's recovery table matches on. A stale ref then arrives classified as a
 * possible Reticle defect. So the echo is bounded at the source, where the untrusted value enters
 * the message.
 */
export function echoRef(ref: string): string {
  const max = TRANSPORT_LIMITS.MAX_REF_LENGTH;
  return max >= ref.length ? ref : `${ref.slice(0, max)}${REF_ELISION}`;
}

/**
 * Full-sweep cadence. The deref-sweep is O(retained), and a page legitimately holding ≥ MAX_TRACKED_REFS
 * live elements (a 10k-node dashboard) can never get under the cap that way, so running it on EVERY mint
 * over the cap turned each mint into a 10k-entry scan — measured 264µs vs 0.20µs (1,300x) on the app's
 * main thread, ~2.6% of it forever on a churning page. The cap is instead held by an O(1) oldest-drop per
 * over-cap mint, and the expensive dead-entry sweep runs once per this many mints (amortized O(1)).
 */
const SWEEP_EVERY_MINTS = 1000;

export class RefRegistry {
  readonly #toRef = new WeakMap<Element, Ref>();
  readonly #fromRef = new Map<string, WeakRef<Element>>();
  #seq = 0;
  #mintsSinceSweep = 0;

  /** How many reverse entries are currently retained. Exposed so the bound can be asserted. */
  get size(): number {
    return this.#fromRef.size;
  }

  /** O(1): drop the least-recently-minted reverse entry. Map iterates in insertion order, so the front
   *  is the oldest. A still-live element whose entry is dropped re-registers on its next refFor. */
  #evictOldest(): void {
    const oldest = this.#fromRef.keys().next();
    if (oldest.done !== true) this.#fromRef.delete(oldest.value);
  }

  /** Full pass: drop every entry whose element has been collected or detached (frees genuinely dead
   *  bookkeeping), then any remaining excess by age. Amortized — called once per SWEEP_EVERY_MINTS. */
  #sweep(): void {
    for (const [ref, weak] of this.#fromRef) {
      const el = weak.deref();
      if (el === undefined || !el.isConnected) this.#fromRef.delete(ref);
    }
    while (this.#fromRef.size > MAX_TRACKED_REFS) this.#evictOldest();
  }

  /** Get the existing ref for an element, or mint a new one. */
  refFor(el: Element): Ref {
    const existing = this.#toRef.get(el);
    if (existing !== undefined) {
      // Re-register if this element's entry was evicted while it was off the agent's radar. Without
      // this, an element that is still on the page could hold a ref that no longer resolves — the
      // eviction would surface as "element not found", which is a wrong answer rather than a slow one.
      // Either way, TOUCH it to the recent end (LRU): an element being surfaced right now must not be
      // the oldest-drop victim of a mint storm before the agent gets to act on it.
      const weak = this.#fromRef.get(existing);
      this.#fromRef.delete(existing);
      this.#fromRef.set(existing, weak ?? new WeakRef(el));
      return existing;
    }
    this.#seq += 1;
    const ref = asRef(`e${String(this.#seq)}`);
    this.#toRef.set(el, ref);
    this.#fromRef.set(ref, new WeakRef(el));
    // Keep bounded cheaply on every mint; run the full dead-entry sweep only periodically.
    this.#mintsSinceSweep += 1;
    if (this.#mintsSinceSweep >= SWEEP_EVERY_MINTS) {
      this.#mintsSinceSweep = 0;
      this.#sweep();
    } else if (this.#fromRef.size > MAX_TRACKED_REFS) {
      this.#evictOldest();
    }
    return ref;
  }

  /**
   * Resolve a ref back to its element, or null if it's gone/detached.
   *
   * Takes a plain `string` ON PURPOSE: this is the untrusted-input path — the ref comes from the agent
   * over the wire, and a miss is answered with null rather than an error. Requiring a branded Ref here
   * would force a meaningless cast at every wire boundary and buy nothing; the brand's value is on the
   * MINT (refFor) so our own code cannot pass, say, a sessionId where a handle is expected.
   */
  resolve(ref: string): Element | null {
    const weak = this.#fromRef.get(ref);
    if (weak === undefined) return null;
    const el = weak.deref();
    if (el === undefined || !el.isConnected) {
      this.#fromRef.delete(ref);
      return null;
    }
    // LRU touch: a ref the agent just resolved is in ACTIVE use — move it to the most-recent end so an
    // oldest-drop eviction between this resolve and the follow-up act can't reclaim it and turn a live
    // element into a false "ref no longer resolves". O(1) — Map preserves insertion order.
    this.#fromRef.delete(ref);
    this.#fromRef.set(ref, weak);
    return el;
  }
}

/** Process-wide registry shared by snapshot, query, and the action executor. */
export const refs = new RefRegistry();
