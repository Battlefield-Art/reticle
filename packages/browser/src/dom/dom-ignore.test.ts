import { describe, it, expect, afterEach } from 'vitest';
import { isReticleOverlay, isIgnored } from './dom-ignore.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('dom-ignore — Reticle-owned UI is excluded from observation/snapshot', () => {
  it('treats the annotator (data-reticle-mark) as Reticle overlay, not app content', () => {
    // The annotator mounts by default with the presenter and tags every node with data-reticle-mark.
    // If it is not recognized here, its "Flag a bug" button and highlight-box mutations leak into the
    // snapshot and the DOM/animation event streams as if the APP rendered them.
    document.body.innerHTML = '<button data-reticle-mark="fab">Flag a bug</button>';
    const fab = document.querySelector('[data-reticle-mark]');
    expect(fab).not.toBeNull();
    if (null === fab) return;
    expect(isReticleOverlay(fab)).toBe(true);
    expect(isIgnored(fab)).toBe(true);
  });

  it('still recognizes the presenter overlay/cursor/hud/glow', () => {
    for (const attr of [
      'data-reticle-overlay',
      'data-reticle-cursor',
      'data-reticle-hud',
      'data-reticle-glow',
    ]) {
      const el = document.createElement('div');
      el.setAttribute(attr, '');
      document.body.appendChild(el);
      expect(isReticleOverlay(el)).toBe(true);
    }
  });

  it('does NOT ignore an ordinary app element', () => {
    document.body.innerHTML = '<button>Real app button</button>';
    const btn = document.querySelector('button');
    expect(btn).not.toBeNull();
    if (null === btn) return;
    expect(isReticleOverlay(btn)).toBe(false);
    expect(isIgnored(btn)).toBe(false);
  });
});
