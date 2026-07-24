//! Global keyboard and mouse input capture.
//!
//! On Linux: uses `evdev` to read directly from /dev/input/event* devices.
//!   This works on **both X11 and Wayland** (no display server dependency).
//!   The user needs read access to /dev/input/event* (typically granted
//!   by logind for the active seat, or by being in the `input` group).
//!
//! On macOS/Windows: uses `rdev` for global input capture.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc::UnboundedSender;

/// Represents a filtered remote key event ready for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct RemoteKeyEvent {
    /// Discriminator for the async event loop
    #[serde(rename = "type")]
    pub event_type: String,
    /// The mapped action name (e.g., "up", "down", "ok", "digit_1")
    pub action: String,
    /// Human-readable label for OSD display
    pub label: String,
    /// Key scan code for debugging
    pub scan_code: u32,
    /// Whether this is a key-down (true) or key-up (false) event
    pub is_press: bool,
}

/// A diagnostic / log message sent from the input listener to the webview console.
#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticMessage {
    /// Always "diagnostic"
    #[serde(rename = "type")]
    pub msg_type: String,
    /// Log level: "info", "warn", "error"
    pub level: String,
    /// The message text
    pub message: String,
}

/// Send a diagnostic message through the key-event channel.
/// The async event loop in lib.rs will forward it to the webview console.
pub fn send_diagnostic(sender: &UnboundedSender<String>, level: &str, message: &str) {
    let diag = DiagnosticMessage {
        msg_type: "diagnostic".into(),
        level: level.into(),
        message: message.into(),
    };
    if let Ok(json) = serde_json::to_string(&diag) {
        let _ = sender.send(json);
    }
}

/// Wraps the global input listener.
pub struct InputListener {
    running: Arc<AtomicBool>,
}

impl InputListener {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Start listening for global input events.
    /// Sends recognized events as JSON through the provided channel.
    pub fn start(
        &mut self,
        sender: UnboundedSender<String>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        self.running.store(true, Ordering::SeqCst);
        let running = self.running.clone();

        #[cfg(target_os = "linux")]
        {
            start_evdev_listener(running, sender);
        }

        #[cfg(not(target_os = "linux"))]
        {
            start_rdev_listener(running, sender);
        }

        Ok(())
    }
}

/// Helper: build a `RemoteKeyEvent` from an (action, label) pair.
fn key_event(action: &str, label: &str, scan_code: u32, is_press: bool) -> RemoteKeyEvent {
    RemoteKeyEvent {
        event_type: "key_event".into(),
        action: action.into(),
        label: label.into(),
        scan_code,
        is_press,
    }
}

// ── Linux: evdev-based input capture ─────────────────────────────

#[cfg(target_os = "linux")]
mod linux_input {
    use super::*;
    use evdev::{Device, InputEventKind, Key};
    use std::time::Duration;

    /// Start the evdev-based input listener on Linux.
    /// Detects whether running X11 or Wayland at runtime.
    /// On X11: uses rdev (more responsive, supports mouse events).
    /// On Wayland: uses evdev (direct device access).
    pub fn start_evdev_listener(running: Arc<AtomicBool>, sender: UnboundedSender<String>) {
        let session_type = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();

        send_diagnostic(
            &sender,
            "info",
            &format!("[input] Detected XDG_SESSION_TYPE={:?}", session_type),
        );

        // On X11, prefer rdev — it handles mouse events and has better responsiveness
        if session_type == "x11" || session_type.is_empty() {
            send_diagnostic(
                &sender,
                "info",
                "[input] Using rdev listener (X11 detected or unknown session type)",
            );
            super::rdev_input::start_rdev_listener(running, sender);
            return;
        }

        send_diagnostic(
            &sender,
            "info",
            "[input] Using evdev listener (Wayland detected)",
        );
        start_evdev_only_listener(running, sender);
    }

