//! Zattoo MX3 Remote Controller — Library Root
//!
//! Sets up the Tauri application, spawns the global input listener,
//! and manages application lifecycle.

mod input_handler;
mod key_mapper;
mod zattoo_controller;

use input_handler::InputListener;
use key_mapper::KeyMapper;
use parking_lot::Mutex;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Listener, Manager};
use tokio::sync::mpsc;

/// Shared application state accessible from both Rust commands and the frontend.
pub struct AppState {
    pub key_mapper: Arc<Mutex<KeyMapper>>,
    pub input_active: Arc<Mutex<bool>>,
}

#[tauri::command]
async fn set_input_active(state: tauri::State<'_, AppState>, active: bool) -> Result<(), String> {
    let mut current = state.input_active.lock();
    *current = active;
    Ok(())
}

#[tauri::command]
async fn get_input_active(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let current = state.input_active.lock();
    Ok(*current)
}

#[tauri::command]
async fn get_key_mapping_json(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let mapper = state.key_mapper.lock();
    mapper.export_mapping_json().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Default to info-level logging so users can see diagnostic messages.
    // Override with RUST_LOG env var for more detail (e.g. RUST_LOG=debug).
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "info");
    }
    env_logger::init();

    log::info!(
        "DRM: Webview EME (Encrypted Media Extensions) support depends on the system WebKit/Chromium build. \
        The injected overlay will probe for Widevine, PlayReady, and other key systems at runtime."
    );

    let key_mapper = Arc::new(Mutex::new(KeyMapper::new()));
    // Start with input active. The old frontend (main.ts) used to call set_input_active(true)
    // but since we now load Zattoo directly, we start enabled and the injected script
    // handles everything.
    let input_active = Arc::new(Mutex::new(true));

    // Load default mapping from embedded JSON
    {
        let mut mapper = key_mapper.lock();
        let _ = mapper.load_default_mapping();
    }

    let app_state = AppState {
        key_mapper: key_mapper.clone(),
        input_active: input_active.clone(),
    };

    // Channel for sending key events from the input thread
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(app_state)
        .setup(move |app| {
            let input_active_clone = input_active.clone();

            // Spawn the global input listener in a background thread
            let sender = tx.clone();
            std::thread::spawn(move || {
                let mut listener = InputListener::new();
                if let Err(e) = listener.start(sender) {
                    log::error!("Failed to start input listener: {}", e);
                }
            });

            // Listen for DRM status events emitted by the injected overlay script.
            // The overlay probes for Widevine, PlayReady, etc. and reports back via
            // window.__TAURI__.event.emit('drm-status', {available, found, total}).
            {
                let app_handle = app.handle().clone();
                app_handle.listen("drm-status", |event| {
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                        let available = payload.get("available").and_then(|v| v.as_bool()).unwrap_or(false);
                        let found = payload.get("found").and_then(|v| v.as_u64()).unwrap_or(0);
                        let total = payload.get("total").and_then(|v| v.as_u64()).unwrap_or(0);
                        if available {
                            log::info!("[diagnostic] info: [DRM] {} key system(s) available (probed {}/{})", found, found, total);
                        } else {
                            log::warn!("[diagnostic] warn: [DRM] No DRM key systems available (probed {}/{}) — Zattoo playback may fail", found, total);
                        }
                    }
                });
            }

            // Get the webview window for direct eval calls
            let window = app.get_webview_window("main").expect("main window");

            // Clone handles before moving window into the event loop spawn
            let win_events = window.clone();
            let win_inject = window.clone();

            // Forward events via webview.eval() directly into the page.
            // Key events call window.__zattooRemote.handleKeyEvent().
            // Diagnostic messages are logged to the webview console.
            // Using eval() is more reliable than Tauri events because it
            // doesn't depend on the __TAURI__ API being available on remote pages.
            tauri::async_runtime::spawn(async move {
                while let Some(event_json) = rx.recv().await {
                    // Check message type
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&event_json) {
                        let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("key_event");

                        if msg_type == "diagnostic" {
                            // Forward diagnostic/log messages to the webview console
                            let level = parsed.get("level").and_then(|v| v.as_str()).unwrap_or("info");
                            let message = parsed.get("message").and_then(|v| v.as_str()).unwrap_or("");
                            log::info!("[diagnostic] {}: {}", level, message);
                            let escaped = message
                                .replace('\\', "\\\\")
                                .replace('\'', "\\'")
                                .replace('\n', "\\n");
                            let script = format!("window.__zattooRemote && console && console.{}('[ZR Diagnostic] {}')", level, escaped);
                            let _ = win_events.eval(&script);
                            continue;
                        }
                    }

                    // Normal key event handling
                    if *input_active_clone.lock() {
                        log::debug!("[Key] Sending event via eval: {}", event_json);
                        let escaped = event_json
                            .replace('\\', "\\\\")
                            .replace('\'', "\\'")
                            .replace('\n', "\\n");
                        // Check if overlay exists and handle the key event.
                        // If the overlay was lost (e.g. after page navigation), the eval
                        // silently fails and we'll re-inject on the next navigation detection.
                        let script = format!(
                            "window.__zattooRemote && window.__zattooRemote.handleKeyEvent('{}')",
                            escaped
                        );
                        let _ = win_events.eval(&script);
                    }
                }
            });

            // Inject the overlay script into the page after it loads, and keep it alive.
            // The injected script has an idempotency guard (`if(window.__ZR)return;`) so
            // re-injecting while the overlay is still alive is harmless — it just returns
            // immediately. This watchdog ensures the overlay survives page navigations.
            let overlay_script = include_str!("zattoo_inject.js");
            tauri::async_runtime::spawn(async move {
                // Wait an initial 3s for Zattoo to begin loading
                tokio::time::sleep(Duration::from_secs(3)).await;

                let mut first_injection = true;

                loop {
                    // Try up to 3 times per cycle (to handle brief page-load windows)
                    for attempt in 1..=3 {
                        if first_injection {
                            log::info!("Injecting Zattoo Remote overlay (attempt {})...", attempt);
                        }

                        match win_inject.eval(overlay_script) {
                            Ok(_) => {
                                if first_injection {
                                    log::info!("Overlay injection successful");
                                    let ok_script = "console.log('[ZR] Zattoo Remote overlay loaded — waiting for input...')";
                                    let _ = win_inject.eval(ok_script);
                                    first_injection = false;
                                }
                                break; // success, wait for next cycle
                            }
                            Err(e) => {
                                if attempt < 3 {
                                    tokio::time::sleep(Duration::from_secs(2)).await;
                                }
                                if first_injection {
                                    log::warn!("Injection attempt {} failed: {}", attempt, e);
                                }
                            }
                        }
                    }

                    // Health-check interval: re-inject every 10s to survive page navigations
                    tokio::time::sleep(Duration::from_secs(10)).await;
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_input_active,
            get_input_active,
            get_key_mapping_json,
            zattoo_controller::set_system_volume,
            zattoo_controller::toggle_system_mute,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
