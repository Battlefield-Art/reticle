import { describe, it, expect, afterEach } from 'vitest';
import { Presenter } from './presenter.js';
import { SETTINGS_ATTR, SETTINGS_STORAGE_KEY } from './presenter-config.js';
import { Annotator } from '../review/annotator.js';

afterEach(() => {
  document.querySelectorAll('[data-reticle-overlay]').forEach((e) => e.remove());
  document.body.innerHTML = '';
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
});

describe('presenter settings', () => {
  it('anchors the settings card to the dock above the HUD', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    p.sessionStart();
    (document.querySelector('[data-reticle-fab]') as HTMLElement).click();
    (document.querySelector('[data-reticle-settings-btn]') as HTMLElement).click();
    const dock = document.querySelector('[data-reticle-dock]');
    const panel = document.querySelector('[data-reticle-settings-panel]');
    expect(dock?.contains(panel)).toBe(true);
    const css = document.querySelector('style[data-reticle-overlay]')?.textContent ?? '';
    expect(css).toContain('bottom:calc(100% + 12px)');
    expect(css).toContain('overflow-y:auto');
    expect(css).toContain('data-reticle-chat-panel');
    p.destroy();
  });

  it('hides the chat panel while settings are open', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    p.sessionStart();
    (document.querySelector('[data-reticle-fab]') as HTMLElement).click();
    (document.querySelector('[data-reticle-chat-toggle]') as HTMLElement).click();
    (document.querySelector('[data-reticle-settings-btn]') as HTMLElement).click();
    const overlay = document.querySelector('div[data-reticle-overlay]') as HTMLElement;
    const chat = document.querySelector('[data-reticle-chat-panel]') as HTMLElement;
    expect(overlay.getAttribute(SETTINGS_ATTR)).toBe('1');
    expect(window.getComputedStyle(chat).display).toBe('none');
    p.destroy();
  });

  it('settings gear toggles the settings card', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    const overlay = document.querySelector('div[data-reticle-overlay]') as HTMLElement;
    const gear = document.querySelector('[data-reticle-settings-btn]') as HTMLElement;
    gear.click();
    expect(overlay.getAttribute(SETTINGS_ATTR)).toBe('1');
    expect(document.querySelector('[data-reticle-settings-panel]')).not.toBeNull();
    document
      .querySelector('[data-reticle-settings-close]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay.getAttribute(SETTINGS_ATTR)).toBe('0');
    p.destroy();
  });

  it('marker color swatches use a selected ring', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    const ann = new Annotator({ emit: () => {}, now: () => 0 });
    ann.mount();
    p.bindAnnotator(ann);
    const cyan = document.querySelector('[data-accent="cyan"]') as HTMLElement;
    cyan.click();
    expect(cyan.getAttribute('data-on')).toBe('1');
    expect(document.querySelector('[data-reticle-dock]')?.getAttribute('data-reticle-accent')).toBe(
      'cyan',
    );
    const root = document.querySelector<HTMLElement>('[data-reticle-mark="root"]');
    expect(root?.style.getPropertyValue('--reticle-mark-accent')).toBe('#06b6d4');
    p.destroy();
    ann.destroy();
  });

  it('settings persist show-tally preference', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    const tallyToggle = document.querySelector('[data-reticle-setting="showTally"]') as HTMLElement;
    tallyToggle.click();
    p.destroy();
    const p2 = new Presenter({ border: 'session' });
    p2.mount();
    expect(
      document.querySelector('[data-reticle-setting="showTally"]')?.getAttribute('data-on'),
    ).toBe('1');
    p2.destroy();
  });

  it('does not close settings when clicking inside the card', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    p.sessionStart();
    (document.querySelector('[data-reticle-fab]') as HTMLElement).click();
    (document.querySelector('[data-reticle-settings-btn]') as HTMLElement).click();
    const overlay = document.querySelector('div[data-reticle-overlay]');
    document
      .querySelector('[data-reticle-settings-panel]')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(overlay?.getAttribute(SETTINGS_ATTR)).toBe('1');
    p.destroy();
  });

  it('escape closes settings before collapsing the toolbar', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    p.sessionStart();
    (document.querySelector('[data-reticle-fab]') as HTMLElement).click();
    (document.querySelector('[data-reticle-settings-btn]') as HTMLElement).click();
    const overlay = document.querySelector('div[data-reticle-overlay]') as HTMLElement;
    expect(overlay.getAttribute(SETTINGS_ATTR)).toBe('1');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay.getAttribute(SETTINGS_ATTR)).toBe('0');
    expect(overlay.getAttribute('data-reticle-min')).toBe('0');
    p.destroy();
  });

  it('cycles output detail, blocks the page, and hides until restart', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    p.sessionStart();
    (document.querySelector('[data-reticle-fab]') as HTMLElement).click();
    const overlay = document.querySelector('div[data-reticle-overlay]') as HTMLElement;
    expect(overlay.getAttribute('data-reticle-block')).toBe('1');
    document
      .querySelector('[data-reticle-check="blockPageInteractions"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay.getAttribute('data-reticle-block')).toBe('0');
    const cycle = document.querySelector(
      '[data-reticle-settings-cycle="outputDetail"]',
    ) as HTMLElement;
    const before = document.querySelector('[data-reticle-cycle-label]')?.textContent;
    cycle.click();
    expect(document.querySelector('[data-reticle-cycle-label]')?.textContent).not.toBe(before);
    document
      .querySelector('[data-reticle-setting="hideUntilRestart"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay.getAttribute('data-reticle-hidden')).toBe('1');
    p.destroy();
  });

  it('settings toggles respond when the toolbar is a drag handle', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    p.sessionStart();
    (document.querySelector('[data-reticle-fab]') as HTMLElement).click();
    (document.querySelector('[data-reticle-settings-btn]') as HTMLElement).click();
    const tallyToggle = document.querySelector('[data-reticle-setting="showTally"]') as HTMLElement;
    expect(tallyToggle.getAttribute('data-on')).toBe('0');
    tallyToggle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    tallyToggle.click();
    expect(tallyToggle.getAttribute('data-on')).toBe('1');
    p.destroy();
  });

  it('checkbox rows toggle when clicking the label text', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    p.sessionStart();
    (document.querySelector('[data-reticle-fab]') as HTMLElement).click();
    (document.querySelector('[data-reticle-settings-btn]') as HTMLElement).click();
    const label = document.querySelector(
      '[data-reticle-check-row="clearOnCopy"] .reticle-settings-check-label',
    );
    label?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(
      document.querySelector('[data-reticle-check="clearOnCopy"]')?.getAttribute('data-on'),
    ).toBe('1');
    p.destroy();
  });

  it('block page interactions enables the overlay blocker', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    const overlay = document.querySelector('div[data-reticle-overlay]') as HTMLElement;
    const blocker = overlay.querySelector('[data-reticle-blocker]') as HTMLElement;
    expect(overlay.getAttribute('data-reticle-block')).toBe('1');
    expect(getComputedStyle(blocker).pointerEvents).toBe('auto');
    p.destroy();
  });

  it('show timestamps preference toggles log timestamp visibility', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    p.sessionStart();
    (document.querySelector('[data-reticle-fab]') as HTMLElement).click();
    (document.querySelector('[data-reticle-settings-btn]') as HTMLElement).click();
    const overlay = document.querySelector('div[data-reticle-overlay]') as HTMLElement;
    expect(overlay.getAttribute('data-reticle-log-ts')).toBe('1');
    (document.querySelector('[data-reticle-setting="showTimestamps"]') as HTMLElement).click();
    expect(overlay.getAttribute('data-reticle-log-ts')).toBe('0');
    p.destroy();
  });

  it('reset HUD position button clears a dragged dock', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    p.sessionStart();
    const dock = document.querySelector('[data-reticle-dock]') as HTMLElement;
    dock.setAttribute('data-dragged', '1');
    dock.style.setProperty('--reticle-hud-x', '120px');
    (document.querySelector('[data-reticle-fab]') as HTMLElement).click();
    (document.querySelector('[data-reticle-settings-btn]') as HTMLElement).click();
    (document.querySelector('[data-reticle-settings-reset]') as HTMLElement).click();
    expect(dock.getAttribute('data-dragged')).toBeNull();
    expect(dock.style.getPropertyValue('--reticle-hud-x')).toBe('');
    p.destroy();
  });

  it('opening chat closes settings, and opening settings closes chat', () => {
    const p = new Presenter({ border: 'session' });
    p.mount();
    p.sessionStart();
    (document.querySelector('[data-reticle-fab]') as HTMLElement).click();
    const overlay = document.querySelector('div[data-reticle-overlay]') as HTMLElement;
    (document.querySelector('[data-reticle-settings-btn]') as HTMLElement).click();
    expect(overlay.getAttribute(SETTINGS_ATTR)).toBe('1');
    (document.querySelector('[data-reticle-chat-toggle]') as HTMLElement).click();
    expect(overlay.getAttribute(SETTINGS_ATTR)).toBe('0');
    expect(overlay.getAttribute('data-reticle-chat')).toBe('1');
    (document.querySelector('[data-reticle-settings-btn]') as HTMLElement).click();
    expect(overlay.getAttribute(SETTINGS_ATTR)).toBe('1');
    expect(overlay.getAttribute('data-reticle-chat')).toBeNull();
    p.destroy();
  });
});
