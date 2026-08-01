# Desktop apps: Electron & Tauri

Reticle verifies desktop apps the same way it verifies web apps — from **inside** the app, over a
localhost WebSocket. There is no browser to open and no screenshot to interpret.

- [How you actually test a desktop app](#how-you-actually-test-a-desktop-app)
- [Electron](#electron)
- [Tauri](#tauri)
- [What IPC looks like to an agent](#what-ipc-looks-like-to-an-agent)
- [Troubleshooting](#troubleshooting)

---

## How you actually test a desktop app

The usual question is *"it's a desktop app — what URL does the agent open?"* None. The direction is
reversed from what browser tooling trains you to expect:

```text
┌──────────────┐   MCP     ┌───────────────────┐   WebSocket    ┌───────────────────────┐
│ coding agent │◀────────▶│  reticle daemon    │◀──────────────▶│ your Electron/Tauri   │
│              │  stdio   │  (localhost:4400)  │   the app      │ window + the SDK      │
└──────────────┘          └───────────────────┘   dials OUT    └───────────────────────┘
```

Your app **connects to the daemon**, not the other way round. So the workflow is:

1. Start the daemon once: `npx @reticlehq/server serve`
2. Start your app exactly as you always do: `npm run dev`, `electron .`, `cargo tauri dev`.
3. That's it. `reticle status` now lists your window as a session, and the agent drives it.

`reticle open` has nothing to open for a desktop app and will say so. There is no headless mode and
no `reticle drive` for desktop — those launch a browser, which is not what you are testing.

## What works, measured

Every tool below was run against both demo apps against a live daemon. Electron passed 27/27; Tauri
passed 25/27.

| Capability | Electron | Tauri | Note |
| --- | --- | --- | --- |
| sessions, snapshot, query, inspect | ✅ | ✅ | `inspect` returns `src/App.tsx:104` on both |
| capabilities, state (live store) | ✅ | ✅ | `reticle_state` reads the real store |
| act (click/fill/type/select) | ✅ | ✅ | |
| act_and_wait, wait_for, assert | ✅ | ✅ | signal / state / route / net / console predicates |
| console errors | ✅ | ✅ | catches what the UI never shows |
| network — HTTP | ✅ | ✅ | on `file://` a relative URL has no origin; use an absolute one |
| network — IPC | ✅ | ✅ | `ipc://<channel>`, incl. failures |
| route | ✅ | ✅ | use a **hash** router — see below |
| storage, animations, observe, explore | ✅ | ✅ | |
| baseline (semantic), record → replay, crawl | ✅ | ✅ | `crawl` found real anomalies in both |
| navigate (reload) | ✅ | ✅ | |
| **screenshot / visual_diff** | ✅ | ❌ | Electron: one line in main — see below |
| network_mock, viewport | ❌ | ❌ | need a Reticle-driven browser |

### Screenshots

**Electron: one line in the main process.**

```js
const { installReticleCapture } = require('@reticlehq/browser/electron-main');
const win = new BrowserWindow({ ... });
installReticleCapture(win);
```

That is all — no CDP flag, no extra packages, works on a packaged `file://` renderer.
`reticle_screenshot` and `reticle_visual_diff` then work on your app.

Alternatively, since an Electron renderer *is* Chromium, `--remote-debugging-port=9222` +
`RETICLE_CDP_URL=http://127.0.0.1:9222` also works and additionally enables `fullPage` (the
main-process route captures the window as composited, so it cannot scroll-stitch).

**Why the main process, and not a screen capture.** `webContents.capturePage()` reads the window's
own backing store. Capturing a screen *region* instead was tried and deliberately rejected: it
photographs whatever is on top, so an app window behind your editor yields a picture of the editor —
saved as a visual baseline that a later diff would trust. A screenshot tool that can silently return
another window's pixels manufactures exactly the false green Reticle exists to eliminate. One caveat
remains: a fully occluded or minimized window is only partially composited, so parts of the capture
may come back blank. Bring the window forward for a complete image — but it is never the wrong window.

**Tauri: not available.** Its webview is WKWebView on macOS and WebKitGTK on Linux — neither speaks
CDP — and Tauri's core exposes no capture API, so there is nothing for Reticle to call. Verified, not
assumed: the process opens no debug port and `tauri` exports no capture function. Three escapes exist,
all outside Reticle: on **Windows** Tauri uses WebView2, which is Chromium and supports
`--remote-debugging-port`, so the CDP recipe should apply; the community
[`tauri-plugin-playwright`](https://crates.io/crates/tauri-plugin-playwright) adds a Rust plugin that
captures the OS window via CoreGraphics; and an app can expose its own capture command. Plain
Playwright cannot drive a WKWebView at all.

If you add a native capture to a Tauri app, expose it as `window.__reticleIpc.capture()` returning a
base64 PNG and Reticle will use it — that is the same contract the Electron helper fulfils.

### Headless

**Electron: yes.** `show: false` plus `backgroundThrottling: false` in `webPreferences`. The second
one is load-bearing — Chromium runs an unshown window's timers in slow motion, which turns every
settle wait into a flake. Screenshots still work, because `capturePage` reads the backing store
rather than the screen. Verified with a full tool drive against a window that was never shown.

**Tauri: use a virtual display, not a hidden window.** `xvfb-run -a pnpm tauri dev` on Linux. Hiding
or moving the window off screen does NOT work and is worth stating precisely, because it fails
silently: macOS marks such a window occluded, WKWebView stops executing JavaScript, and every command
times out — the app is not headless, it is asleep. There is no `backgroundThrottling` equivalent.
Three variants were tried (hide, full-offscreen, 1px sliver) and all three suspend. On macOS, run
headful.

### How it compares to Playwright MCP

Both attached to the same running Electron app, same task ("archive a todo, then verify it worked"):

| tool | ~tokens | ms | verdict |
| --- | --- | --- | --- |
| reticle (lean) | **277** | 1368 | caught the failure |
| playwright-mcp | 992 | **968** | blind to it — no network/IPC in its output |
| playwright-mcp → Tauri | — | — | cannot attach (no CDP in WKWebView) |

Playwright MCP is faster. It is also structurally unable to see an IPC failure, because its channel
is the accessibility tree. Full method, numbers and caveats: [`bench/desktop`](../bench/desktop).

### Routing: use a hash router

A packaged renderer runs on `file://`, where `pushState('/settings')` rewrites the URL to
`file:///settings` — a path that does not exist, so the next reload lands on a blank page and the app
is gone. This is why HashRouter is the standard choice for packaged Electron/Tauri apps. Reticle's
route observer handles both, and a `{ kind: 'route', contains: … }` assertion matches the fragment.

## Electron

Two steps. The first is the ordinary web setup; the second is the only desktop-specific part.

**1. The renderer** — the same as any Vite/webpack app:

```ts
// src/main.tsx
import { reticle } from '@reticlehq/browser';

if (import.meta.env.DEV) reticle.connect();
```

**2. The preload** — one line, before you expose anything:

```js
// electron/preload.cjs
require('@reticlehq/browser/electron-preload');

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  loadTodos: () => ipcRenderer.invoke('todos:load'),
});
```

That line is what makes your main-process calls visible. It has to live in the preload, and it is
not a stylistic choice: `contextBridge.exposeInMainWorld` hands the renderer a **deeply frozen,
non-configurable** object, so nothing running in the page can instrument `window.api`. The preload is
the last point where `ipcRenderer.invoke` is still an ordinary, writable function. Patching there
covers every channel you go on to expose, whatever you named it.

**Preload sandboxing.** A sandboxed preload can't resolve `node_modules`, so the bare `require` above
fails. Either bundle your preload (electron-vite and Electron Forge do this by default — the require
is inlined at build time and sandboxing stays on), or set `sandbox: false` in `webPreferences`.

**Packaged renderers.** An app that loads its renderer with `loadFile` runs on `file://`, which is a
production Vite build. Pass `allowInProduction: true` to `connect()` for that mode, or keep the SDK
gated behind `import.meta.env.DEV` so it never enters the shipped binary at all.

Working example: [`apps/electron-smoke`](../apps/electron-smoke).

## Tauri

Frontend side, nothing desktop-specific:

```ts
// src/main.tsx
import { reticle } from '@reticlehq/browser';

if (import.meta.env.DEV) reticle.connect();
```

Nothing else is needed for IPC. A Tauri `invoke` travels as a real `fetch` to Tauri's `ipc://` custom
protocol, so Reticle already sees it; every `invoke('load_todos')` shows up as `ipc://load_todos`.
Reticle also reads Tauri's `Tauri-Response` header, because the transport answers **HTTP 200 whether
the Rust command returned `Ok` or `Err`** — without that translation a failed command would be
recorded as a successful request.

The one required step is **CSP**. Tauri ships a restrictive default that blocks the bridge WebSocket
before it opens, and the failure is silent from the app's side. In `src-tauri/tauri.conf.json`:

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self' ipc: http://ipc.localhost; connect-src 'self' ipc: http://ipc.localhost ws://localhost:4400 ws://127.0.0.1:4400"
    }
  }
}
```

Keep `ipc: http://ipc.localhost` in `connect-src` — Tauri v2 needs it for `invoke` itself. Add your
dev-server origin too if you use `devUrl`. This is a dev-only config; drop the `ws://` entries from
your release config.

Working example: [`apps/tauri-smoke`](../apps/tauri-smoke).

## What IPC looks like to an agent

A desktop app reaches its backend over IPC, not HTTP. `fetch`/`XHR` patching cannot see that, so
without the IPC observer every backend call in your app is a blind spot — `reticle_network` returns
nothing, `act_and_wait` has no in-flight request to settle on, and `assert { net }` is vacuously
true. That is a false green by construction.

Reticle records each IPC call as an ordinary request, so the tools you already use work unchanged:

```jsonc
// reticle_network { urlContains: "ipc://" }
{"calls":[
  {"method":"ipc","url":"ipc://todos:load","status":200,"ms":134},
  {"method":"ipc","url":"ipc://todos:archive","status":500,"ms":83}
]}
```

IPC has no status code; `200`/`500` are synthetic, mapped from whether the call succeeded or failed,
precisely so that `reticle_network { status: 500 }` and `assert { kind: "net", status: 500 }` keep
working. On Tauri you will see `status: 500` next to `statusText: "OK"` — that is not a bug: the
transport really did answer 200, and the 500 is the command's own verdict. `ok` is authoritative,
and on Electron `error` carries the message your main process returned:

```jsonc
// reticle_assert { predicate: { kind: "net", urlContains: "ipc://todos:archive", status: 500 } }
{"pass":true,"evidence":{
  "url":"ipc://todos:archive","ok":false,"status":500,
  "error":"archive is not implemented in the backend"
}}
```

Both example apps ship a planted false green — an Archive button that updates the UI optimistically
and swallows the rejection. The screen says "archived", a screenshot agrees, a DOM assertion agrees.
Only the IPC record disagrees. That is the case desktop support exists for.

## Troubleshooting

**`reticle status` shows no session.**
Check the app's console (Electron: devtools, or forward `console-message` to your terminal — a
desktop renderer has no visible console otherwise). A refused connect always logs why.

**Tauri: nothing connects and the app console shows a CSP violation.**
The `connect-src` above is missing or does not include your daemon's port.

**Electron: `module not found: @reticlehq/browser/electron-preload`.**
The preload is sandboxed. Bundle it, or set `sandbox: false` — see [Electron](#electron).

**IPC calls do not appear, but the app works.**
Electron: the shim's `require` must run *before* your preload captures its own reference to
`ipcRenderer`. Put it on the first line. Tauri: `invoke` imported from `@tauri-apps/api/core` is
observed; a hand-rolled `postMessage` protocol is not, and neither is Tauri's `postMessage` transport
fallback on platforms where the `ipc://` custom protocol is unavailable.

**Why not just patch `invoke` / `window.api` directly?**
Because neither can be. Tauri defines `__TAURI_INTERNALS__.invoke` as `writable: false,
configurable: false`, and Electron's `contextBridge` object is deeply frozen and installed
non-configurably. Both were verified, not assumed — which is why the two runtimes use the two
different mechanisms above rather than one uniform monkey-patch.
