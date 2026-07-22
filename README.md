# Zattoo Webview Wrapper for Remote Controls
A cross-platform **Tauri v2** desktop application that turns your **MX3-style remote** (or any keyboard) into a fully-featured remote control for [Zattoo](https://zattoo.com) live TV streaming.

> Built with Rust + JavaScript (injected) + Tauri v2

---

## Features

- **Global keyboard capture** — Works even when the app is in the background (uses `rdev` under the hood)
- **MX3 remote mapping** — Pre-configured for MX3 remotes with support for custom mappings
- **Zattoo webview integration** — Loads Zattoo directly in the Tauri webview (no iframe)
- **Channel number input** — Enter digits with on-screen display (OSD) and auto-confirm after 2s
- **Color key favorites** — Quick-access to your favourite channels via F1–F4 (Red/Green/Yellow/Blue)
- **System volume control** — Cross-platform volume up/down/mute (Linux: `pactl`/`amixer`, macOS: `osascript`, Windows: PowerShell)
- **On-screen display (OSD)** — Shows channel numbers, volume level, and favorite names
- **JS injection bridge** — Overlay is injected into the Zattoo page at runtime via `webview.eval()`
- **Mouse mode** — Toggle gyro mouse control (via keyboard shortcut)
- **Fullscreen/kiosk mode** — Borderless fullscreen for a TV-like experience
- **System tray** — Quick settings and quit access

### Default MX3 Key Layout

| MX3 Key | Function | Zattoo Action |
|---------|----------|---------------|
| Arrow keys | Navigation | Focus movement |
| OK / Enter | Confirm | Click / Enter |
| Back / Esc | Back | Escape key |
| Digits 0–9 | Channel input | Number buffer + confirm |
| Red (F1) | Favorite 1 | ZDF |
| Green (F2) | Favorite 2 | ARD |
| Yellow (F3) | Favorite 3 | RTL |
| Blue (F4) | Favorite 4 | ProSieben |
| Space | Play/Pause | Toggle playback |
| Page Up/Down | Channel up/down | Zapping |
| F5 / F6 | Rewind / FF | Skip ±15s |
| Alt | Home | Channel list |
| Right Shift | Menu/EPG | Program guide |
| Right Ctrl | Search | Focus search field |
| Volume keys | System volume | OS volume control |
| Insert | Mouse mode | Toggle gyro mouse |

> **Note:** Volume/media keys are detected via evdev scan codes (`Unknown(113–115)`) on Linux, and corresponding VK codes on Windows. If your remote uses different codes, check the debug log and update `src/key-config.json`.

---

## Prerequisites

### System Requirements

| Platform | Requirements |
|----------|-------------|
| **Linux** | X11 desktop (for `rdev`), `libwebkit2gtk-4.1`, `libgtk-3`, `libayatana-appindicator3` |
| **macOS** | macOS 10.15+, Accessibility permission (for global input capture) |
| **Windows** | Windows 10+, WebView2 runtime (included in Win10+) |

### Development Dependencies

- [Rust](https://rustup.rs/) (1.75+)
- [Node.js](https://nodejs.org/) (20+)
- npm (included with Node.js)

### Linux Extra Dependencies

```bash
# Fedora / RHEL
sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \
  openssl-devel librsvg2-devel

# Ubuntu / Debian
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  libssl-dev librsvg2-dev

# Arch
sudo pacman -S webkit2gtk-4.1 gtk3 libappindicator-gtk3
```

---

## Getting Started

### 1. Clone and install dependencies

```bash
cd zattoo-remote
npm install
```

### 2. Build and run

```bash
npm run tauri build
./src-tauri/target/release/zattoo-remote
```

> The app loads `https://zattoo.com` directly in the Tauri webview. No local frontend is served — all UI overlays are injected via Rust's `webview.eval()` at runtime.

### Development with hot-reload (frontend changes)

If you're modifying the injection script (`src-tauri/src/zattoo_inject.js`), rebuild after changes:

```bash
npm run tauri build
```

---

## Project Structure

```
zattoo-remote/
├── index.html                        # Fallback loading page (shown briefly before Zattoo)
├── package.json                      # Node.js dependencies & scripts
├── src-tauri/
│   ├── Cargo.toml                    # Rust dependencies
│   ├── tauri.conf.json               # Tauri app configuration (window → zattoo.com)
│   ├── capabilities/default.json     # Tauri v2 permissions
│   ├── build.rs
│   └── src/
│       ├── main.rs                   # Binary entry point
│       ├── lib.rs                    # App setup, state, event routing, overlay injection
│       ├── input_handler.rs          # rdev global keyboard listener
│       ├── key_mapper.rs             # Key mapping logic + favorites
│       ├── zattoo_controller.rs      # Volume control + Tauri commands
│       └── zattoo_inject.js          # Injected overlay JS (OSD, key handling, Zattoo DOM)
├── src/
│   ├── key-config.json               # Default MX3 key mapping (user-customizable)
│   ├── main.ts                       # Legacy — kept for reference
│   └── zattoo-bridge.ts              # Legacy — kept for reference
├── README.md
└── .gitignore
```

---

## Configuration

### Key Mapping

Edit `src/key-config.json` to customize key bindings. The file contains:

- `mappings` — Array of key-to-action mappings (see rdev `Key` enum variants)
- `favorites` — Channels assigned to color keys (F1–F4)
- `channel_input_timeout_ms` — How long to wait before auto-confirming digits (default: 2000)
- `volume_step` — Volume change increment in percent (default: 5)

The config is embedded at compile time. To reload after editing, rebuild with:

```bash
npm run tauri build
```

### rdev Key Names

All available key names are documented in the [rdev source](https://github.com/nicoulaj/rdev). Common ones:

`UpArrow`, `DownArrow`, `LeftArrow`, `RightArrow`, `Return`, `Escape`, `Backspace`,
`Num0`–`Num9` (top row), `Kp0`–`Kp9` (numpad), `F1`–`F12`, `Space`, `PageUp`, `PageDown`,
`Alt`, `ShiftRight`, `ControlRight`, `Insert`, `Unknown(scan_code)` (for unmapped keys).

### Platform-Specific Notes

#### Linux (X11)
- `rdev` uses X11 APIs — it will **not** work under pure Wayland
- For Wayland support, enable the `unstable_grab` feature in `rdev` (requires `evdev` and `input` group membership)
- Volume control uses `pactl` (PulseAudio) with fallback to `amixer` (ALSA)

#### macOS
- Grant **Accessibility** permission in System Settings → Privacy & Security → Accessibility
- Media keys may be intercepted by macOS — enable the app in System Settings → Keyboard → Keyboard Shortcuts → Media

#### Windows
- No special setup required
- Volume control uses PowerShell COM automation

---

## Troubleshooting

### "No variant found for enum Key"
The key names in `src/key-config.json` must match the `rdev::Key` enum. Run the app with `RUST_LOG=debug` to see which scan codes your remote sends:

```bash
RUST_LOG=debug npm run tauri dev
```

### Global input not working
- **Linux:** Ensure you're on X11, not Wayland. Run `echo $XDG_SESSION_TYPE` to check.
- **macOS:** Enable Accessibility permission for the app/terminal.
- **Windows:** No special permissions needed.

### Zattoo doesn't load or login fails (403 / DNS errors)

This was a common issue with the iframe-based approach — Zattoo blocks embedded content via `X-Frame-Options` and `SameSite` cookies, causing 403 errors on login.

**The app now loads Zattoo directly in the Tauri webview (no iframe).** This avoids frame-blocking entirely.

If you still see issues:
- **DNS resolution errors** (`geolocation.onetrust.com`, `sentry.io`, `zahs.tv`): These are Zattoo's third-party services (consent management, error tracking, analytics). They require internet access. Some may be blocked by firewalls, ad-blockers, or VPNs.
- **403 Forbidden on login**: Confirm your Zattoo account is active for your region. Some regions require a VPN.
- Check the CSP in `tauri.conf.json` — the policy must list all Zattoo subdomains the site connects to.

### Build fails
Ensure all system dependencies are installed (see [Prerequisites](#prerequisites) above).

```bash
# Clear cache and retry
rm -rf src-tauri/target node_modules/.vite-temp
npm run tauri build
```

---

## Development

### Architecture

```
┌─────────────────────────────────────────────────┐
│                    Tauri App                     │
│                                                  │
│  ┌──────────────┐    ┌──────────────────────┐   │
│  │  Rust Backend │    │  Zattoo Webview      │   │
│  │               │    │  (url: zattoo.com)   │   │
│  │ rdev Listener │───▶│       │              │   │
│  │   (global)    │    │       ▼              │   │
│  │               │    │  Injected Overlay    │   │
│  │ Key Mapper    │    │  (zattoo_inject.js)  │   │
│  │               │    │  - OSD display       │   │
│  │ Zattoo Inject │───▶│  - Key event handler │   │
│  │ (eval script) │    │  - DOM control       │   │
│  │               │    │  - Channel input     │   │
│  │ Volume Ctrl   │◀───│  - Volume control    │   │
│  └──────────────┘    └──────────────────────┘   │
└─────────────────────────────────────────────────┘
```

The app's flow:
1. Tauri launches and navigates the webview to `https://zattoo.com`
2. After a brief delay (letting Zattoo load), Rust injects `zattoo_inject.js` via `webview.eval()`
3. The injected script creates OSD overlays, sets up Tauri event listeners, and controls the Zattoo DOM
4. The rdev listener (running in a background thread) captures global keyboard input and emits events
5. The injected script receives these events and performs the corresponding Zattoo action
6. Volume control commands are sent back to Rust via `window.__TAURI__.core.invoke()`

### Adding new key mappings

1. Add the rdev `Key` variant to the mapping in `src/key-config.json`
2. If a custom DOM action is needed, add a handler case in `zattoo_inject.js` (the `zattooAction` function)
3. Rebuild with `npm run tauri build`

### Modifying the injected overlay

The entire overlay (OSD, key handling, Zattoo DOM control) lives in `src-tauri/src/zattoo_inject.js`. It's a self-contained IIFE that:
- Creates its own CSS and HTML elements dynamically
- Uses `window.__TAURI__` for IPC with Rust
- Handles all remote key events in a single switch statement
- Uses MutationObserver to survive SPA navigations within Zattoo

Edit this file, then rebuild.

---

## License

MIT
