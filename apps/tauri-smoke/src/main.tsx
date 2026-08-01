import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { reticle, registerCapabilities, registerStore } from '@reticlehq/browser';
import { bridgeWsUrl } from '@reticlehq/core';
import { install } from '@reticlehq/react';
import { App } from './App.js';
import { useApp } from './store.js';

declare const __RETICLE_TOKEN__: string;
declare const __RETICLE_PORT__: number;

/**
 * Connect to the Reticle bridge.
 *
 * Nothing here is Tauri-specific. An `invoke` travels as a real fetch to Tauri's `ipc://` protocol,
 * so Reticle observes it with no extra wiring — every `invoke('load_todos')` is recorded as
 * `ipc://load_todos`. The one Tauri-specific step lives in src-tauri/tauri.conf.json, whose CSP must
 * allow the bridge WebSocket in `connect-src` — without it the webview blocks the connection before
 * it opens, silently.
 */
if (typeof window !== 'undefined') {
  setTimeout(() => {
    console.warn('GEOM ' + JSON.stringify({ screenX: window.screenX, screenY: window.screenY, innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight, dpr: window.devicePixelRatio }));
  }, 1500);
  install();
  reticle.connect({
    url: bridgeWsUrl(__RETICLE_PORT__),
    token: __RETICLE_TOKEN__,
    allowInProduction: true,
    overlay: true,
    // Presenter mode: the full HUD (glow border, cursor, narration, tally). 'overlay' alone renders
    // only the small 'Reticle ● N events' chip — which is why the HUD looked empty while the
    // counter kept climbing.
    present: true,
  });
  // The reliable layer: reticle_state reads this live, so an assertion never depends on the DOM.
  registerStore('app', useApp);
  registerCapabilities({
    testids: [
      'status',
      'route',
      'last-error',
      'draft',
      'add',
      'todo-list',
      'break',
      'go-settings',
      'go-home',
      'fetch-stats',
    ],
    signals: ['todos:loaded', 'todo:added'],
    stores: ['app'],
  });
}

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
