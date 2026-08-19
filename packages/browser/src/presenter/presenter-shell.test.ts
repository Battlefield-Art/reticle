import { describe, it, expect, afterEach } from 'vitest';
import { Presenter } from './presenter.js';

const click = (el: Element | null | undefined): void => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

afterEach(() => {
  document.querySelectorAll('[data-reticle-overlay]').forEach((e) => e.remove());
  document.body.innerHTML = '';
});
describe('presenter HUD shell', () => {
  it('opens agent chat above the toolbar and closes on Escape', () => {
    document.body.innerHTML = '';
    const p = new Presenter({});
    p.mount();
    p.sessionStart();
    click(document.querySelector('[data-reticle-fab]'));
    click(document.querySelector('[data-reticle-chat-toggle]'));
    const overlay = document.querySelector('div[data-reticle-overlay]');
    expect(overlay?.getAttribute('data-reticle-chat')).toBe('1');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay?.getAttribute('data-reticle-chat')).toBeNull();
    p.destroy();
  });
  it('keeps the toolbar expanded while agent chat is open', () => {
    document.body.innerHTML = '';
    const p = new Presenter({});
    p.mount();
    p.sessionStart();
    click(document.querySelector('[data-reticle-fab]'));
    click(document.querySelector('[data-reticle-chat-toggle]'));
    const overlay = document.querySelector('div[data-reticle-overlay]');
    expect(overlay?.getAttribute('data-reticle-min')).toBe('0');
    expect(overlay?.getAttribute('data-reticle-chat')).toBe('1');
    p.destroy();
  });
  it('keeps the toolbar expanded when clicking the page', () => {
    document.body.innerHTML = '';
    const p = new Presenter({});
    p.mount();
    p.sessionStart();
    click(document.querySelector('[data-reticle-fab]'));
    const overlay = document.querySelector('div[data-reticle-overlay]');
    expect(overlay?.getAttribute('data-reticle-min')).toBe('0');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(overlay?.getAttribute('data-reticle-min')).toBe('0');
    p.destroy();
  });
  it('uses polished black surfaces without embedded textures', () => {
    const p = new Presenter({});
    p.mount();
    const css = document.querySelector('style[data-reticle-overlay]')?.textContent ?? '';
    expect(css).toContain('background:#000');
    expect(css).not.toMatch(/data:image\/(?:png|webp|svg\+xml)/);
    p.destroy();
  });
  it('shows edge sheen only on the expanded toolbar, not the collapsed FAB', () => {
    const p = new Presenter({});
    p.mount();
    p.sessionStart();
    const css = document.querySelector('style[data-reticle-overlay]')?.textContent ?? '';
    expect(css).toContain('[data-reticle-min="0"] [data-reticle-hud] .reticle-hud-deco');
    const deco = document.querySelector<HTMLElement>('.reticle-hud-deco');
    expect(deco).not.toBeNull();
    const collapsed = getComputedStyle(deco as Element).visibility;
    expect(collapsed).toBe('hidden');
    (document.querySelector('[data-reticle-fab]') as HTMLElement).click();
    expect(getComputedStyle(deco as Element).visibility).toBe('visible');
    p.destroy();
  });
  it('ships a workspace chip in the chat composer', () => {
    document.body.innerHTML = '';
    const p = new Presenter({});
    p.mount();
    expect(document.querySelector('[data-reticle-workspace-btn]')).not.toBeNull();
    expect(document.querySelector('.reticle-composer-stack')).not.toBeNull();
    p.destroy();
  });
  it('does not ship a separate flag-a-bug control', () => {
    document.body.innerHTML = '';
    const p = new Presenter({});
    p.mount();
    expect(document.querySelector('[data-reticle-flag-btn]')).toBeNull();
    expect(document.querySelector('[data-reticle-chat-toggle]')).not.toBeNull();
    p.destroy();
  });
  it('ships inline icons on chat and settings toolbar buttons', () => {
    document.body.innerHTML = '';
    const p = new Presenter({});
    p.mount();
    p.sessionStart();
    click(document.querySelector('[data-reticle-fab]'));
    const chat = document.querySelector('[data-reticle-chat-toggle]');
    const settings = document.querySelector('[data-reticle-settings-btn]');
    expect(chat?.querySelector('svg')).not.toBeNull();
    expect(settings?.querySelector('svg')).not.toBeNull();
    p.destroy();
  });
  it('drags from the collapsed FAB without expanding on release', () => {
    document.body.innerHTML = '';
    const p = new Presenter({});
    p.mount();
    p.sessionStart();
    const fab = document.querySelector('[data-reticle-fab]');
    const dock = document.querySelector('[data-reticle-dock]');
    expect(fab).not.toBeNull();
    expect(dock).not.toBeNull();
    fab?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        pointerId: 9,
        button: 0,
      }),
    );
    fab?.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 200, clientY: 80, pointerId: 9 }),
    );
    fab?.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, clientX: 200, clientY: 80, pointerId: 9 }),
    );
    const overlay = document.querySelector('div[data-reticle-overlay]');
    expect(overlay?.getAttribute('data-reticle-min')).toBe('1');
    expect(dock?.getAttribute('data-dragged')).toBe('1');
    p.destroy();
  });
});
