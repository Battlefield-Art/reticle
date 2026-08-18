import { afterEach, describe, expect, it } from 'vitest';
import { EventType } from '@reticlehq/core';
import { Annotator } from './annotator.js';

interface Emitted {
  type: EventType;
  data: Record<string, unknown>;
}

let current: Annotator | undefined;

function hudEl(): HTMLElement {
  const hud = document.createElement('div');
  hud.setAttribute('data-reticle-overlay', '');
  hud.innerHTML = '<button type="button" data-reticle-chat-toggle>Chat</button>';
  document.body.appendChild(hud);
  return hud;
}

function setup(): { ann: Annotator; emits: Emitted[]; hud: HTMLElement } {
  const emits: Emitted[] = [];
  const ann = new Annotator({ emit: (type, data) => emits.push({ type, data }), now: () => 0 });
  ann.mount();
  const hud = hudEl();
  current = ann;
  return { ann, emits, hud };
}

function clickAt(el: Element, x = 100, y = 120): void {
  el.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
  );
}

function popover(): HTMLElement {
  const pop = document.querySelector<HTMLElement>('[data-reticle-mark="pop"]');
  if (null === pop) throw new Error('no popover open');
  return pop;
}

function pageButton(html = '<button data-testid="cta">Pay</button>'): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  const el = host.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error('no page control');
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  current?.destroy();
  current = undefined;
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('data-reticle-mark-active');
});

