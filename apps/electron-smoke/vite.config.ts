import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { reticle, readPairingToken } from '@reticlehq/vite-plugin';

/**
 * Renderer build.
 *
 * `base: './'` matters: the packaged mode loads index.html over file://, where an absolute
 * /assets/... path resolves against the filesystem root and every script 404s.
 *
 * The Reticle plugin runs with `inject: false` — it still stamps data-reticle-source so the agent can
 * map a DOM node to a file:line, but this app calls `reticle.connect()` itself (see src/main.tsx)
 * because it needs to pass `ipcBridges`, and because the plugin's auto-inject is dev-server-only
 * while the packaged mode has no dev server. The pairing token is read Node-side here and baked in,
 * exactly as the plugin would have done.
 */
export default defineConfig({
  base: './',
  plugins: [react(), reticle({ inject: false })],
  server: { port: 5174, strictPort: true },
  build: { outDir: 'dist' },
  define: {
    __RETICLE_TOKEN__: JSON.stringify(readPairingToken() ?? ''),
    // Defaults to the SDK's port; RETICLE_PORT points the demo at a daemon you started yourself.
    __RETICLE_PORT__: Number(process.env['RETICLE_PORT'] ?? 4400),
  },
});
