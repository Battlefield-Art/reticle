import {
  SETTINGS_ATTR,
  SETTINGS_BTN_ATTR,
  SETTINGS_PANEL_ATTR,
  SETTINGS_CLOSE_ATTR,
  SETTING_KEY_ATTR,
  SETTINGS_STORAGE_KEY,
  ACCENT_ATTR,
  BLOCK_ATTR,
  HIDDEN_UNTIL_RESTART_ATTR,
  LOG_TIMESTAMPS_ATTR,
  COMPACT_CHAT_ATTR,
  REDUCE_MOTION_ATTR,
  DOCK_ATTR,
  MCP_DOCS_URL,
} from './presenter-config.js';
import { PresenterIcon, PRESENTER_ICON_SIZE, setHiIcon, hiIconHtml } from './presenter-icons.js';
import { HUD_SURFACE_CLASS } from './presenter-hud-chrome.js';
import { resetHudDockPosition } from './presenter-drag.js';
import { findDock, scheduleSyncDockLayout } from './presenter-dock-layout.js';
import { SETTINGS_CSS } from './presenter-settings-styles.js';

export { SETTINGS_CSS };

/** How much detail lands in copied/exported run state. */
export const OutputDetail = {
  MINIMAL: 'minimal',
  STANDARD: 'standard',
  VERBOSE: 'verbose',
} as const;
export type OutputDetail = (typeof OutputDetail)[keyof typeof OutputDetail];

/** Accent swatches for the HUD chrome. */
export const AccentColorId = {
  PURPLE: 'purple',
  BLUE: 'blue',
  CYAN: 'cyan',
  GREEN: 'green',
  YELLOW: 'yellow',
  ORANGE: 'orange',
  RED: 'red',
} as const;
export type AccentColorId = (typeof AccentColorId)[keyof typeof AccentColorId];

export interface PresenterSettings {
  outputDetail: OutputDetail;
  reactComponents: boolean;
  hideUntilRestart: boolean;
  accentColorId: AccentColorId;
  clearOnCopy: boolean;
  blockPageInteractions: boolean;
  showTally: boolean;
  showTimestamps: boolean;
  compactChat: boolean;
  autoOpenChat: boolean;
  reduceMotion: boolean;
}

const OUTPUT_DETAIL_OPTIONS: { value: OutputDetail; label: string }[] = [
  { value: OutputDetail.MINIMAL, label: 'Minimal' },
  { value: OutputDetail.STANDARD, label: 'Standard' },
  { value: OutputDetail.VERBOSE, label: 'Verbose' },
];

const ACCENT_SWATCHES: { id: AccentColorId; color: string }[] = [
  { id: AccentColorId.PURPLE, color: '#a855f7' },
  { id: AccentColorId.BLUE, color: '#3b82f6' },
  { id: AccentColorId.CYAN, color: '#06b6d4' },
  { id: AccentColorId.GREEN, color: '#22c55e' },
  { id: AccentColorId.YELLOW, color: '#eab308' },
  { id: AccentColorId.ORANGE, color: '#f97316' },
  { id: AccentColorId.RED, color: '#ef4444' },
];

const DEFAULT_SETTINGS: PresenterSettings = {
  outputDetail: OutputDetail.STANDARD,
  reactComponents: false,
  hideUntilRestart: false,
  accentColorId: AccentColorId.BLUE,
  clearOnCopy: false,
  blockPageInteractions: true,
  showTally: false,
  showTimestamps: true,
  compactChat: false,
  autoOpenChat: false,
  reduceMotion: false,
};

let activeSettings: PresenterSettings = loadPresenterSettings();

export function getPresenterSettings(): PresenterSettings {
  return activeSettings;
}

