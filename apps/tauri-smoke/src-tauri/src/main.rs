// The Rust "backend". The webview can only reach it through `invoke` — never over HTTP — which is
// exactly why Reticle's fetch/XHR patching sees nothing here and the IPC observer is required.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Clone, Serialize, Deserialize)]
struct Todo {
    id: u32,
    title: String,
    done: bool,
}

struct Store {
    todos: Mutex<Vec<Todo>>,
    next_id: Mutex<u32>,
}

#[tauri::command]
fn load_todos(store: State<Store>) -> Vec<Todo> {
    store.todos.lock().expect("todo lock").clone()
}

#[tauri::command]
fn add_todo(title: String, store: State<Store>) -> Result<Todo, String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("title is required".into());
    }
    let mut next_id = store.next_id.lock().expect("id lock");
    let todo = Todo { id: *next_id, title: trimmed.to_string(), done: false };
    *next_id += 1;
    store.todos.lock().expect("todo lock").push(todo.clone());
    Ok(todo)
}

/// Always fails. The frontend calls this from a button that updates the UI first and swallows the
/// rejection — the false green Reticle exists to catch. The screen says "archived"; the IPC record
/// says `ipc://archive_todo ok:false`.
#[tauri::command]
fn archive_todo(_id: u32) -> Result<(), String> {
    Err("archive is not implemented in the backend".into())
}

/// Headless mode for a Tauri app — which, on macOS, does not exist from the app side.
///
/// Three app-side approaches were built and measured against the live app, and ALL of them suspend
/// the webview: `window.hide()`, parking the window fully off screen, and leaving a one-pixel sliver
/// on screen. In every case macOS marks the window occluded, WKWebView stops executing JS, and every
/// Reticle command times out at 8s — the app is not headless, it is asleep. There is no
/// `backgroundThrottling` escape hatch of the kind Chromium gives Electron.
///
/// The honest answer is a VIRTUAL DISPLAY, not a hidden window:
///   Linux CI  →  `xvfb-run -a pnpm tauri dev` — the window is genuinely visible, on a display that
///                does not physically exist. Everything works and nothing reaches a screen.
///   macOS     →  no headless. Run headful; the window must live on a real display to stay awake.
///
/// So this only announces the situation. Nothing is repositioned or hidden, because that would
/// produce an app that looks headless and answers nothing — a false green in the harness itself.
fn report_headless_mode() {
    if std::env::var("RETICLE_HEADLESS").as_deref() != Ok("1") {
        return;
    }
    eprintln!(
        "[reticle] RETICLE_HEADLESS has no app-side effect on a Tauri app: a hidden or off-screen \
         webview is suspended by the OS and stops answering commands. Use a virtual display instead \
         (Linux: `xvfb-run -a pnpm tauri dev`). On macOS, run headful."
    );
}

// A `RETICLE_KEEP_AWAKE` knob was built here and removed. It set `always_on_top` + `set_focus` to
// stop the window being occluded, and it does NOT work: with the window on another macOS Space the
// webview stays suspended and every Reticle command still times out at 8s. Shipping the flag would
// have offered a fix that quietly does nothing — the same failure shape as the hidden-window
// "headless" mode removed above. Only real visibility on the ACTIVE Space keeps a WKWebView alive.

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            report_headless_mode();
            Ok(())
        })
        .manage(Store {
            todos: Mutex::new(vec![
                Todo { id: 1, title: "Wire Reticle into a Tauri app".into(), done: true },
                Todo { id: 2, title: "Assert on an invoke, not a screenshot".into(), done: false },
            ]),
            next_id: Mutex::new(3),
        })
        .invoke_handler(tauri::generate_handler![load_todos, add_todo, archive_todo])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
