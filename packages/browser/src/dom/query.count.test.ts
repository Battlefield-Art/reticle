import { describe as suite, it, expect, beforeEach } from 'vitest';
import { TRANSPORT_LIMITS } from '@reticlehq/core';
import { matchQuery, runQuery } from './query.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

function renderButtons(n: number): void {
  document.body.innerHTML = Array.from(
    { length: n },
    (_v, i) => `<button data-testid="row-action">row ${String(i)}</button>`,
  ).join('');
}

/**
 * "How many of these are on the page?" has to be exact even when the list of them is not, because the
 * two travel together and the agent cannot tell a capped list from a complete one without the count.
 *
 * The server reports totals from `count` rather than `elements.length` for exactly this reason — but
 * runQuery used to drop `count` on the floor, so for the one tool that matters the server fell back to
 * counting survivors and calling it the answer. These tests pin the whole path, not just the shape.
 */
suite('a query counts every match and describes a bounded prefix', () => {
  const CAP = TRANSPORT_LIMITS.MAX_COLLECTION_ITEMS;

  it('counts all matches even when far more exist than are described', () => {
    renderButtons(CAP * 3);
    const result = matchQuery({ by: 'testid', value: 'row-action' });
    expect(result.count).toBe(CAP * 3);
  });

  it('describes no more than the transport can carry', () => {
    renderButtons(CAP * 3);
    expect(matchQuery({ by: 'testid', value: 'row-action' }).elements.length).toBeLessThanOrEqual(CAP);
  });

  it('runQuery carries the count through — the server reports totals from it', () => {
    renderButtons(CAP * 3);
    const result = runQuery({ by: 'testid', value: 'row-action' });
    expect(result.count).toBe(CAP * 3);
    expect(result.elements.length).toBeLessThanOrEqual(CAP);
  });

  it('honours a caller limit below the cap', () => {
    renderButtons(50);
    const result = runQuery({ by: 'testid', value: 'row-action' }, 5);
    expect(result.elements).toHaveLength(5);
    expect(result.count).toBe(50);
  });

  it('still reports matched:false and a hint when nothing matches', () => {
    renderButtons(3);
    const result = runQuery({ by: 'testid', value: 'nope' });
    expect(result.count).toBe(0);
    expect(result.elements).toHaveLength(0);
    expect(result.hint).toBeDefined();
  });
});
