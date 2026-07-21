import { asRef, type Ref } from '@reticlehq/core';
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

export class RefRegistry {
  readonly #toRef = new WeakMap<Element, Ref>();
  readonly #fromRef = new Map<string, WeakRef<Element>>();
  #seq = 0;

  /** How many reverse entries are currently retained. Exposed so the bound can be asserted. */
  get size(): number {
    return this.#fromRef.size;
  }

  /**
   * Drop entries whose element has been collected or detached, then — if still over the cap — the
   * oldest remaining. Map iterates in insertion order, so "oldest" is simply the front.
   */
  #evict(): void {
    for (const [ref, weak] of this.#fromRef) {
      const el = weak.deref();
      if (el === undefined || !el.isConnected) this.#fromRef.delete(ref);
    }
    // Sweeping usually suffices; a page legitimately holding more than the cap in live elements falls
    // through to dropping the least recently minted.
    while (this.#fromRef.size > MAX_TRACKED_REFS) {
      const oldest = this.#fromRef.keys().next();
      if (oldest.done === true) return;
      this.#fromRef.delete(oldest.value);
    }
  }

  /** Get the existing ref for an element, or mint a new one. */
  refFor(el: Element): Ref {
    const existing = this.#toRef.get(el);
    if (existing !== undefined) {
      // Re-register if this element's entry was evicted while it was off the agent's radar. Without
      // this, an element that is still on the page could hold a ref that no longer resolves — the
      // eviction would surface as "element not found", which is a wrong answer rather than a slow one.
      if (!this.#fromRef.has(existing)) this.#fromRef.set(existing, new WeakRef(el));
      return existing;
    }
    this.#seq += 1;
    const ref = asRef(`e${String(this.#seq)}`);
    this.#toRef.set(el, ref);
    this.#fromRef.set(ref, new WeakRef(el));
    if (this.#fromRef.size > MAX_TRACKED_REFS) this.#evict();
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
    return el;
  }
}

/** Process-wide registry shared by snapshot, query, and the action executor. */
export const refs = new RefRegistry();
