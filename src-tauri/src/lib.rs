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
use tauri::Manager;
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
async fn update_key_mapping(
    state: tauri::State<'_, AppState>,
    mapping_json: String,
) -> Result<(), String> {
    let mut mapper = state.key_mapper.lock();
    mapper
        .load_custom_mapping(&mapping_json)
        .map_err(|e| e.to_string())
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
                        let script = format!(
                            "window.__zattooRemote && window.__zattooRemote.handleKeyEvent('{}')",
                            escaped
                        );
                        let _ = win_events.eval(&script);
                    }
                }
            });

            // Inject the overlay script into the page after it loads.
            // Uses polling to handle slow-loading pages (e.g. DNS delays on Zattoo's third-party resources).
            let overlay_script = include_str!("zattoo_inject.js");
            tauri::async_runtime::spawn(async move {
                // Wait an initial 3s for the page to begin loading
                tokio::time::sleep(Duration::from_secs(3)).await;

                // Poll until injection succeeds (up to ~30s total)
                let max_attempts = 10;
                for attempt in 1..=max_attempts {
                    log::info!(
                        "Injecting Zattoo Remote overlay (attempt {}/{})...",
                        attempt,
                        max_attempts
                    );
                    match win_inject.eval(overlay_script) {
                        Ok(_) => {
                            log::info!("Overlay injection successful");
                            // Notify the user that the remote is connected
                            let ok_script = "window.__zattooRemote && window.__zattooRemote.handleKeyEvent && console.log('[ZR] Zattoo Remote overlay v2 loaded — waiting for input...')";
                            let _ = win_inject.eval(ok_script);
                            return;
                        }
                        Err(e) => {
                            log::warn!(
                                "Injection attempt {} failed: {}. Retrying in 3s...",
                                attempt,
                                e
                            );
                            tokio::time::sleep(Duration::from_secs(3)).await;
                        }
                    }
                }
                log::error!("Failed to inject overlay after {} attempts", max_attempts);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_input_active,
            get_input_active,
            update_key_mapping,
            get_key_mapping_json,
            zattoo_controller::execute_zattoo_action,
            zattoo_controller::navigate_zattoo,
            zattoo_controller::set_system_volume,
            zattoo_controller::toggle_system_mute,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
