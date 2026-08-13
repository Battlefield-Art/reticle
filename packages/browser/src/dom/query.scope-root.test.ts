/**
 * The one element a scoped query excludes is the scope itself — and sometimes that is the target.
 *
 * Reported by an agent verifying a drag-select: the element carrying the `mousedown` handler was a
 * CSS-grid row, and the bug lived in clicking its EMPTY region. It is a plain `div` — no role, no
 * accessible name, no testid, no text of its own beyond its children's — so every semantic locator
 * missed it, and `scope: ".grid-lists"` returned its 56 DESCENDANTS while excluding the one element
 * wanted. Clicking a child card was not a substitute: the card's own handler fires after mouseup and
 * overwrites the state under test.
 *
 * The verification could not run at all. It was handed back to the human — the second gesture that
 * session that had to be.
 *
 * `self: true` makes the scope root itself a candidate. It reuses the CSS escape hatch `scope`
 * already has rather than introducing a second, competing locator: a semantic query stays the way to
 * find things, and this is the way to name something the page never labelled.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { runQuery } from './query.js';
import { QueryBy } from '@reticlehq/core';

beforeEach(() => {
  document.body.innerHTML = `
    <div class="grid-lists">
      <button>Card A</button>
      <button>Card B</button>
    </div>`;
});

describe('scope root as a target', () => {
  it('still excludes the root by default, so existing queries are unchanged', () => {
    const result = runQuery({ scope: '.grid-lists', by: QueryBy.ROLE, value: 'button' });
    expect(result.elements).toHaveLength(2);
  });

  it('returns the container itself when asked for it', () => {
    const result = runQuery({ scope: '.grid-lists', self: true });
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.ref).toBeDefined();
  });

  it('gives that container a usable ref, which is the whole point', () => {
    const ref = runQuery({ scope: '.grid-lists', self: true }).elements[0]?.ref ?? '';
    const again = runQuery({ scope: ref, self: true });
    expect(again.elements[0]?.ref).toBe(ref);
  });

  it('reports a missing scope rather than silently widening to the page', () => {
    const result = runQuery({ scope: '.nope', self: true });
    expect(result.elements).toEqual([]);
    expect(result.scopeMissing).toBe(true);
  });

  it('needs a scope to have a root at all', () => {
    // Without `scope` there is nothing to return the root OF; the page body is not a useful answer.
    const result = runQuery({ self: true });
    expect(result.elements).toEqual([]);
  });
});
