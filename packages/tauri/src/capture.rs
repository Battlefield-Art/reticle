//! The capture command, in its own module because `#[tauri::command]` re-exports a macro beside the
//! function — at the crate root that collides with the function's own re-export.

use crate::{CAPTURE_FILE_PREFIX, SNAPSHOT_TIMEOUT};

/// Capture the webview and return the path of the PNG written to the OS temp directory.
///
/// A path rather than the bytes: the SDK's transport caps every string at 64KB, so a base64 image
/// came back SILENTLY TRUNCATED and was banked as a "successful" screenshot no decoder could read.
/// The daemon and the app always share a machine, so a path keeps the image off the event wire.
#[tauri::command]
pub async fn reticle_capture(window: tauri::WebviewWindow) -> Result<String, String> {
    let png = snapshot_png(&window)?;
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

/// macOS: `WKWebView.takeSnapshot`, which renders the webview's own contents.
///
/// Capturing a screen *region* instead was tried and rejected: it photographs the glass, so a window
/// sitting behind the editor yields a picture of the editor, banked as a visual baseline a later
/// diff would trust. This path cannot do that — it never reads the screen, needs no screen-recording
/// permission, and is correct with nothing on screen at all.
#[cfg(target_os = "macos")]
fn snapshot_png(window: &tauri::WebviewWindow) -> Result<Vec<u8>, String> {
    use block2::RcBlock;
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSError;
    use objc2_web_kit::WKWebView;

    let (sender, receiver) = std::sync::mpsc::channel::<Result<Vec<u8>, String>>();
    window
        .with_webview(move |webview| {
            // SAFETY: on macOS `inner()` is the `WKWebView` backing this window, and the closure runs
            // on the main thread, which is where WebKit requires its objects to be touched.
            let wk: &WKWebView = unsafe { &*(webview.inner() as *const WKWebView) };
            let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let _ = sender.send(encode_png(image, error));
            });
            unsafe { wk.takeSnapshotWithConfiguration_completionHandler(None, &handler) };
        })
        .map_err(|error| error.to_string())?;

    receiver
        .recv_timeout(SNAPSHOT_TIMEOUT)
        .map_err(|_| "webview snapshot timed out".to_string())?
}

#[cfg(target_os = "macos")]
fn encode_png(
    image: *mut objc2_app_kit::NSImage,
    error: *mut objc2_foundation::NSError,
) -> Result<Vec<u8>, String> {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::NSDictionary;

    if !error.is_null() {
        // SAFETY: WebKit hands back a live NSError here; it is only read.
        return Err(unsafe { &*error }.localizedDescription().to_string());
    }
    if image.is_null() {
        return Err("webview returned no snapshot".into());
    }
    // SAFETY: non-null, and owned by the completion handler for the duration of this call.
    let image = unsafe { &*image };
    let tiff = image.TIFFRepresentation().ok_or("snapshot had no bitmap")?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("snapshot bitmap was unreadable")?;
    let png = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }
    .ok_or("snapshot could not be encoded as PNG")?;
    Ok(png.to_vec())
}

/// Everywhere else: say so, rather than return a picture of whatever is in front of the window.
///
/// Windows (WebView2 `CapturePreview`) and Linux (WebKitGTK `WebViewSnapshot`) both have an
/// equivalent API; neither is implemented yet. Reporting no-provider makes the tool answer
/// "no screenshots here", which is a result an agent can act on — unlike a plausible wrong image.
#[cfg(not(target_os = "macos"))]
fn snapshot_png(_window: &tauri::WebviewWindow) -> Result<Vec<u8>, String> {
    Err("reticle-tauri can only capture a webview on macOS so far".into())
}
