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
   * The case this exists for: a Tauri window hidden BEFORE its webview was first presented never
   * loads its page, so every command times out with nothing saying why. Eight seconds of silence
   * followed by "timed out" sends someone hunting through their own app code for a bug that is not
   * there.
   */
  it('explains the hidden-before-load trap for a Tauri session that has gone quiet', () => {
    const message = commandTimeoutMessage('snapshot', 8000, {
      url: TAURI,
      hidden: true,
      runtime: 'tauri',
    });
    expect(message).toContain('WKWebView');
    expect(message).toMatch(/on_page_load/);
    // It must still carry the original fact — the advice is added, never substituted.
    expect(message).toContain("command 'snapshot' timed out after 8000ms");
  });

  /**
   * The advice used to blame occlusion, which is measurably false: a LOADED Tauri webview answers
   * while minimized, app-hidden, occluded and on another Space. Telling someone to go move a window
   * costs them the hour this message exists to save, so the wrong cause must not come back.
   */
  it('does not blame occlusion or Spaces, which do not suspend a loaded webview', () => {
    const message = commandTimeoutMessage('snapshot', 8000, {
      url: TAURI,
      hidden: true,
      runtime: 'tauri',
    });
    expect(message).not.toMatch(/Space|occlud|suspend/i);
  });

  /**
   * Electron shows its window before hiding it, so it never hits this. Diagnosing it there would
   * send the user to change code that was never the problem.
   */
  it('does not offer the Tauri diagnosis on Electron', () => {
    const message = commandTimeoutMessage('snapshot', 8000, {
      url: ELECTRON,
      hidden: true,
      runtime: 'electron',
    });
    expect(message).not.toContain('WKWebView');
  });

  it('says nothing when the page reports itself visible', () => {
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
