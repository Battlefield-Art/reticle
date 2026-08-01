import { EventType, HealthReason, SESSION_HEALTH } from '@reticlehq/core';
import { nativeSetInterval } from '../timers/native-timers.js';
import type { Emit, Teardown } from './types.js';

/**
 * Which shell this page runs in. Reported with health because it is what makes a timeout
 * diagnosable: an occluded WKWebView is SUSPENDED by macOS, so the session stays connected while
 * every command times out — and a URL cannot tell a Tauri dev server from a plain localhost app, so
 * the runtime has to come from the page itself.
 */
function detectRuntime(): 'electron' | 'tauri' | 'web' {
  const w = window as unknown as Record<string, unknown>;
  if (w['__TAURI_INTERNALS__'] !== undefined || w['__TAURI__'] !== undefined) return 'tauri';
  if (navigator.userAgent.includes('Electron') || w['__reticleIpc'] !== undefined)
    return 'electron';
  return 'web';
}

function snapshotHealth(): { hidden: boolean; focused: boolean; runtime: string } {
  return {
    hidden: document.visibilityState === 'hidden',
    focused: document.hasFocus(),
    runtime: detectRuntime(),
  };
}

/**
 * Report page visibility/focus immediately on change + a lightweight native heartbeat.
 * Lets the bridge know whether the tab is foregrounded so the agent never drives a throttled
 * tab blind. Uses a native (pre-bound) timer so a frozen app clock (reticle_clock) never stalls it.
 */
export function installHealth(emit: Emit): Teardown {
  const report = (reason: HealthReason): void => {
    emit(EventType.PAGE_HEALTH, { ...snapshotHealth(), reason });
  };

  const onVisibility = (): void => report(HealthReason.VISIBILITY);
  const onFocus = (): void => report(HealthReason.FOCUS);
  const onBlur = (): void => report(HealthReason.BLUR);

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);

  report(HealthReason.INITIAL); // baseline so the server knows state before the first change
  const stopHeartbeat = nativeSetInterval(
    () => report(HealthReason.HEARTBEAT),
    SESSION_HEALTH.HEARTBEAT_MS,
  );

  return () => {
    stopHeartbeat();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
  };
}
