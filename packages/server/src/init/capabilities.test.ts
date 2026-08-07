import { describe, expect, it } from 'vitest';
import { scanTestids, storeHints, MAX_TESTIDS } from './capabilities.js';

/**
 * Every app came up with `hasCapabilities: false` and a `reticle_state` holding only
 * `__reticle_renders`, because `init` wired neither call. The state-truth read — the one thing that
 * shows what the app BELIEVES rather than what it rendered — was unavailable out of the box on all
 * six real apps. Testids are cheap to find; stores are named rather than guessed.
 */
describe('scanTestids', () => {
  it('finds the attribute forms people actually write', () => {
    const ids = scanTestids([
      '<button data-testid="pay">Pay</button>',
      "<a data-testid='nav-home' />",
      '<div data-testid={"cart-total"} />',
      '<input data-testid = "email" />',
    ]);
    expect(ids).toEqual(['pay', 'nav-home', 'cart-total', 'email']);
  });

  it('de-duplicates across files and preserves first-seen order', () => {
    expect(scanTestids(['a data-testid="x" b data-testid="y"', 'c data-testid="x"'])).toEqual([
      'x',
      'y',
    ]);
  });

  it('caps the list — this is a hint for an agent, not an inventory', () => {
    const many = Array.from({ length: MAX_TESTIDS + 25 }, (_, i) => `data-testid="id${String(i)}"`);
    expect(scanTestids([many.join(' ')]).length).toBe(MAX_TESTIDS);
  });

  it('finds nothing in a file with no testids, rather than inventing one', () => {
    expect(scanTestids(['<button>Pay</button>', 'const testid = "not-an-attribute";'])).toEqual([]);
  });
});

describe('storeHints', () => {
  it('names only the libraries the app actually depends on', () => {
    const hints = storeHints(new Set(['zustand', 'lodash']));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('zustand' in {} ? '' : 'registerStore');
    expect(hints[0]).toContain('useStore');
  });

  it('puts TanStack Query first — a stale cache fires no request, so it is the only witness', () => {
    const hints = storeHints(new Set(['zustand', '@tanstack/react-query']));
    expect(hints[0]).toContain('tanstackQueryStore');
  });

  it('says nothing when the app has no store library we can read', () => {
    expect(storeHints(new Set(['react', 'vite']))).toEqual([]);
  });
});
