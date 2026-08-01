# reticle-tauri

Screenshots and headless mode for a Tauri app running under [Reticle](https://reticle.dev).

Everything else Reticle does on Tauri — snapshot, act, assert, state, IPC, console, network — needs
nothing from this crate. The SDK connects to the daemon from inside the webview on its own. This
crate exists for the two things only the Rust side can do.

## Use

```toml
[dependencies]
reticle-tauri = "0.1"
```

```rust
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![reticle_tauri::reticle_capture])
    .on_page_load(reticle_tauri::on_page_load)
```

Nothing on the JavaScript side. Tauri has no preload stage where a shim could be installed, so the
SDK invokes `reticle_capture` through Tauri's own internals when it needs pixels.

### Screenshots

`reticle_capture` calls `WKWebView.takeSnapshot` and writes a PNG to the OS temp directory, returning
its path. `reticle_screenshot` and `reticle_visual_diff` work from there.

It renders the webview, not the screen. Capturing a screen region instead would photograph whatever
is on top — an app window behind your editor yields a picture of the editor, banked as a visual
baseline a later diff would trust. This path cannot do that, needs no screen-recording permission,
and is correct with nothing on screen at all.

macOS only for now. Windows (WebView2 `CapturePreview`) and Linux (WebKitGTK `WebViewSnapshot`) have
equivalents that are not implemented yet; there, capture reports no-provider rather than guessing.

### Headless

`on_page_load` hides the window when `RETICLE_HEADLESS=1`:

```sh
RETICLE_HEADLESS=1 cargo tauri dev
```

The ordering matters and is the whole reason this is a function rather than a config flag. Hiding the
window during `setup` hides it *before* the webview has been presented, and a webview that has never
been presented never loads its page — so the app answers nothing and looks suspended. Hiding it after
the first page load leaves everything running: a loaded webview keeps executing JavaScript while
minimized, app-hidden, occluded, or on another macOS Space.

`xvfb-run -a cargo tauri dev` also works on Linux and needs no app-side change.
