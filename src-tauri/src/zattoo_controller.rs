//! System-level volume control commands.
//!
//! These Tauri commands are invoked from the injected overlay script via
//! `window.__TAURI__.core.invoke()` to adjust the host OS volume.
//! DOM interaction with Zattoo is handled entirely in `zattoo_inject.js`.

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