    /// Check whether the user can read any evdev device. Scans /dev/input/event*.
    fn check_evdev_access() -> bool {
        let dir = std::path::Path::new("/dev/input");
        if !dir.is_dir() {
            log::error!("[evdev] /dev/input/ does not exist on this system");
            return false;
        }

        let mut found_openable = false;
        let mut found_any = false;

        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let path_str = path.to_string_lossy();
                if !path_str.contains("event") {
                    continue;
                }
                found_any = true;
                match std::fs::File::open(&path) {
                    Ok(_f) => {
                        log::info!("[evdev] ✓ Can open {}", path_str);
                        found_openable = true;
                    }
                    Err(e) => {
                        log::warn!("[evdev] ✗ Cannot open {}: {}", path_str, e);
                    }
                }
            }
        }

        if !found_any {
            log::error!("[evdev] No /dev/input/event* devices found at all");
            return false;
        }

        if !found_openable {
            log::error!(
                "[evdev] Found event devices but cannot open any. \
                 Under Wayland you likely need 'input' group membership.\n\
                 Run:  sudo usermod -aG input $USER && newgrp input\n\
                 Then restart the app."
            );
        }

        found_openable
    }

    /// Start the pure evdev listener for Wayland.
    fn start_evdev_only_listener(running: Arc<AtomicBool>, sender: UnboundedSender<String>) {
        std::thread::spawn(move || {
            send_diagnostic(&sender, "info", "[evdev] Checking evdev access...");

            if !check_evdev_access() {
                send_diagnostic(&sender, "error",
                    "[evdev] Cannot read /dev/input/event* devices. \
                     Under Wayland you need 'input' group membership.\n\
                     Run:  sudo usermod -aG input $USER\n\
                     Then log out and back in. Falling back to rdev (won't work on pure Wayland)."
                );
                // Try rdev anyway as fallback
                super::rdev_input::start_rdev_listener(running, sender);
                return;
            }

            send_diagnostic(&sender, "info", "[evdev] evdev access OK, scanning for keyboards...");

            // Find and open all keyboard devices
            let devices = find_keyboard_devices();
            send_diagnostic(&sender, "info",
                &format!("[evdev] Found {} keyboard device(s): {:?}", devices.len(), devices)
            );

            if devices.is_empty() {
                send_diagnostic(&sender, "error",
                    "[evdev] No keyboard devices found in /dev/input/event*! \
                     Ensure you have read permissions (try: sudo usermod -aG input $USER, then re-login)"
                );
                return;
            }

            send_diagnostic(&sender, "info", "[evdev] Starting keyboard listeners...");

            // Threaded approach: one reader thread per device
            let mut handles = Vec::new();
            for dev_path in devices {
                let sender = sender.clone();
                let running = running.clone();
                let handle = std::thread::spawn(move || {
                    read_device_events(&dev_path, &sender, &running);
                });
                handles.push(handle);
            }

            for handle in handles {
                let _ = handle.join();
            }
        });
    }

    /// Continuously read events from a single evdev device.
    fn read_device_events(
        path: &str,
        sender: &UnboundedSender<String>,
        running: &Arc<AtomicBool>,
    ) {
        loop {
            if !running.load(Ordering::SeqCst) {
                break;
            }

            let mut device = match Device::open(path) {
                Ok(d) => d,
                Err(e) => {
                    log::warn!("[evdev] Cannot open {}: {}. Retrying in 2s...", path, e);
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
            };

            log::debug!("[evdev] Reading from device: {}", device.name().unwrap_or("unknown"));

            // Read events in a loop
            loop {
                if !running.load(Ordering::SeqCst) {
                    break;
                }

                match device.fetch_events() {
                    Ok(events) => {
                        for ev in events {
                            if let InputEventKind::Key(key) = ev.kind() {
                                let is_press = ev.value() == 1; // 1 = press, 0 = release, 2 = repeat
                                if ev.value() == 2 {
                                    // Auto-repeat — only send press on first repeat, skip others
                                    continue;
                                }
                                if let Some(remote_event) = map_evdev_key(key, is_press) {
                                    if let Ok(json) = serde_json::to_string(&remote_event) {
                                        log::debug!(
                                            "[evdev] Key: {:?} code={} {}",
                                            key,
                                            key.code(),
                                            if is_press { "↓" } else { "↑" }
                                        );
                                        let _ = sender.send(json);
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        if e.kind() == std::io::ErrorKind::WouldBlock {
                            // No events available, sleep briefly
                            std::thread::sleep(Duration::from_millis(10));
                            continue;
                        }
                        log::warn!("[evdev] Error reading {}: {}. Reconnecting...", path, e);
                        break; // Break inner loop, reconnect
                    }
                }
            }
        }
    }

    /// Find all keyboard-capable input devices in /dev/input/event*.
    fn find_keyboard_devices() -> Vec<String> {
        let mut devices = Vec::new();
        let input_dir = std::path::Path::new("/dev/input");

        if !input_dir.is_dir() {
            log::error!("[evdev] /dev/input/ directory missing");
            return devices;
        }

        if let Ok(entries) = std::fs::read_dir(input_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let path_str = path.to_string_lossy().to_string();

                if !path_str.contains("event") {
                    continue;
                }

                let dev = match Device::open(&path) {
                    Ok(d) => d,
                    Err(e) => {
                        log::debug!("[evdev] Cannot open {}: {}", path_str, e);
                        continue;
                    }
                };

                let name = dev.name().unwrap_or("unknown").to_string();

                // Check supported keys bitmap
                let keys = match dev.supported_keys() {
                    Some(k) => k,
                    None => {
                        log::debug!("[evdev] {} ({}): no supported_keys(), skipping", path_str, name);
                        continue;
                    }
                };

                // Broad keyboard detection: check for common alphanumeric keys or KEY_1 (code 2)
                const KEY_CODES: &[u32] = &[
                    1,   // KEY_ESC
                    2,   // KEY_1
                    16,  // KEY_Q
                    28,  // KEY_ENTER
                    57,  // KEY_SPACE
                    103, // KEY_UP
                ];

                let has_keys = keys.iter().any(|k| KEY_CODES.contains(&(k.code() as u32)));

                if has_keys {
                    log::info!("[evdev] ✓ Keyboard device: {} ({})", path_str, name);
                    devices.push(path_str);
                } else {
                    let count = keys.iter().count();
                    log::debug!("[evdev] - Skipping {} ({}): {} keys, none match keyboard", path_str, name, count);
                }
            }
        }

        if devices.is_empty() {
            log::error!(
                "[evdev] No keyboard-capable devices found in /dev/input/event*! \
                 Ensure you have read permissions (try: sudo usermod -aG input $USER, then re-login)"
            );
        } else {
            log::info!("[evdev] Found {} keyboard device(s)", devices.len());
        }

        devices
    }

    /// Map an evdev Key to a remote key action.
    /// Uses standard Linux input event codes (linux/input-event-codes.h).
    fn map_evdev_key(key: Key, is_press: bool) -> Option<RemoteKeyEvent> {
        let code = key.code();
        let (action, label) = match code {
            // Navigation arrows — Up/Down = program guide, Left/Right = volume
            103 => ("up", "▲ Up"),                  // KEY_UP
            108 => ("down", "▼ Down"),               // KEY_DOWN
            105 => ("volume_down", "🔊-"),           // KEY_LEFT
            106 => ("volume_up", "🔊+"),             // KEY_RIGHT

            // Enter / OK
            28 | 96 => ("ok", "OK"),         // KEY_ENTER, KEY_KPENTER

            // Back
            1 | 14 => ("back", "⬅ Back"),    // KEY_ESC, KEY_BACKSPACE

            // Digit keys (top row: 2-11, numpad: 79-82,71-73)
            11 => ("digit_0", "0"),           // KEY_0
            2 => ("digit_1", "1"),            // KEY_1
            3 => ("digit_2", "2"),            // KEY_2
            4 => ("digit_3", "3"),            // KEY_3
            5 => ("digit_4", "4"),            // KEY_4
            6 => ("digit_5", "5"),            // KEY_5
            7 => ("digit_6", "6"),            // KEY_6
            8 => ("digit_7", "7"),            // KEY_7
            9 => ("digit_8", "8"),            // KEY_8
            10 => ("digit_9", "9"),           // KEY_9
            // Numpad digits
            82 => ("digit_0", "0"),           // KEY_KP0
            79 => ("digit_1", "1"),           // KEY_KP1
            80 => ("digit_2", "2"),           // KEY_KP2
            81 => ("digit_3", "3"),           // KEY_KP3
            75 => ("digit_4", "4"),           // KEY_KP4
            76 => ("digit_5", "5"),           // KEY_KP5
            77 => ("digit_6", "6"),           // KEY_KP6
            71 => ("digit_7", "7"),           // KEY_KP7
            72 => ("digit_8", "8"),           // KEY_KP8
            73 => ("digit_9", "9"),           // KEY_KP9

            // Media / playback
            57 => ("play_pause", "▶ Play/Pause"),   // KEY_SPACE
            104 => ("channel_up", "CH+"),            // KEY_PAGEUP
            109 => ("channel_down", "CH-"),          // KEY_PAGEDOWN

            // Function keys
            59 => ("color_red", "🔴 Red"),           // KEY_F1
            60 => ("color_green", "🟢 Green"),       // KEY_F2
            61 => ("color_yellow", "🟡 Yellow"),     // KEY_F3
            62 => ("color_blue", "🔵 Blue"),         // KEY_F4
            63 => ("rewind", "⏪ -15s"),              // KEY_F5
            64 => ("fast_forward", "⏩ +15s"),         // KEY_F6
            65 => ("stop", "⏹ Stop"),                // KEY_F7
            66 => ("record", "⏺ Record"),            // KEY_F8
            67 => ("guide", "📋 EPG"),               // KEY_F9
            68 => ("settings", "⚙ Settings"),        // KEY_F10
            87 => ("account", "👤 Account"),          // KEY_F11
            88 => ("recordings", "📼 Recordings"),    // KEY_F12

            // Modifier keys
            56 | 100 => ("home", "🏠 Home"),          // KEY_LEFTALT, KEY_RIGHTALT
            54 => ("menu", "📋 EPG"),                 // KEY_RIGHTSHIFT
            97 => ("search", "🔍 Search"),            // KEY_RIGHTCTRL

            // Volume keys
            113 => ("mute", "🔇 Mute"),               // KEY_MUTE
            114 => ("volume_down", "🔊-"),            // KEY_VOLUMEDOWN
            115 => ("volume_up", "🔊+"),              // KEY_VOLUMEUP

            // Mouse mode
            110 => ("mouse_mode", "🖱 Mouse Mode"),   // KEY_INSERT

            // Media keys (play/pause, stop, next, prev)
            164 => ("play_pause", "▶ Play/Pause"),    // KEY_PLAYPAUSE
            128 | 166 => ("stop", "⏹ Stop"),          // KEY_STOP, KEY_STOPCD
            163 => ("channel_up", "CH+"),             // KEY_NEXTSONG
            165 => ("channel_down", "CH-"),           // KEY_PREVIOUSSONG
            168 => ("rewind", "⏪ Rewind"),            // KEY_REWIND (media)
            208 => ("fast_forward", "⏩ FF"),          // KEY_FASTFORWARD
            207 => ("play_pause", "▶ Play"),          // KEY_PLAY
            139 => ("menu", "📋 Menu"),               // KEY_MENU
            217 => ("search", "🔍 Search"),           // KEY_SEARCH
            172 => ("home", "🏠 Home"),               // KEY_HOMEPAGE
            158 => ("back", "⬅ Back"),               // KEY_BACK
            159 => ("forward", "▶ Fwd"),              // KEY_FORWARD

            _ => {
                // Log unmapped keys for debugging
                if is_press {
                    log::debug!("[evdev] Unmapped key code: {} ({:?})", code, key);
                }
                return None;
            }
        };

        Some(key_event(action, label, code as u32, is_press))
    }
}

#[cfg(target_os = "linux")]
use linux_input::start_evdev_listener;

// ── rdev-based input capture (all platforms, including Linux X11) ──

pub(crate) mod rdev_input {
    use super::*;
    use rdev::{listen, Event, EventType, Key};

    /// Start the rdev-based input listener (macOS/Windows).
    pub fn start_rdev_listener(running: Arc<AtomicBool>, sender: UnboundedSender<String>) {
        std::thread::spawn(move || {
            if let Err(error) = listen(move |event: Event| {
                if !running.load(Ordering::SeqCst) {
                    // rdev's listen blocks — we can only return early by exiting the process or panicking.
                    // The running flag check at least lets us stop processing events.
                    return;
                }

                match event.event_type {
                    EventType::KeyPress(key) => {
                        if let Some(remote_event) = map_rdev_key(key, true) {
                            if let Ok(json) = serde_json::to_string(&remote_event) {
                                let _ = sender.send(json);
                            }
                        }
                    }
                    EventType::KeyRelease(key) => {
                        if let Some(remote_event) = map_rdev_key(key, false) {
                            if let Ok(json) = serde_json::to_string(&remote_event) {
                                let _ = sender.send(json);
                            }
                        }
                    }
                    EventType::ButtonPress(button) => {
                        let (action, label) = match button {
                            rdev::Button::Left => ("mouse_left", "Mouse Left"),
                            rdev::Button::Right => ("mouse_right", "Mouse Right"),
                            rdev::Button::Middle => ("mouse_middle", "Mouse Middle"),
                            _ => return,
                        };
                        let event = key_event(action, label, 0, true);
                        if let Ok(json) = serde_json::to_string(&event) {
                            let _ = sender.send(json);
                        }
                    }
                    EventType::MouseMove { x, y } => {
                        let event = serde_json::json!({
                            "type": "key_event",
                            "action": "mouse_move",
                            "label": "",
                            "scan_code": 0,
                            "is_press": true,
                            "x": x,
                            "y": y
                        });
                        if let Ok(json) = serde_json::to_string(&event) {
                            let _ = sender.send(json);
                        }
                    }
                    _ => {}
                }
            }) {
                log::error!("rdev listen error: {:?}", error);
            }
        });
    }

    /// Map a raw rdev Key to a remote key action.
    fn map_rdev_key(key: Key, is_press: bool) -> Option<RemoteKeyEvent> {
        let (action, label) = match key {
            Key::UpArrow => ("up", "▲ Up"),
            Key::DownArrow => ("down", "▼ Down"),
            Key::LeftArrow => ("volume_down", "🔊-"),
            Key::RightArrow => ("volume_up", "🔊+"),
            Key::Return | Key::KpReturn => ("ok", "OK"),
            Key::Escape => ("back", "⬅ Back"),
            Key::Backspace => ("back", "⬅ Back"),
            Key::Num0 | Key::Kp0 => ("digit_0", "0"),
            Key::Num1 | Key::Kp1 => ("digit_1", "1"),
            Key::Num2 | Key::Kp2 => ("digit_2", "2"),
            Key::Num3 | Key::Kp3 => ("digit_3", "3"),
            Key::Num4 | Key::Kp4 => ("digit_4", "4"),
            Key::Num5 | Key::Kp5 => ("digit_5", "5"),
            Key::Num6 | Key::Kp6 => ("digit_6", "6"),
            Key::Num7 | Key::Kp7 => ("digit_7", "7"),
            Key::Num8 | Key::Kp8 => ("digit_8", "8"),
            Key::Num9 | Key::Kp9 => ("digit_9", "9"),
            Key::Space => ("play_pause", "▶ Play/Pause"),
            Key::PageUp => ("channel_up", "CH+"),
            Key::PageDown => ("channel_down", "CH-"),
            Key::Unknown(113) | Key::Unknown(0xAD) => ("mute", "🔇 Mute"),
            Key::Unknown(114) | Key::Unknown(0xAE) => ("volume_down", "🔊-"),
            Key::Unknown(115) | Key::Unknown(0xAF) => ("volume_up", "🔊+"),
            Key::F1 => ("color_red", "🔴 Red"),
            Key::F2 => ("color_green", "🟢 Green"),
            Key::F3 => ("color_yellow", "🟡 Yellow"),
            Key::F4 => ("color_blue", "🔵 Blue"),
            Key::F5 => ("rewind", "⏪ Rewind"),
            Key::F6 => ("fast_forward", "⏩ FF"),
            Key::F7 => ("stop", "⏹ Stop"),
            Key::F8 => ("record", "⏺ Record"),
            Key::F9 => ("guide", "📋 EPG"),
            Key::F10 => ("settings", "⚙ Settings"),
            Key::F11 => ("account", "👤 Account"),
            Key::F12 => ("recordings", "📼 Recordings"),
            Key::Alt => ("home", "🏠 Home"),
            Key::ShiftRight => ("menu", "📋 EPG"),
            Key::ControlRight => ("search", "🔍 Search"),
            Key::Insert => ("mouse_mode", "🖱 Mouse Mode"),
            Key::Unknown(code) => {
                log::debug!("Unmapped key: Unknown({})", code);
                return None;
            }
            _ => return None,
        };

        Some(key_event(action, label, 0, is_press))
    }
}

#[cfg(not(target_os = "linux"))]
use rdev_input::start_rdev_listener;