describe('Annotator - human marks a mistake on the page', () => {
  it('does nothing on a click while inactive', () => {
    const { ann, emits } = setup();
    clickAt(pageButton());
    expect(ann.active).toBe(false);
    expect(document.querySelector('[data-reticle-mark="pop"]')).toBeNull();
    expect(emits).toHaveLength(0);
  });

  it('toggles annotate mode on and flags the html element for the crosshair cursor', () => {
    const { ann } = setup();
    ann.toggle(true);
    expect(ann.active).toBe(true);
    expect(document.documentElement.getAttribute('data-reticle-mark-active')).toBe('1');
  });

  it('applies the HUD marker accent onto the annotator root', () => {
    const { ann } = setup();
    ann.setAccent('#06b6d4');
    const root = document.querySelector<HTMLElement>('[data-reticle-mark="root"]');
    expect(root?.style.getPropertyValue('--reticle-mark-accent')).toBe('#06b6d4');
  });

  it('click → type → send emits a HUMAN_MARK with anchor, label, source, and route', () => {
    const { ann, emits } = setup();
    ann.toggle(true);
    clickAt(
      pageButton(
        '<button data-testid="checkout" data-reticle-source="src/Checkout.tsx:42:8">Pay</button>',
      ),
    );

    const textarea = popover().querySelector('textarea');
    if (null === textarea) throw new Error('no textarea');
    textarea.value = 'This button is misaligned';
    textarea.dispatchEvent(new Event('input'));
    popover().querySelector<HTMLButtonElement>('button[data-send]')?.click();

    expect(emits).toHaveLength(1);
    expect(emits[0]?.type).toBe(EventType.HUMAN_MARK);
    const d = emits[0]?.data;
    expect(d?.['note']).toBe('This button is misaligned');
    expect(d?.['anchor']).toBe('checkout');
    expect(d?.['source']).toEqual({ file: 'src/Checkout.tsx', line: 42 });
    expect(typeof d?.['route']).toBe('string');
    expect(document.querySelector('[data-reticle-mark="pop"]')).toBeNull();
    expect(ann.markCount).toBe(1);
    expect(document.querySelector('[data-reticle-mark="pin"] span')?.textContent).toBe('1');
  });

  it('calls onMark so the SDK can echo the flag into the live panel', () => {
    const echoes: { note: string; label: string }[] = [];
    const ann = new Annotator({
      emit: () => undefined,
      now: () => 0,
      onMark: (note, label) => echoes.push({ note, label }),
    });
    ann.mount();
    current = ann;
    ann.toggle(true);
    clickAt(pageButton());
    const textarea = popover().querySelector('textarea');
    if (null === textarea) throw new Error('no textarea');
    textarea.value = 'wrong color';
    textarea.dispatchEvent(new Event('input'));
    popover().querySelector<HTMLButtonElement>('button[data-send]')?.click();
    expect(echoes).toEqual([{ note: 'wrong color', label: 'button "Pay"' }]);
  });

  it('the send button stays disabled until the note is non-empty', () => {
    const { ann, emits } = setup();
    ann.toggle(true);
    clickAt(pageButton('<button>Go</button>'));
    const send = popover().querySelector<HTMLButtonElement>('button[data-send]');
    expect(send?.disabled).toBe(true);
    expect(emits).toHaveLength(0);
  });

  it('Enter in the note sends the mark', () => {
    const { ann, emits } = setup();
    ann.toggle(true);
    clickAt(pageButton());
    const textarea = popover().querySelector('textarea');
    if (null === textarea) throw new Error('no textarea');
    textarea.value = 'misaligned';
    textarea.dispatchEvent(new Event('input'));
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(emits).toHaveLength(1);
    expect(emits[0]?.data['note']).toBe('misaligned');
    expect(document.querySelector('[data-reticle-mark="pop"]')).toBeNull();
  });

  it('⌘/Ctrl+Enter in the note sends the mark', () => {
    const { ann, emits } = setup();
    ann.toggle(true);
    clickAt(pageButton());
    const textarea = popover().querySelector('textarea');
    if (null === textarea) throw new Error('no textarea');
    textarea.value = 'misaligned';
    textarea.dispatchEvent(new Event('input'));
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(emits).toHaveLength(1);
    expect(emits[0]?.data['note']).toBe('misaligned');
  });

  it('Enter does nothing while the note is empty', () => {
    const { ann, emits } = setup();
    ann.toggle(true);
    clickAt(pageButton('<button>Go</button>'));
    const textarea = popover().querySelector('textarea');
    textarea?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(emits).toHaveLength(0);
    expect(document.querySelector('[data-reticle-mark="pop"]')).not.toBeNull();
  });

  it('Escape closes an open popover; Escape again exits annotate mode', () => {
    const { ann } = setup();
    ann.toggle(true);
    clickAt(pageButton('<button>Go</button>'));
    expect(document.querySelector('[data-reticle-mark="pop"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[data-reticle-mark="pop"]')).toBeNull();
    expect(ann.active).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ann.active).toBe(false);
  });

  it('cancel closes the popover without emitting', () => {
    const { ann, emits } = setup();
    ann.toggle(true);
    clickAt(pageButton('<a href="#x">link</a>'));
    popover().querySelector<HTMLButtonElement>('button[data-cancel]')?.click();
    expect(document.querySelector('[data-reticle-mark="pop"]')).toBeNull();
    expect(emits).toHaveLength(0);
  });

  const restForHighlight = (): Promise<void> => new Promise((r) => setTimeout(r, 170));

  it('hover highlight boxes the element under the cursor (with a label) once it rests', async () => {
    const { ann } = setup();
    ann.toggle(true);
    const btn = pageButton('<button data-testid="cta">Pay now</button>');
    btn.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 30 }) as DOMRect;
    btn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const hi = document.querySelector<HTMLElement>('[data-reticle-mark="hi"]');
    expect(hi?.getAttribute('data-on')).not.toBe('1');
    await restForHighlight();
    expect(hi?.getAttribute('data-on')).toBe('1');
    expect(hi?.style.width).toBe('100px');
    expect(hi?.style.left).toBe('10px');
    expect(hi?.querySelector('[data-reticle-mark="hilabel"]')?.textContent).toBe('cta');
  });

  it('hover highlight stays off when inactive and hides over Reticle UI', async () => {
    const { ann, hud } = setup();
    const btn = pageButton('<button>Go</button>');
    btn.getBoundingClientRect = () => ({ left: 0, top: 0, width: 50, height: 20 }) as DOMRect;
    btn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await restForHighlight();
    expect(document.querySelector('[data-reticle-mark="hi"]')?.getAttribute('data-on')).toBe('0');
    ann.toggle(true);
    hud.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await restForHighlight();
    expect(document.querySelector('[data-reticle-mark="hi"]')?.getAttribute('data-on')).toBe('0');
  });

  it('never turns a click on the HUD into a mark', () => {
    const { ann, emits, hud } = setup();
    ann.toggle(true);
    hud.querySelector('button')?.click();
    expect(document.querySelector('[data-reticle-mark="pop"]')).toBeNull();
    expect(emits).toHaveLength(0);
    expect(ann.active).toBe(true);
  });

  it('keeps a numbered pin after submit and reopens it for edit', () => {
    const { ann, emits } = setup();
    ann.toggle(true);
    clickAt(pageButton('<button data-testid="save">Save</button>'));
    const textarea = popover().querySelector('textarea');
    if (null === textarea) throw new Error('no textarea');
    textarea.value = 'too small';
    textarea.dispatchEvent(new Event('input'));
    popover().querySelector<HTMLButtonElement>('button[data-send]')?.click();
    const pin = document.querySelector<HTMLElement>('[data-reticle-mark="pin"]');
    expect(pin?.querySelector('span')?.textContent).toBe('1');
    pin?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(popover().querySelector('textarea')?.value).toBe('too small');
    const again = popover().querySelector('textarea');
    if (null === again) throw new Error('no textarea');
    again.value = 'still too small';
    again.dispatchEvent(new Event('input'));
    popover().querySelector<HTMLButtonElement>('button[data-send]')?.click();
    expect(ann.markCount).toBe(1);
    expect(emits).toHaveLength(2);
    expect(emits[1]?.data['note']).toBe('still too small');
  });

  it('does not open a second pending mark on the same element', () => {
    const { ann } = setup();
    ann.toggle(true);
    const btn = pageButton('<button data-testid="once">Once</button>');
    clickAt(btn);
    clickAt(btn, 110, 130);
    expect(document.querySelectorAll('[data-reticle-mark="pop"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-reticle-mark="pending"]')).toHaveLength(1);
    expect(popover().classList.contains('reticle-mark-shake')).toBe(true);
  });

  it('hides pins when markers are toggled off', () => {
    const { ann } = setup();
    const markersBtn = document.createElement('button');
    markersBtn.setAttribute('data-reticle-markers-btn', '');
    document.body.appendChild(markersBtn);
    ann.attachChrome({ markersBtn });
    ann.toggle(true);
    clickAt(pageButton('<button data-testid="x">X</button>'));
    const textarea = popover().querySelector('textarea');
    if (null === textarea) throw new Error('no textarea');
    textarea.value = 'note';
    textarea.dispatchEvent(new Event('input'));
    popover().querySelector<HTMLButtonElement>('button[data-send]')?.click();
    expect(
      document.querySelector('[data-reticle-mark="root"]')?.getAttribute('data-hide'),
    ).toBeNull();
    markersBtn.click();
    expect(document.querySelector('[data-reticle-mark="root"]')?.getAttribute('data-hide')).toBe(
      '1',
    );
  });

  it('marks a pin stale when its element disappears', () => {
    const { ann } = setup();
    ann.toggle(true);
    const btn = pageButton('<button data-testid="gone">Gone</button>');
    clickAt(btn);
    const textarea = popover().querySelector('textarea');
    if (null === textarea) throw new Error('no textarea');
    textarea.value = 'vanished';
    textarea.dispatchEvent(new Event('input'));
    popover().querySelector<HTMLButtonElement>('button[data-send]')?.click();
    btn.remove();
    ann.syncAnchors();
    expect(document.querySelector('[data-reticle-mark="pin"]')?.getAttribute('data-stale')).toBe(
      '1',
    );
  });

  it('clicking outside a pending popover shakes it instead of dismissing', () => {
    const { ann, emits } = setup();
    ann.toggle(true);
    clickAt(pageButton('<button data-testid="keep">Keep</button>'));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(document.querySelector('[data-reticle-mark="pop"]')).not.toBeNull();
    expect(popover().classList.contains('reticle-mark-shake')).toBe(true);
    expect(emits).toHaveLength(0);
  });
});