export function loadPresenterSettings(): PresenterSettings {
  if ('undefined' === typeof localStorage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (null === raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if ('object' !== typeof parsed || null === parsed) return { ...DEFAULT_SETTINGS };
    const o = parsed as Record<string, unknown>;
    return {
      outputDetail: isOutputDetail(o['outputDetail'])
        ? o['outputDetail']
        : DEFAULT_SETTINGS.outputDetail,
      reactComponents: true === o['reactComponents'],
      hideUntilRestart: true === o['hideUntilRestart'],
      accentColorId: isAccentColorId(o['accentColorId'])
        ? o['accentColorId']
        : DEFAULT_SETTINGS.accentColorId,
      clearOnCopy: true === o['clearOnCopy'],
      blockPageInteractions:
        'boolean' === typeof o['blockPageInteractions']
          ? o['blockPageInteractions']
          : DEFAULT_SETTINGS.blockPageInteractions,
      showTally: 'boolean' === typeof o['showTally'] ? o['showTally'] : DEFAULT_SETTINGS.showTally,
      showTimestamps:
        'boolean' === typeof o['showTimestamps']
          ? o['showTimestamps']
          : DEFAULT_SETTINGS.showTimestamps,
      compactChat:
        'boolean' === typeof o['compactChat'] ? o['compactChat'] : DEFAULT_SETTINGS.compactChat,
      autoOpenChat:
        'boolean' === typeof o['autoOpenChat'] ? o['autoOpenChat'] : DEFAULT_SETTINGS.autoOpenChat,
      reduceMotion:
        'boolean' === typeof o['reduceMotion'] ? o['reduceMotion'] : DEFAULT_SETTINGS.reduceMotion,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function isOutputDetail(v: unknown): v is OutputDetail {
  return v === OutputDetail.MINIMAL || v === OutputDetail.STANDARD || v === OutputDetail.VERBOSE;
}

function isAccentColorId(v: unknown): v is AccentColorId {
  return ACCENT_SWATCHES.some((s) => s.id === v);
}

export function accentColor(id: AccentColorId): string {
  return ACCENT_SWATCHES.find((s) => s.id === id)?.color ?? '#3b82f6';
}

function persistSettings(next: PresenterSettings): void {
  activeSettings = next;
  if ('undefined' === typeof localStorage) return;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode - settings still apply for this page */
  }
}

function patchSettings(patch: Partial<PresenterSettings>): PresenterSettings {
  const next = { ...activeSettings, ...patch };
  persistSettings(next);
  return next;
}

function settingsHelpIcon(): string {
  return hiIconHtml(PresenterIcon.HELP, PRESENTER_ICON_SIZE.HELP);
}

function settingsLabel(text: string, helpTitle: string): string {
  const help = settingsHelpIcon();
  return `<span class="reticle-settings-label">${text}<button type="button" class="reticle-settings-help" title="${helpTitle}" aria-label="${helpTitle}">${help}</button></span>`;
}

function settingsToggleRow(key: string, label: string, helpTitle: string, extra = ''): string {
  return `<div class="reticle-settings-row" ${extra}>
    ${settingsLabel(label, helpTitle)}
    <button type="button" class="reticle-settings-toggle" ${SETTING_KEY_ATTR}="${key}" role="switch" aria-checked="false"></button>
  </div>`;
}

function settingsCheckRow(key: string, label: string, checked: boolean): string {
  const on = checked ? 'true' : 'false';
  return `<label class="reticle-settings-checkrow" data-reticle-check-row="${key}">
    <span class="reticle-settings-check" data-reticle-check="${key}" role="checkbox" aria-checked="${on}" tabindex="0"></span>
    <span class="reticle-settings-check-label">${label}</span>
  </label>`;
}

/** Settings panel markup - anchored above the gear in the toolbar. */
export function settingsPanelHtml(): string {
  const close = hiIconHtml(PresenterIcon.REMOVE, PRESENTER_ICON_SIZE.MIN);
  const caret = hiIconHtml(PresenterIcon.CARET_RIGHT, PRESENTER_ICON_SIZE.HELP);
  const outputHelp = 'How much detail is included when you copy or export the run';
  const reactHelp = 'Include React component paths in exported run state when available';
  const hideHelp = 'Hide the Reticle HUD until you reload the page';
  const tallyHelp = 'Show the pass/fail score pill in the toolbar';
  const timestampsHelp = 'Show relative timestamps on each activity-log row';
  const compactHelp = 'Use a slightly narrower agent chat panel';
  const autoChatHelp =
    'Open the agent chat by itself when a session starts and when you expand the HUD. Off leaves the toolbar bare until you ask for the chat.';
  const motionHelp = 'Reduce HUD animations for accessibility';
  return `<div ${SETTINGS_PANEL_ATTR} class="reticle-settings ${HUD_SURFACE_CLASS}" role="dialog" aria-label="Reticle settings" aria-hidden="true">
    <div class="reticle-settings-inner">
      <div class="reticle-settings-head">
        <span class="reticle-settings-title">Settings</span>
        <button type="button" ${SETTINGS_CLOSE_ATTR} class="reticle-settings-close" title="Close settings" aria-label="Close settings">${close}</button>
      </div>
      <div class="reticle-settings-body">
        <div class="reticle-settings-section">Session</div>
        <div class="reticle-settings-row">
          ${settingsLabel('Output Detail', outputHelp)}
          <button type="button" class="reticle-settings-cycle" data-reticle-settings-cycle="outputDetail"><span data-reticle-cycle-label></span><span class="reticle-settings-dots" data-reticle-cycle-dots></span></button>
        </div>
        ${settingsToggleRow('autoOpenChat', 'Auto-open chat', autoChatHelp)}
        ${settingsToggleRow('showTimestamps', 'Show timestamps', timestampsHelp)}
        ${settingsToggleRow('showTally', 'Show verdict tally', tallyHelp)}
        <div class="reticle-settings-section">Inspector</div>
        ${settingsToggleRow('reactComponents', 'React Components', reactHelp, 'data-reticle-settings-react-row')}
        <div class="reticle-settings-section">Interaction</div>
        ${settingsCheckRow('blockPageInteractions', 'Block page interactions', true)}
        ${settingsCheckRow('clearOnCopy', 'Clear on copy/send', false)}
        ${settingsToggleRow('hideUntilRestart', 'Hide Until Restart', hideHelp)}
        ${settingsToggleRow('compactChat', 'Compact chat width', compactHelp)}
        ${settingsToggleRow('reduceMotion', 'Reduce motion', motionHelp)}
        <div class="reticle-settings-section">Appearance</div>
        <div class="reticle-settings-swatches" data-reticle-settings-swatches></div>
      </div>
      <div class="reticle-settings-foot">
        <button type="button" class="reticle-settings-reset" data-reticle-settings-reset>Reset HUD position</button>
        <button type="button" class="reticle-settings-link" data-reticle-settings-mcp>Manage MCP &amp; Webhooks<span class="reticle-settings-link-caret" aria-hidden="true">${caret}</span></button>
      </div>
    </div>
  </div>`;
}

export interface SettingsHost {
  onHideUntilRestart?: () => void;
  onSettingsChange?: (settings: PresenterSettings) => void;
  onBeforeOpen?: () => void;
}

/** Apply persisted settings onto the overlay + dock. */
export function applyPresenterSettings(root: HTMLElement, settings: PresenterSettings): void {
  const dock = root.querySelector('[data-reticle-dock]');
  if (dock instanceof HTMLElement) {
    dock.setAttribute(ACCENT_ATTR, settings.accentColorId);
  }
  root.style.setProperty('--reticle-mark-accent', accentColor(settings.accentColorId));
  if (settings.hideUntilRestart) {
    root.setAttribute(HIDDEN_UNTIL_RESTART_ATTR, '1');
  } else {
    root.removeAttribute(HIDDEN_UNTIL_RESTART_ATTR);
  }
  root.setAttribute(LOG_TIMESTAMPS_ATTR, settings.showTimestamps ? '1' : '0');
  root.setAttribute(COMPACT_CHAT_ATTR, settings.compactChat ? '1' : '0');
  root.setAttribute(REDUCE_MOTION_ATTR, settings.reduceMotion ? '1' : '0');
  const tally = root.querySelector('[data-reticle-tally]');
  if (tally instanceof HTMLElement && !settings.showTally) {
    tally.setAttribute('hidden', '');
  }
}

/**
 * Toggle the full-page blocker. Only active while annotate mode is live AND the user opted in -
 * never on a collapsed FAB, so real hover/click on the host app still works.
 */
export function syncPageBlocker(
  root: HTMLElement,
  settings: PresenterSettings,
  annotateLive: boolean,
): void {
  root.setAttribute(BLOCK_ATTR, settings.blockPageInteractions && annotateLive ? '1' : '0');
}

/** Blocker node - sits under Reticle UI, above the host page. */
export function blockerHtml(): string {
  return '<div data-reticle-blocker aria-hidden="true"></div>';
}

export class PresenterSettingsPanel {
  #root: HTMLElement | undefined;
  #panel: HTMLElement | undefined;
  #btn: HTMLElement | undefined;
  #host: SettingsHost;

  constructor(host: SettingsHost = {}) {
    this.#host = host;
    activeSettings = loadPresenterSettings();
  }

  contains(node: Node): boolean {
    return true === this.#panel?.contains(node);
  }

  mount(root: HTMLElement): void {
    this.#root = root;
    const panel = root.querySelector(`[${SETTINGS_PANEL_ATTR}]`);
    this.#panel = panel instanceof HTMLElement ? panel : undefined;
    this.#panel?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });
    const btn = root.querySelector(`[${SETTINGS_BTN_ATTR}]`);
    this.#btn = btn instanceof HTMLElement ? btn : undefined;
    const closeBtn = root.querySelector(`[${SETTINGS_CLOSE_ATTR}]`);
    if (closeBtn instanceof HTMLElement) {
      setHiIcon(closeBtn, PresenterIcon.REMOVE, PRESENTER_ICON_SIZE.MIN);
    }
    if (this.#btn !== undefined) {
      setHiIcon(this.#btn, PresenterIcon.GEAR, PRESENTER_ICON_SIZE.TOOLBAR);
      this.#btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });
    }
    root
      .querySelector(`[data-reticle-settings-cycle="outputDetail"]`)
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = OUTPUT_DETAIL_OPTIONS.findIndex((o) => o.value === activeSettings.outputDetail);
        const next = OUTPUT_DETAIL_OPTIONS[(idx + 1) % OUTPUT_DETAIL_OPTIONS.length];
        if (next !== undefined) this.#update({ outputDetail: next.value });
      });
    for (const help of root.querySelectorAll('.reticle-settings-help')) {
      help.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }
    for (const toggle of root.querySelectorAll(`[${SETTING_KEY_ATTR}]`)) {
      const activateToggle = (): void => {
        if (!(toggle instanceof HTMLElement)) return;
        const key = toggle.getAttribute(SETTING_KEY_ATTR);
        if ('reactComponents' === key) {
          this.#update({ reactComponents: !activeSettings.reactComponents });
        } else if ('hideUntilRestart' === key) {
          const next = !activeSettings.hideUntilRestart;
          this.#update({ hideUntilRestart: next });
          if (next) this.#host.onHideUntilRestart?.();
        } else if ('showTally' === key) {
          this.#update({ showTally: !activeSettings.showTally });
        } else if ('autoOpenChat' === key) {
          this.#update({ autoOpenChat: !activeSettings.autoOpenChat });
        } else if ('showTimestamps' === key) {
          this.#update({ showTimestamps: !activeSettings.showTimestamps });
        } else if ('compactChat' === key) {
          this.#update({ compactChat: !activeSettings.compactChat });
        } else if ('reduceMotion' === key) {
          this.#update({ reduceMotion: !activeSettings.reduceMotion });
        }
      };
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        activateToggle();
      });
      toggle.addEventListener('keydown', (e) => {
        if (e instanceof KeyboardEvent && (' ' === e.key || 'Enter' === e.key)) {
          e.preventDefault();
          e.stopPropagation();
          activateToggle();
        }
      });
    }
    for (const check of root.querySelectorAll('[data-reticle-check]')) {
      const activate = (): void => {
        if (!(check instanceof HTMLElement)) return;
        const key = check.getAttribute('data-reticle-check');
        if ('clearOnCopy' === key) {
          this.#update({ clearOnCopy: !activeSettings.clearOnCopy });
        } else if ('blockPageInteractions' === key) {
          this.#update({ blockPageInteractions: !activeSettings.blockPageInteractions });
        }
      };
      const row = check.closest('[data-reticle-check-row]');
      row?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target instanceof HTMLElement && e.target.classList.contains('reticle-settings-help'))
          return;
        activate();
      });
      check.addEventListener('keydown', (e) => {
        if (e instanceof KeyboardEvent && (' ' === e.key || 'Enter' === e.key)) {
          e.preventDefault();
          activate();
        }
      });
    }
    root.querySelector('[data-reticle-settings-mcp]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(MCP_DOCS_URL, '_blank', 'noopener,noreferrer');
    });
    root.querySelector('[data-reticle-settings-reset]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const dock = root.querySelector(`[${DOCK_ATTR}]`);
      if (dock instanceof HTMLElement) resetHudDockPosition(dock);
    });
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    this.#buildSwatches();
    this.#syncUi();
    applyPresenterSettings(root, activeSettings);
    this.#host.onSettingsChange?.(activeSettings);
  }

  teardown(): void {
    this.#root = undefined;
    this.#panel = undefined;
    this.#btn = undefined;
  }

  isOpen(): boolean {
    return '1' === this.#root?.getAttribute(SETTINGS_ATTR);
  }

  open(): void {
    if (this.#root === undefined) return;
    this.#host.onBeforeOpen?.();
    this.#root.setAttribute(SETTINGS_ATTR, '1');
    this.#panel?.setAttribute('aria-hidden', 'false');
    this.#btn?.setAttribute('data-active', '1');
    this.#syncDockLayout();
  }

  close(): void {
    if (this.#root === undefined) return;
    this.#root.setAttribute(SETTINGS_ATTR, '0');
    this.#panel?.setAttribute('aria-hidden', 'true');
    this.#btn?.setAttribute('data-active', '0');
    this.#syncDockLayout();
  }

  #syncDockLayout(): void {
    if (this.#root === undefined) return;
    const dock = findDock(this.#root);
    if (dock !== undefined) scheduleSyncDockLayout(dock, this.#root);
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  #update(patch: Partial<PresenterSettings>): void {
    const next = patchSettings(patch);
    if (this.#root !== undefined) applyPresenterSettings(this.#root, next);
    this.#syncUi();
    this.#host.onSettingsChange?.(next);
  }

  #syncUi(): void {
    const s = activeSettings;
    const label = this.#panel?.querySelector('[data-reticle-cycle-label]');
    if (label !== null && label !== undefined) {
      label.textContent =
        OUTPUT_DETAIL_OPTIONS.find((o) => o.value === s.outputDetail)?.label ?? 'Standard';
    }
    const dots = this.#panel?.querySelector('[data-reticle-cycle-dots]');
    if (dots !== null && dots !== undefined) {
      dots.replaceChildren(
        ...OUTPUT_DETAIL_OPTIONS.map((o) => {
          const dot = document.createElement('span');
          dot.className = 'reticle-settings-dot';
          dot.setAttribute('data-on', o.value === s.outputDetail ? '1' : '0');
          return dot;
        }),
      );
    }
    this.#paintToggle('reactComponents', s.reactComponents);
    this.#paintToggle('hideUntilRestart', s.hideUntilRestart);
    this.#paintToggle('showTally', s.showTally);
    this.#paintToggle('autoOpenChat', s.autoOpenChat);
    this.#paintToggle('showTimestamps', s.showTimestamps);
    this.#paintToggle('compactChat', s.compactChat);
    this.#paintToggle('reduceMotion', s.reduceMotion);
    this.#paintCheck('clearOnCopy', s.clearOnCopy);
    this.#paintCheck('blockPageInteractions', s.blockPageInteractions);
    for (const swatch of this.#panel?.querySelectorAll('[data-reticle-accent-swatch]') ?? []) {
      if (swatch instanceof HTMLElement) {
        swatch.setAttribute(
          'data-on',
          swatch.getAttribute('data-accent') === s.accentColorId ? '1' : '0',
        );
      }
    }
  }

  #paintToggle(key: string, on: boolean): void {
    const el = this.#panel?.querySelector(`[${SETTING_KEY_ATTR}="${key}"]`);
    if (el instanceof HTMLElement) {
      el.setAttribute('data-on', on ? '1' : '0');
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  #paintCheck(key: string, on: boolean): void {
    const el = this.#panel?.querySelector(`[data-reticle-check="${key}"]`);
    if (el instanceof HTMLElement) {
      el.setAttribute('data-on', on ? '1' : '0');
      el.setAttribute('aria-checked', on ? 'true' : 'false');
      el.textContent = on ? '✓' : '';
    }
  }

  #buildSwatches(): void {
    const host = this.#panel?.querySelector('[data-reticle-settings-swatches]');
    if (null === host || undefined === host) return;
    host.replaceChildren(
      ...ACCENT_SWATCHES.map((s) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'reticle-settings-swatch';
        btn.setAttribute('data-reticle-accent-swatch', '');
        btn.setAttribute('data-accent', s.id);
        btn.style.background = s.color;
        btn.setAttribute('aria-label', `${s.id} accent`);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.#update({ accentColorId: s.id });
        });
        return btn;
      }),
    );
  }
}
