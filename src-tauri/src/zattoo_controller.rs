//! Zattoo Webview Controller
//!
//! Provides commands for controlling the Zattoo web application
//! via JavaScript injection into the webview. Handles channel changes,
//! playback control, EPG navigation, and search.

use serde::Serialize;
use tauri::Manager;

/// Result of a DOM manipulation attempt.
#[derive(Debug, Clone, Serialize)]
pub struct DomActionResult {
    pub success: bool,
    pub action: String,
    pub message: String,
}

/// JavaScript snippets for Zattoo DOM manipulation.
/// These are injected into the Zattoo webview to simulate user interaction.
pub mod zattoo_scripts {
    /// Press a specific keyboard key inside the Zattoo webview.
    pub fn send_key(key: &str) -> String {
        format!(
            r#"
            (function() {{
                try {{
                    const event = new KeyboardEvent('keydown', {{
                        key: '{}',
                        code: '{}',
                        keyCode: 0,
                        which: 0,
                        bubbles: true,
                        cancelable: true
                    }});
                    document.activeElement.dispatchEvent(event);
                    document.body.dispatchEvent(event);
                    return JSON.stringify({{ success: true, action: 'send_key', message: 'Key {} sent' }});
                }} catch(e) {{
                    return JSON.stringify({{ success: false, action: 'send_key', message: e.message }});
                }}
            }})()
            "#,
            key, key, key
        )
    }

    /// Click an element matching a CSS selector.
    pub fn click_selector(selector: &str) -> String {
        format!(
            r#"
            (function() {{
                try {{
                    const el = document.querySelector('{}');
                    if (el) {{
                        el.click();
                        return JSON.stringify({{ success: true, action: 'click', message: 'Clicked {}' }});
                    }}
                    return JSON.stringify({{ success: false, action: 'click', message: 'Selector not found: {}' }});
                }} catch(e) {{
                    return JSON.stringify({{ success: false, action: 'click', message: e.message }});
                }}
            }})()
            "#,
            selector, selector, selector
        )
    }

    /// Search for an element by text content and click it.
    pub fn click_by_text(text: &str) -> String {
        format!(
            r#"
            (function() {{
                try {{
                    const elements = document.querySelectorAll('button, a, [role="button"], .clickable, [tabindex]');
                    for (const el of elements) {{
                        if (el.textContent && el.textContent.trim().toLowerCase().includes('{}'.toLowerCase())) {{
                            el.click();
                            return JSON.stringify({{ success: true, action: 'click_by_text', message: 'Clicked element containing: {}' }});
                        }}
                    }}
                    return JSON.stringify({{ success: false, action: 'click_by_text', message: 'No element found containing: {}' }});
                }} catch(e) {{
                    return JSON.stringify({{ success: false, action: 'click_by_text', message: e.message }});
                }}
            }})()
            "#,
            text, text, text
        )
    }

    /// Change channel by entering a number into the search/input field.
    pub fn change_channel(channel_number: &str) -> String {
        format!(
            r#"
            (function() {{
                try {{
                    // Strategy 1: Look for a channel number input field
                    const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input[type="search"], input:not([type])');
                    for (const input of inputs) {{
                        const placeholder = (input.placeholder || '').toLowerCase();
                        const aria = (input.getAttribute('aria-label') || '').toLowerCase();
                        const name = (input.name || '').toLowerCase();
                        const id = (input.id || '').toLowerCase();
                        if (placeholder.includes('channel') || placeholder.includes('sender') ||
                            placeholder.includes('search') || aria.includes('channel') ||
                            aria.includes('search') || name.includes('channel') ||
                            name.includes('search') || id.includes('channel') ||
                            id.includes('search') || id.includes('channelnumber')) {{
                            input.focus();
                            input.value = '{}';
                            input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                            input.dispatchEvent(new Event('change', {{ bubbles: true }}));
                            // Press Enter to confirm
                            input.dispatchEvent(new KeyboardEvent('keydown', {{ key: 'Enter', code: 'Enter', bubbles: true }}));
                            input.dispatchEvent(new KeyboardEvent('keyup', {{ key: 'Enter', code: 'Enter', bubbles: true }}));
                            return JSON.stringify({{ success: true, action: 'change_channel', message: 'Channel changed to {}' }});
                        }}
                    }}

                    // Strategy 2: Use the player API if available
                    if (window.zattoo && window.zattoo.setChannel) {{
                        window.zattoo.setChannel('{}');
                        return JSON.stringify({{ success: true, action: 'change_channel', message: 'Channel changed via API to {}' }});
                    }}

                    // Strategy 3: Navigate to the channel URL directly
                    const channelUrl = window.location.origin + '/live/' + '{}';
                    if (window.location.href !== channelUrl) {{
                        window.location.href = channelUrl;
                        return JSON.stringify({{ success: true, action: 'change_channel', message: 'Navigated to channel {}' }});
                    }}

                    return JSON.stringify({{ success: false, action: 'change_channel', message: 'Could not find channel input' }});
                }} catch(e) {{
                    return JSON.stringify({{ success: false, action: 'change_channel', message: e.message }});
                }}
            }})()
            "#,
            channel_number, channel_number, channel_number, channel_number, channel_number,
            channel_number
        )
    }

