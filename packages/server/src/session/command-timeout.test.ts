import { describe, expect, it } from 'vitest';
import { commandTimeoutMessage } from './command-timeout.js';

const TAURI = 'http://localhost:5175/';
const ELECTRON = 'file:///Users/me/app/dist/index.html';
const WEB = 'http://localhost:3000/dashboard';

describe('commandTimeoutMessage — an 8s timeout should say what to DO', () => {
  it('keeps the bare fact for an ordinary web page', () => {
    const message = commandTimeoutMessage('snapshot', 8000, {
      url: WEB,
      hidden: false,
      runtime: 'web',
    });
    expect(message).toContain("command 'snapshot' timed out after 8000ms");
    // No desktop advice on a web page — a wrong explanation is worse than none.
    expect(message).not.toMatch(/Space|WKWebView/);
  });

  /**
   * The case this exists for. macOS suspends a WKWebView whose window is occluded or on another
   * Space: the session stays connected and every command times out with nothing saying why. Eight
   * seconds of silence followed by "timed out" sends someone hunting through their own app code for
   * a bug that is not there.
   */
  it('explains the macOS suspension for a Tauri session that has gone quiet', () => {
    const message = commandTimeoutMessage('snapshot', 8000, {
      url: TAURI,
      hidden: true,
      runtime: 'tauri',
    });
    expect(message).toContain('WKWebView');
    expect(message).toMatch(/Space|visible/);
    // It must still carry the original fact — the advice is added, never substituted.
    expect(message).toContain("command 'snapshot' timed out after 8000ms");
  });

  /**
   * Electron has `backgroundThrottling: false`, so an occluded Electron window keeps running. Blaming
   * occlusion there would send the user to move a window that was never the problem.
   */
  it('does not blame occlusion on Electron, which is immune to it', () => {
    const message = commandTimeoutMessage('snapshot', 8000, {
      url: ELECTRON,
      hidden: true,
      runtime: 'electron',
    });
    expect(message).not.toContain('WKWebView');
  });

  it('says nothing about suspension when the page reports itself visible', () => {
    const message = commandTimeoutMessage('snapshot', 8000, {
      url: TAURI,
      hidden: false,
      runtime: 'tauri',
    });
    expect(message).not.toContain('WKWebView');
  });

  /**
   * A Tauri dev server and a plain web app both live on http://localhost — the URL cannot tell them
   * apart, so a hidden localhost page must NOT be diagnosed as Tauri. The runtime is only knowable
   * when the app said so.
   */
  it('does not guess Tauri from a localhost URL alone', () => {
    const message = commandTimeoutMessage('snapshot', 8000, {
      url: 'http://localhost:3000/',
      hidden: true,
      runtime: 'web',
    });
    expect(message).not.toContain('WKWebView');
  });

  it('diagnoses a tauri:// origin without needing any hint', () => {
    const message = commandTimeoutMessage('snapshot', 8000, {
      url: 'tauri://localhost/',
      hidden: true,
    });
    expect(message).toContain('WKWebView');
  });
});
