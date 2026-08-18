import { describe, it, expect, afterEach } from 'vitest';
import { RETICLE_ROOT_GLOBAL } from '@reticlehq/core';
import {
  mountWorkspaceSelector,
  paintWorkspace,
  workspaceFolderLabel,
  workspaceRowHtml,
} from './presenter-workspace.js';

afterEach(() => {
  Reflect.deleteProperty(globalThis, RETICLE_ROOT_GLOBAL);
  document.body.innerHTML = '';
});

describe('presenter workspace selector', () => {
  it('renders a workspace chip above the composer', () => {
    expect(workspaceRowHtml()).toContain('data-reticle-workspace-btn');
    expect(workspaceRowHtml()).toContain('reticle-workspace-name');
  });

  it('labels the folder from the injected repo root', () => {
    (globalThis as Record<string, unknown>)[RETICLE_ROOT_GLOBAL] = 'C:/apps/linkit_v5';
    expect(workspaceFolderLabel('C:/apps/linkit_v5')).toBe('linkit_v5');
    document.body.innerHTML = `<div data-reticle-overlay>${workspaceRowHtml()}</div>`;
    paintWorkspace(document.body);
    expect(document.querySelector('[data-reticle-workspace-name]')?.textContent).toBe('linkit_v5');
  });

  it('opens and closes the workspace detail menu', () => {
    document.body.innerHTML = `<div data-reticle-overlay>${workspaceRowHtml()}</div>`;
    const teardown = mountWorkspaceSelector(document.body);
    const btn = document.querySelector('[data-reticle-workspace-btn]') as HTMLElement;
    btn.click();
    expect(
      document.querySelector('[data-reticle-workspace-menu]')?.getAttribute('aria-hidden'),
    ).toBe('false');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(
      document.querySelector('[data-reticle-workspace-menu]')?.getAttribute('aria-hidden'),
    ).toBe('true');
    teardown();
  });
});