    /// Toggle play/pause on the current stream.
    pub fn toggle_play_pause() -> String {
        r#"
        (function() {
            try {
                // Strategy 1: Click the play/pause button
                const selectors = [
                    '[data-testid="play-pause-button"]',
                    '.play-pause-button',
                    '.player-controls button:first-child',
                    '[aria-label*="play" i]',
                    '[aria-label*="pause" i]',
                    'button[title*="Play" i]',
                    'button[title*="Pause" i]',
                    '.vjs-play-control',
                    '.play-button',
                    '.pause-button'
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        el.click();
                        return JSON.stringify({ success: true, action: 'toggle_play_pause', message: 'Toggled play/pause via: ' + sel });
                    }
                }

                // Strategy 2: Use the video element directly
                const video = document.querySelector('video');
                if (video) {
                    if (video.paused) {
                        video.play();
                        return JSON.stringify({ success: true, action: 'toggle_play_pause', message: 'Video played' });
                    } else {
                        video.pause();
                        return JSON.stringify({ success: true, action: 'toggle_play_pause', message: 'Video paused' });
                    }
                }

                return JSON.stringify({ success: false, action: 'toggle_play_pause', message: 'No play/pause control found' });
            } catch(e) {
                return JSON.stringify({ success: false, action: 'toggle_play_pause', message: e.message });
            }
        })()
        "#.to_string()
    }

    /// Seek forward or backward by a number of seconds.
    pub fn seek(seconds: i32) -> String {
        format!(
            r#"
            (function() {{
                try {{
                    const video = document.querySelector('video');
                    if (video) {{
                        video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + {}));
                        return JSON.stringify({{ success: true, action: 'seek', message: 'Seeked {}s' }});
                    }}
                    return JSON.stringify({{ success: false, action: 'seek', message: 'No video element found' }});
                }} catch(e) {{
                    return JSON.stringify({{ success: false, action: 'seek', message: e.message }});
                }}
            }})()
            "#,
            seconds, seconds
        )
    }

    /// Open the EPG (Electronic Program Guide).
    pub fn open_epg() -> String {
        r#"
        (function() {
            try {
                const selectors = [
                    '[data-testid="epg-button"]',
                    '[data-testid="guide-button"]',
                    '.epg-button',
                    '.guide-button',
                    'a[href*="epg"]',
                    'a[href*="guide"]',
                    'button:has-text("Guide")',
                    '[aria-label*="guide" i]',
                    '[aria-label*="EPG" i]'
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        el.click();
                        return JSON.stringify({ success: true, action: 'open_epg', message: 'Opened EPG via: ' + sel });
                    }
                }

                // Fallback: click any element containing "Guide" or "EPG" text
                const all = document.querySelectorAll('a, button, [role="button"]');
                for (const el of all) {
                    if (el.textContent && /guide|epg|programm/i.test(el.textContent)) {
                        el.click();
                        return JSON.stringify({ success: true, action: 'open_epg', message: 'Opened EPG via text match' });
                    }
                }

                return JSON.stringify({ success: false, action: 'open_epg', message: 'EPG button not found' });
            } catch(e) {
                return JSON.stringify({ success: false, action: 'open_epg', message: e.message });
            }
        })()
        "#.to_string()
    }

    /// Focus the search field on the page.
    pub fn focus_search() -> String {
        r#"
        (function() {
            try {
                const selectors = [
                    'input[type="search"]',
                    'input[placeholder*="search" i]',
                    'input[placeholder*="Search" i]',
                    'input[aria-label*="search" i]',
                    '.search-input',
                    '#search-input',
                    '[data-testid="search-input"]'
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        el.focus();
                        return JSON.stringify({ success: true, action: 'focus_search', message: 'Focused search: ' + sel });
                    }
                }

                // Press Ctrl+F or / to trigger search
                document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', bubbles: true }));
                return JSON.stringify({ success: true, action: 'focus_search', message: 'Dispatched search key' });
            } catch(e) {
                return JSON.stringify({ success: false, action: 'focus_search', message: e.message });
            }
        })()
        "#.to_string()
    }

    /// Press the Escape key inside the Zattoo page (go back / close overlay).
    pub fn press_escape() -> String {
        r#"
        (function() {
            try {
                document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                return JSON.stringify({ success: true, action: 'press_escape', message: 'Escape pressed' });
            } catch(e) {
                return JSON.stringify({ success: false, action: 'press_escape', message: e.message });
            }
        })()
        "#.to_string()
    }

    /// Get current channel info from the page.
    pub fn get_current_channel_info() -> String {
        r#"
        (function() {
            try {
                const info = {
                    title: document.title || '',
                    channelName: '',
                    channelNumber: '',
                    currentShow: '',
                    url: window.location.href
                };

                // Try to extract channel name from various selectors
                const channelSelectors = [
                    '.channel-name', '.channel-title', '[data-testid="channel-name"]',
                    '.current-channel', '.player-channel-info h2', '.player-channel-info h1'
                ];
                for (const sel of channelSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.textContent) {
                        info.channelName = el.textContent.trim();
                        break;
                    }
                }

                // Try to extract current show
                const showSelectors = [
                    '.current-show', '.program-title', '[data-testid="program-title"]',
                    '.player-program-info h3', '.epg-current-title'
                ];
                for (const sel of showSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.textContent) {
                        info.currentShow = el.textContent.trim();
                        break;
                    }
                }

                return JSON.stringify(info);
            } catch(e) {
                return JSON.stringify({ error: e.message });
            }
        })()
        "#.to_string()
    }
}

