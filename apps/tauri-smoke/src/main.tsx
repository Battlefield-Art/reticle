import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { reticle } from '@reticlehq/browser';
import { bridgeWsUrl } from '@reticlehq/core';
import { install } from '@reticlehq/react';
import { App } from './App.js';

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
  install();
  reticle.connect({
    url: bridgeWsUrl(__RETICLE_PORT__),
    token: __RETICLE_TOKEN__,
    allowInProduction: true,
    overlay: true,
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
