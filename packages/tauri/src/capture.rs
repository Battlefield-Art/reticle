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
#[tauri::command]
pub async fn reticle_capture(
    window: tauri::WebviewWindow,
    full_page: Option<bool>,
) -> Result<String, String> {
    let png = snapshot_png(&window, full_page == Some(true))?;
    let path = std::env::temp_dir().join(format!("{CAPTURE_FILE_PREFIX}{}.png", nanos()));
    std::fs::write(&path, png).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
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
