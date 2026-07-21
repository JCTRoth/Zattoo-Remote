//! Global keyboard and mouse input capture using the `rdev` crate.
//!
//! Listens for keyboard and mouse events system-wide, filters them
//! through the key mapper, and sends recognized remote key events
//! to the frontend via a channel.

use rdev::{listen, Event, EventType, Key};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc::UnboundedSender;

/// Represents a filtered remote key event ready for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct RemoteKeyEvent {
    /// The mapped action name (e.g., "up", "down", "ok", "channel_1")
    pub action: String,
    /// Human-readable label for OSD display
    pub label: String,
    /// Key scan code for debugging
    pub scan_code: u32,
    /// Whether this is a key-down (true) or key-up (false) event
    pub is_press: bool,
}

/// Wraps the rdev global input listener with graceful shutdown support.
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

        std::thread::spawn(move || {
            // The rdev callback is called for every system-wide event.
            // We filter aggressively to minimize overhead.
            if let Err(error) = listen(move |event: Event| {
                if !running.load(Ordering::SeqCst) {
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
                        // Handle mouse buttons (OK = left click, Back = right click in mouse mode)
                        let action = match button {
                            rdev::Button::Left => "mouse_left",
                            rdev::Button::Right => "mouse_right",
                            rdev::Button::Middle => "mouse_middle",
                            _ => return,
                        };
                        let event = RemoteKeyEvent {
                            action: action.to_string(),
                            label: format!("Mouse {}", action),
                            scan_code: 0,
                            is_press: true,
                        };
                        if let Ok(json) = serde_json::to_string(&event) {
                            let _ = sender.send(json);
                        }
                    }
                    EventType::MouseMove { x, y } => {
                        // Forward mouse movement for gyro mouse mode
                        let event = serde_json::json!({
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

        Ok(())
    }

    /// Signal the listener to stop (used for clean shutdown).
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

/// Map a raw rdev Key to a remote key action.
/// This is the default mapping for MX3-style remotes.
/// The mapping can be overridden by user configuration.
///
/// Note: rdev uses physical key names (QWERTY layout), not OS-specific scan codes.
/// For multimedia keys (volume, play, etc.), rdev reports them as `Key::Unknown(code)`
/// with the Linux evdev / Windows VK scan code.
fn map_rdev_key(key: Key, is_press: bool) -> Option<RemoteKeyEvent> {
    let (action, label) = match key {
        // Navigation arrows
        Key::UpArrow => ("up", "▲ Up"),
        Key::DownArrow => ("down", "▼ Down"),
        Key::LeftArrow => ("left", "◀ Left"),
        Key::RightArrow => ("right", "▶ Right"),

        // Action buttons
        Key::Return | Key::KpReturn => ("ok", "OK"),
        Key::Escape => ("back", "⬅ Back"),
        Key::Backspace => ("back", "⬅ Back"),

        // Digit keys (top row + numpad) for channel input
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

        // Media / playback
        Key::Space => ("play_pause", "▶ Play/Pause"),
        Key::PageUp => ("channel_up", "CH+"),
        Key::PageDown => ("channel_down", "CH-"),

        // Volume keys: rdev reports multimedia keys as Key::Unknown(code)
        // Linux evdev codes: 114=VolumeDown, 115=VolumeUp, 113=Mute
        // Windows VK codes: 0xAE=VolumeDown, 0xAF=VolumeUp, 0xAD=Mute
        Key::Unknown(113) | Key::Unknown(0xAD) => ("mute", "🔇 Mute"),
        Key::Unknown(114) | Key::Unknown(0xAE) => ("volume_down", "🔊-"),
        Key::Unknown(115) | Key::Unknown(0xAF) => ("volume_up", "🔊+"),

        // Special — function keys as color keys
        Key::F1 => ("color_red", "🔴 Red"),
        Key::F2 => ("color_green", "🟢 Green"),
        Key::F3 => ("color_yellow", "🟡 Yellow"),
        Key::F4 => ("color_blue", "🔵 Blue"),

        // Home / Menu / Search
        Key::Alt => ("home", "🏠 Home"),
        Key::ShiftRight => ("menu", "📋 EPG"),
        Key::ControlRight => ("search", "🔍 Search"),

        // Media transport (F5-F8 or special media keys)
        Key::F5 => ("rewind", "⏪ Rewind"),
        Key::F6 => ("fast_forward", "⏩ FF"),
        Key::F7 => ("stop", "⏹ Stop"),
        Key::F8 => ("record", "⏺ Record"),

        // Mouse mode toggle
        Key::Insert => ("mouse_mode", "🖱 Mouse Mode"),

        // Unknown key — could be a volume/media key not yet mapped.
        // Log it for debugging so the user can discover their remote's scan codes.
        Key::Unknown(code) => {
            log::debug!("Unmapped key: Unknown({})", code);
            return None;
        }

        // All other rdev keys — ignore
        _ => return None,
    };

    Some(RemoteKeyEvent {
        action: action.to_string(),
        label: label.to_string(),
        scan_code: 0,
        is_press,
    })
}
