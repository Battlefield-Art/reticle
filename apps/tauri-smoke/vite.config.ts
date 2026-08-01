import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { reticle, readPairingToken } from '@reticlehq/vite-plugin';

/**
 * Tauri frontend build. `inject: false` keeps the plugin's source stamping (DOM node → file:line)
 * while this app calls `reticle.connect()` itself — Tauri's `invoke` is auto-detected, but the
 * connect has to survive a `frontendDist` build too, where the plugin's serve-only inject is absent.
 */
export default defineConfig({
  plugins: [react(), reticle({ inject: false })],
  // Tauri expects a fixed port it can point the webview at, and a hard failure if it is taken.
  server: { port: 5175, strictPort: true },
  define: {
    __RETICLE_TOKEN__: JSON.stringify(readPairingToken() ?? ''),
    // Defaults to the SDK's port; RETICLE_PORT points the demo at a daemon you started yourself.
    __RETICLE_PORT__: Number(process.env['RETICLE_PORT'] ?? 4400),
  },
});
