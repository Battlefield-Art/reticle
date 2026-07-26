import { describe, it, expect, beforeEach } from 'vitest';
import { executeAction } from './actions.js';
import { refs } from '../dom/refs.js';
import { registerAdapter, type ComponentInfo } from '../registry/adapters.js';

/**
 * Auto-anchor capture at act time: when an acted element has NO data-testid, the result carries the
 * element's component name + source (from the framework adapter) so the server compiles a STABLE
 * component anchor instead of a degraded ref. A testid still wins (lean — no component noise).
 */
beforeEach(() => {
  document.body.innerHTML = '';
});

describe('act result — auto-anchor fallback (component/source when no testid)', () => {
  it('attaches component + source for an element with no testid', async () => {
    // Fake adapter: read component identity from data-component / data-src attributes.
    registerAdapter({
      name: 'aa-fake',
      identify: (el: Element): ComponentInfo | null => {
        const owner = el.closest('[data-component]');
        const name = owner?.getAttribute('data-component');
        if (name === null || name === undefined) return null;
        const src = owner?.getAttribute('data-src');
        const info: ComponentInfo = { componentStack: [name] };
        if (src !== null && src !== undefined) {
          const [file, line] = src.split(':');
          if (file !== undefined && line !== undefined) {
            info.source = { file, line: Number(line) };
          }
        }
        return info;
      },
    });
    document.body.innerHTML =
      '<div data-component="NewDeployButton" data-src="src/Deployments.tsx:107"><button>Open panel</button></div>';
    const btn = document.querySelector('button') as HTMLButtonElement;
    const res = await executeAction(refs.refFor(btn), 'click', {});

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.testid).toBeUndefined();
    expect(res.component).toBe('NewDeployButton');
    expect(res.source).toEqual({ file: 'src/Deployments.tsx', line: 107 });
  });

  /**
   * ANCHOR and SOURCE answer different questions, and collapsing them cost us the more valuable one.
   *
   *   anchor — how do I find this element again on the next run?   (testid wins; stays lean)
   *   source — where in the codebase is this element defined?       (always worth carrying)
   *
   * The original rule was "a testid wins, so skip the component walk", which silently made source
   * conditional on the element NOT having a testid. The perverse result: an app that followed
   * Reticle's own advice and added data-testid everywhere got fewer source pointers than an
   * uninstrumented one. Since locating the right file is the most valuable thing we can hand an
   * agent, the anchor's leanness is not worth paying for with it.
   */
  it('carries source even when a testid is present', async () => {
    registerAdapter({
      name: 'aa-fake',
      identify: (el: Element): ComponentInfo | null => {
        const owner = el.closest('[data-component]');
        const name = owner?.getAttribute('data-component');
        if (name === null || name === undefined) return null;
        return { componentStack: [name], source: { file: 'src/Topbar.tsx', line: 31 } };
      },
    });
    document.body.innerHTML =
      '<div data-component="Topbar" data-src="src/Topbar.tsx:31">' +
      '<button data-testid="new-deploy">Open panel</button></div>';
    const btn = document.querySelector('button') as HTMLButtonElement;
    const res = await executeAction(refs.refFor(btn), 'click', {});

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.testid).toBe('new-deploy');
    expect(res.source).toEqual({ file: 'src/Topbar.tsx', line: 31 });
    expect(res.component).toBe('Topbar');
  });

  it('still reports the testid as the anchor when no source is discoverable', async () => {
    registerAdapter({ name: 'aa-fake', identify: (): ComponentInfo | null => null });
    document.body.innerHTML = '<button data-testid="new-deploy">Open panel</button>';
    const btn = document.querySelector('button') as HTMLButtonElement;
    const res = await executeAction(refs.refFor(btn), 'click', {});

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.testid).toBe('new-deploy');
    expect(res.source).toBeUndefined();
  });
});
