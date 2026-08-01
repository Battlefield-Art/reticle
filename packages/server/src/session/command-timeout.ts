import { isOpaqueOrigin } from '@reticlehq/core';

/**
 * Turn a bare command timeout into something the reader can act on.
 *
 * The default message — `command 'snapshot' timed out after 8000ms` — is eight seconds of silence
 * followed by a fact with no cause. On macOS the most likely cause for a Tauri app is not a bug in
 * the app at all: an occluded window, or one on another Space, has its WKWebView SUSPENDED by the
 * OS. The session stays connected, so nothing looks wrong, and the developer goes hunting through
 * their own code for a fault that is not there.
 *
 * The advice is ADDED, never substituted — the original fact still leads. And it is only offered
 * when the page itself reported a runtime that can suffer it: Electron sets
 * `backgroundThrottling: false` and is immune, and blaming occlusion there would send someone to
 * move a window that was never the problem.
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

const SUSPENSION_ADVICE =
  'The page last reported itself hidden, and this is a WebKit (Tauri) window: macOS SUSPENDS a ' +
  'WKWebView whose window is occluded or on another Space, so the session stays connected while ' +
  'every command times out. Bring the window onto the Space you are looking at. There is no ' +
  'backgroundThrottling equivalent to disable this; on Linux CI use `xvfb-run` so the window is ' +
  'always visible.';

/** True when this session is a WebKit desktop shell — the only runtime that suffers the suspension. */
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
  return `${base}. ${SUSPENSION_ADVICE}`;
}
