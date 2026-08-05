//! The capture command, in its own module because `#[tauri::command]` re-exports a macro beside the
//! function — at the crate root that collides with the function's own re-export.
//!
//! Each platform reaches its webview through a different API, but all three share the property that
//! matters: they render the WEBVIEW, never the screen. Capturing a screen region instead was tried
//! and rejected — it photographs the glass, so a window sitting behind the editor yields a picture of
//! the editor, banked as a visual baseline a later diff would trust. None of these can do that, none
//! needs a screen-recording permission, and all three are correct with nothing on screen at all.

use crate::CAPTURE_FILE_PREFIX;

#[cfg(target_os = "macos")]
#[path = "capture/macos.rs"]
mod platform;

#[cfg(windows)]
#[path = "capture/windows.rs"]
mod platform;

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd"
))]
#[path = "capture/linux.rs"]
mod platform;

/// Capture the webview and return the path of the PNG written to the OS temp directory.
///
/// A path rather than the bytes: the SDK's transport caps every string at 64KB, so a base64 image
/// came back SILENTLY TRUNCATED and was banked as a "successful" screenshot no decoder could read.
/// The daemon and the app always share a machine, so a path keeps the image off the event wire.
///
/// The whole body runs on a BLOCKING thread. `snapshot_png` waits on a channel the webview answers
/// on (up to `SNAPSHOT_TIMEOUT`), and doing that directly in an `async fn` parks one of Tauri's async
/// worker threads for as long as the webview takes — so a wedged webview degrades every other
/// command in the app, not just this one.
#[tauri::command]
pub async fn reticle_capture(
    window: tauri::WebviewWindow,
    full_page: Option<bool>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || capture_to_temp_file(&window, full_page))
        .await
        .map_err(|error| error.to_string())?
}

fn capture_to_temp_file(
    window: &tauri::WebviewWindow,
    full_page: Option<bool>,
) -> Result<String, String> {
    let png = snapshot_png(window, full_page == Some(true))?;
    let dir = std::env::temp_dir();
    let path = dir.join(format!("{}{}.png", capture_prefix(), nanos()));
    std::fs::write(&path, png).map_err(|error| error.to_string())?;
    sweep_stale_captures(&dir, &path);
    Ok(path.to_string_lossy().into_owned())
}

/// This process's own capture filenames, so a sweep can never touch another app's pending capture.
///
/// The pid is in the name for the same reason Electron's helper puts it there: two instrumented
/// desktop apps can be running at once, and "delete everything with Reticle's prefix" would have one
/// of them unlink the other's screenshot out from under the daemon.
fn capture_prefix() -> String {
    format!("{CAPTURE_FILE_PREFIX}{}-", std::process::id())
}

/// How long a capture may sit in the temp dir before this process treats it as abandoned.
const STALE_CAPTURE_SECS: u64 = 60;

/// Delete this process's ABANDONED captures.
///
/// The daemon unlinks a capture once it has read it — but only if it ever reads. A session that
/// died, a command that timed out, or a path the daemon rejected each leave a ~500KB PNG in the temp
/// directory forever, and nothing else ever collects them. Sweeping on the next capture needs no
/// timer and no shutdown hook.
///
/// Age-gated, not "delete every sibling": two captures in flight and an unconditional sweep would
/// unlink the older one before the daemon had read it, turning a working screenshot into a
/// no-provider error. Best-effort throughout — a failed sweep must never fail a capture.
fn sweep_stale_captures(dir: &std::path::Path, keep: &std::path::Path) {
    let prefix = capture_prefix();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return; // the temp dir is unreadable; the capture itself already succeeded
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == keep
            || !path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with(&prefix))
        {
            continue;
        }
        // A clock that went backwards yields Err here; that reads as "not old enough", which errs
        // toward keeping a file rather than deleting one a capture in flight may still need.
        let abandoned = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .is_ok_and(|modified| {
                modified
                    .elapsed()
                    .is_ok_and(|age| age.as_secs() >= STALE_CAPTURE_SECS)
            });
        if abandoned {
            let _ = std::fs::remove_file(&path);
        }
    }
}

fn nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since_epoch| since_epoch.as_nanos())
        .unwrap_or(0)
}

#[cfg(any(
    target_os = "macos",
    windows,
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd"
))]
use platform::snapshot_png;

/// Anywhere with no webview API to call — say so, rather than return a plausible wrong image.
///
/// Reporting no-provider makes the tool answer "no screenshots here", which is a result an agent can
/// act on. A picture of the wrong thing is not.
#[cfg(not(any(
    target_os = "macos",
    windows,
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd"
)))]
fn snapshot_png(_window: &tauri::WebviewWindow, _full_page: bool) -> Result<Vec<u8>, String> {
    Err("reticle-tauri cannot capture a webview on this platform".into())
}