/// Tauri command: Execute a JavaScript snippet in the Zattoo webview.
#[tauri::command]
pub async fn execute_zattoo_action(
    app: tauri::AppHandle,
    action: String,
    param: Option<String>,
) -> Result<String, String> {
    let script = match action.as_str() {
        "send_key" => {
            let key = param.unwrap_or_default();
            zattoo_scripts::send_key(&key)
        }
        "click_selector" => {
            let selector = param.unwrap_or_default();
            zattoo_scripts::click_selector(&selector)
        }
        "click_by_text" => {
            let text = param.unwrap_or_default();
            zattoo_scripts::click_by_text(&text)
        }
        "change_channel" => {
            let channel = param.unwrap_or_default();
            zattoo_scripts::change_channel(&channel)
        }
        "toggle_play_pause" => zattoo_scripts::toggle_play_pause(),
        "seek" => {
            let seconds: i32 = param.unwrap_or_default().parse().unwrap_or(0);
            zattoo_scripts::seek(seconds)
        }
        "open_epg" => zattoo_scripts::open_epg(),
        "focus_search" => zattoo_scripts::focus_search(),
        "press_escape" => zattoo_scripts::press_escape(),
        "get_channel_info" => zattoo_scripts::get_current_channel_info(),
        _ => return Err(format!("Unknown action: {}", action)),
    };

    // Execute the script in the main webview window
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    window
        .eval(&script)
        .map_err(|e| format!("Eval error: {}", e))?;

    Ok(format!("Action '{}' executed", action))
}

/// Tauri command: Navigate the Zattoo webview to a specific URL.
#[tauri::command]
pub async fn navigate_zattoo(
    app: tauri::AppHandle,
    url: String,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    window
        .eval(&format!("window.location.href = '{}'", url))
        .map_err(|e| format!("Navigation error: {}", e))
}

/// Tauri command: Change system volume on the host OS.
#[tauri::command]
pub async fn set_system_volume(
    app: tauri::AppHandle,
    volume_percent: u8,
) -> Result<(), String> {
    let vol = volume_percent.min(100);

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        // Use pactl for PulseAudio (most common on Linux desktops)
        let result = Command::new("pactl")
            .args([
                "set-sink-volume",
                "@DEFAULT_SINK@",
                &format!("{}%", vol),
            ])
            .output();

        if result.is_err() {
            // Fallback to amixer
            let _ = Command::new("amixer")
                .args(["set", "Master", &format!("{}%", vol)])
                .output();
        }
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let _ = Command::new("osascript")
            .arg("-e")
            .arg(format!("set volume output volume {}", vol))
            .output();
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // Use PowerShell to set volume on Windows
        let script = format!(
            "(New-Object -ComObject WScript.Shell).SendKeys([char]{{}})",
            if vol > 50 { 175 } else { 174 } // Volume up/down keys
        );
        let _ = Command::new("powershell")
            .args(["-Command", &script])
            .output();
    }

    let _ = app; // suppress unused warning
    Ok(())
}

/// Tauri command: Toggle mute on the host OS.
#[tauri::command]
pub async fn toggle_system_mute(
    app: tauri::AppHandle,
) -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let _ = Command::new("pactl")
            .args(["set-sink-mute", "@DEFAULT_SINK@", "toggle"])
            .output();
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let _ = Command::new("osascript")
            .arg("-e")
            .arg("set volume with output muted")
            .output();
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let _ = Command::new("powershell")
            .args(["-Command", "(New-Object -ComObject WScript.Shell).SendKeys([char]{173})"])
            .output();
    }

    let _ = app;
    Ok(true) // Best-effort; actual mute state would require platform-specific APIs
}
