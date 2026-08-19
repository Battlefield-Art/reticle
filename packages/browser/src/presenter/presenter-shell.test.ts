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
  // Expanding now OPENS the chat rather than revealing a bare toolbar: the chat is the HUD's
  // content, and a toolbar with nothing above it made the agent's log something you had to know to
  // go looking for. The toggle still closes it, which the next assertion covers.
  it('opens agent chat above the toolbar on expand, and closes on Escape', () => {
    document.body.innerHTML = '';
    const p = new Presenter({});
    p.mount();
    p.sessionStart();
    click(document.querySelector('[data-reticle-fab]'));
    const overlay = document.querySelector('div[data-reticle-overlay]');
    expect(overlay?.getAttribute('data-reticle-chat'), 'chat opens with the HUD').toBe('1');
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

/**
 * Annotation is a mode the user chooses, so it needs a control they can see and press.
 *
 * It used to be reachable only as a side effect of expanding the HUD: expand and you were
 * annotating, collapse and you were not. That left no way to keep the HUD open and stop annotating,
 * and nothing on screen said the mode existed — the old floating button that used to say so was
 * removed with the HUD refresh, and its job did not move anywhere.
 *
 * The toggle is the user's half only. Annotation still also needs a live session and an open HUD;
 * this asserts the half that was missing without asserting away the other two.
 */
describe('the annotate toggle', () => {
  it('is in the toolbar and OFF until asked for', () => {
    document.body.innerHTML = '';
    const p = new Presenter({});
    p.mount();
    p.sessionStart();
    click(document.querySelector('[data-reticle-fab]'));
    const btn = document.querySelector('[data-reticle-annotate-btn]');
    expect(btn, 'the control must exist in the toolbar').not.toBeNull();
    expect(
      btn?.getAttribute('aria-pressed'),
      'annotate captures clicks, so it is entered deliberately rather than defaulted on',
    ).toBe('false');
    p.destroy();
  });

  it('flips off and back on, and reports it to assistive tech both ways', () => {
    document.body.innerHTML = '';
    const p = new Presenter({});
    p.mount();
    p.sessionStart();
    click(document.querySelector('[data-reticle-fab]'));
    const btn = document.querySelector('[data-reticle-annotate-btn]');
    click(btn);
    expect(btn?.getAttribute('aria-pressed')).toBe('true');
    expect(btn?.getAttribute('data-active')).toBe('1');
    click(btn);
    expect(btn?.getAttribute('aria-pressed')).toBe('false');
    expect(btn?.getAttribute('data-active')).toBe('0');
    p.destroy();
  });

  /** Pressing it must not also open the chat or collapse the HUD — it sits inside both handlers. */
  it('does not disturb the HUD it lives in', () => {
    document.body.innerHTML = '';
    const p = new Presenter({});
    p.mount();
    p.sessionStart();
    click(document.querySelector('[data-reticle-fab]'));
    const overlay = document.querySelector('div[data-reticle-overlay]');
    const before = overlay?.getAttribute('data-reticle-min');
    const chatBefore = overlay?.getAttribute('data-reticle-chat');
    click(document.querySelector('[data-reticle-annotate-btn]'));
    expect(overlay?.getAttribute('data-reticle-min')).toBe(before);
    expect(overlay?.getAttribute('data-reticle-chat'), 'the chat is left as it was').toBe(
      chatBefore,
    );
    p.destroy();
  });
});

/**
 * The chat needs its own way back, or the only exit is collapsing the whole HUD.
 *
 * Now that expanding opens the chat, "close the chat but keep driving" had no control at all: the
 * toolbar toggle was the sole route and it is easy to miss above a full-height panel.
 */
describe('the chat minimise button', () => {
  it('closes the chat and leaves the toolbar expanded', () => {
    document.body.innerHTML = '';
    const p = new Presenter({});
    p.mount();
    p.sessionStart();
    click(document.querySelector('[data-reticle-fab]'));
    const overlay = document.querySelector('div[data-reticle-overlay]');
    expect(overlay?.getAttribute('data-reticle-chat')).toBe('1');
    click(document.querySelector('[data-reticle-chat-min]'));
    expect(overlay?.getAttribute('data-reticle-chat'), 'chat is minimised').toBeNull();
    expect(overlay?.getAttribute('data-reticle-min'), 'the HUD stays open').toBe('0');
    p.destroy();
  });
});
