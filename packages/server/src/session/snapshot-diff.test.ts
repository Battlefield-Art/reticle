import { describe, expect, it } from 'vitest';
import { diffSnapshots } from './snapshot-diff.js';

describe('diffSnapshots', () => {
  it('reports keys whose value changed, with before + after', () => {
    const changes = diffSnapshots({ cart: 2, user: 'a' }, { cart: 3, user: 'a' });
    expect(changes).toEqual([{ key: 'cart', before: 2, after: 3 }]);
  });

  it('detects added and removed keys', () => {
    const changes = diffSnapshots({ a: 1 }, { b: 2 });
    expect(changes).toEqual([
      { key: 'a', before: 1, after: undefined },
      { key: 'b', before: undefined, after: 2 },
    ]);
  });

  it('compares nested values structurally (no false diff on equal objects)', () => {
    expect(diffSnapshots({ o: { x: 1 } }, { o: { x: 1 } })).toEqual([]);
    expect(diffSnapshots({ o: { x: 1 } }, { o: { x: 2 } })).toEqual([
      { key: 'o', before: { x: 1 }, after: { x: 2 } },
    ]);
  });

  it('returns nothing for identical snapshots', () => {
    expect(diffSnapshots({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual([]);
  });
});
