import { isOpaqueOrigin } from '@reticlehq/core';

/**
 * Turn a bare command timeout into something the reader can act on.
 *
 * The default message — `command 'snapshot' timed out after 8000ms` — is eight seconds of silence
 * followed by a fact with no cause. For a Tauri app the cause is usually not a bug in the app: its
 * window was hidden before the webview had ever been PRESENTED, and a webview that has never been
 * presented never loads its page. The session stays connected, so nothing looks wrong, and the
 * developer goes hunting through their own code for a fault that is not there.
 *
 * This advice previously blamed occlusion — "macOS suspends an occluded or off-Space WKWebView" —
 * which is false, and was the kind of wrong steer this function exists to prevent. A LOADED Tauri
 * webview keeps answering while minimized, app-hidden, occluded, and on another Space. Only the
 * ordering matters, so that is what the message now says.
 *
 * The advice is ADDED, never substituted — the original fact still leads — and only for a runtime
 * that can actually suffer it, since misdirecting an Electron user costs them the same hour.
 */

/** What the page told us about its shell, via PAGE_HEALTH. Undefined before the first report. */
export type PageRuntime = 'electron' | 'tauri' | 'web';

export interface TimeoutContext {
  url: string;
  /** The page's own last visibility report. */
  hidden: boolean;
  /** Reported by the SDK. A URL cannot distinguish a Tauri dev server from a plain localhost app. */
  runtime?: PageRuntime;
}

const HIDDEN_BEFORE_LOAD_ADVICE =
  'The page last reported itself hidden, and this is a WKWebView (Tauri) window. A webview hidden ' +
  'BEFORE its first page load never presents, so it never runs the page and answers nothing. Hide ' +
  'the window from `on_page_load` rather than from `setup` — see `reticle_tauri::on_page_load`, ' +
  'which does exactly that for RETICLE_HEADLESS=1. Once the page HAS loaded, hiding it is safe.';

/** True when this session is a WebKit desktop shell — the only runtime that suffers this. */
function isWebKitDesktop(context: TimeoutContext): boolean {
  if (context.runtime === 'tauri') return true;
  // A `tauri://` origin is unambiguous even before the first health report lands.
  if (context.runtime !== undefined) return false;
  return isOpaqueOrigin(context.url) && context.url.startsWith('tauri:');
}

export function commandTimeoutMessage(
  name: string,
  timeoutMs: number,
  context: TimeoutContext,
): string {
  const base = `command '${name}' timed out after ${String(timeoutMs)}ms`;
  if (!context.hidden || !isWebKitDesktop(context)) return base;
  return `${base}. ${HIDDEN_BEFORE_LOAD_ADVICE}`;
}
