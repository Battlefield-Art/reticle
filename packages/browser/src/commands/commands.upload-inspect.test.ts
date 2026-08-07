import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createCommandRegistry } from './commands.js';
import { executeAction } from '../actions/actions.js';
import { refs } from '../dom/refs.js';
import { registerAdapter } from '../registry/adapters.js';

const reg = createCommandRegistry();

describe('upload action', () => {
  it('rejects a non-file target with a clear error', async () => {
    document.body.innerHTML = '<input type="text" />';
    const el = document.querySelector('input') as HTMLInputElement;
    await expect(executeAction(refs.refFor(el), 'upload', { name: 'x.txt' })).rejects.toThrow(
      /file/,
    );
  });
});

describe('inspect computed styles (for hover/visual checks)', () => {
  it('returns color + backgroundColor for a ref', () => {
    document.body.innerHTML = '<button style="background: rgb(1, 2, 3)">Hi</button>';
    const el = document.querySelector('button') as HTMLButtonElement;
    const handler = reg.get('inspect');
    if (handler === undefined) throw new Error('no inspect handler');
    const info = handler({ ref: refs.refFor(el) }) as {
      styles: { backgroundColor: string } | null;
    };
    expect(info.styles).not.toBeNull();
    expect(info.styles?.backgroundColor).toContain('rgb');
  });
});

/**
 * `inspect` and `act` disagreed about the same element.
 *
 * `describe()` reads the cheap DOM-attribute source, because it runs per element on paths that
 * describe hundreds at once. Single-element paths are supposed to use `sourceFor()`, which asks the
 * framework adapter FIRST — it knows the component that RENDERED the element, not just the nearest
 * stamped host. `act` did; `inspect` did not. So on any app whose source comes from the fiber rather
 * than a babel stamp, `inspect` reported `source: null` while `act` on the very same ref returned a
 * path — and `inspect` is the tool an agent reaches for to ask where something lives. Observed on
 * three of six real apps.
 */
describe('inspect source agrees with the adapter, not just the DOM stamp', () => {
  /** A stand-in for @reticlehq/react: answers for elements carrying a marker attribute. */
  const fakeAdapter = {
    name: 'test-adapter',
    identify: (el: Element) =>
      el.hasAttribute('data-fake-component')
        ? { componentStack: ['PayButton'], source: { file: 'src/Pay.tsx', line: 12, column: 3 } }
        : null,
  };
  beforeAll(() => registerAdapter(fakeAdapter));
  afterAll(() => {
    const store = globalThis as unknown as { __reticleAdapters?: { name: string }[] };
    const list = store.__reticleAdapters ?? [];
    const i = list.findIndex((a) => a.name === fakeAdapter.name);
    if (i >= 0) list.splice(i, 1);
  });

  it('reports the ADAPTER source when there is no data-reticle-source attribute', () => {
    document.body.innerHTML = '<button data-fake-component>Pay</button>';
    const el = document.querySelector('button') as HTMLButtonElement;
    const handler = reg.get('inspect');
    if (handler === undefined) throw new Error('no inspect handler');
    const info = handler({ ref: refs.refFor(el) }) as { source?: string; component?: unknown };
    // The adapter must actually have answered, or this test proves nothing.
    expect(info.component, 'the fake adapter did not identify the element').not.toBeNull();
    expect(info.source).toBe('src/Pay.tsx:12');
  });

  it('still falls back to the DOM stamp when no adapter can answer', () => {
    document.body.innerHTML = '<div data-reticle-source="src/A.tsx:5:2"><span>x</span></div>';
    const el = document.querySelector('span') as HTMLElement;
    const handler = reg.get('inspect');
    if (handler === undefined) throw new Error('no inspect handler');
    const info = handler({ ref: refs.refFor(el) }) as { source?: string };
    expect(info.source).toBe('src/A.tsx:5');
  });
});
