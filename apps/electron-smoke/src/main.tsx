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
 * Nothing here is desktop-specific. The one Electron-specific step lives in electron/preload.cjs,
 * which requires `@reticlehq/browser/electron-preload` — that is what makes every
 * `ipcRenderer.invoke` visible here as `ipc://<channel>`. Without it the app's entire backend is a
 * blind spot: fetch/XHR patching cannot see IPC.
 *
 * `allowInProduction` is needed only for the packaged (`dev:packaged`) mode, where the renderer is a
 * production Vite build. A real shipping app should gate this whole import behind `import.meta.env.DEV`
 * so it is tree-shaken out of the binary entirely.
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
