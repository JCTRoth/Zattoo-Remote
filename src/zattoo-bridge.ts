/**
 * ZattooBridge — Communication layer between the Rust backend and Zattoo webview.
 *
 * Listens for remote key events emitted from the Rust input handler,
 * translates them into Zattoo DOM actions, and manages OSD display.
 */

import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

// ── Types ──────────────────────────────────────────────────────────

interface RemoteKeyEvent {
  action: string;
  label: string;
  scan_code: number;
  is_press: boolean;
}

interface KeyMappingConfig {
  version: string;
  channel_input_timeout_ms: number;
  volume_step: number;
  mappings: KeyMappingEntry[];
  favorites: FavoriteChannel[];
}

interface KeyMappingEntry {
  key: string;
  action: string;
  label: string;
  zattoo_action: string | null;
}

interface FavoriteChannel {
  name: string;
  channel: string;
  color: string;
}

// ── State ───────────────────────────────────────────────────────────

let channelInputBuffer = "";
let channelInputTimer: ReturnType<typeof setTimeout> | null = null;
let config: KeyMappingConfig | null = null;
let volumeLevel = 50; // 0-100
let mouseModeActive = false;

// ── Initialization ──────────────────────────────────────────────────

export async function initZattooBridge(): Promise<void> {
  console.log("[ZattooBridge] Initializing...");

  // Load key mapping config
  try {
    const mappingJson = await invoke<string>("get_key_mapping_json");
    config = JSON.parse(mappingJson);
    console.log("[ZattooBridge] Key mapping loaded:", config?.mappings.length ?? 0, "entries");
  } catch (err) {
    console.error("[ZattooBridge] Failed to load key mapping:", err);
    // Load from bundled default
    const response = await fetch("/src/key-config.json");
    config = await response.json();
  }

  // Enable input capture
  await invoke("set_input_active", { active: true });

  // Listen for remote key events from Rust backend
  await listen<string>("remote-key-event", (event) => {
    try {
      const keyEvent: RemoteKeyEvent = JSON.parse(event.payload);
      if (keyEvent.is_press) {
        handleKeyPress(keyEvent);
      }
    } catch (err) {
      console.error("[ZattooBridge] Failed to parse key event:", err);
    }
  });

  console.log("[ZattooBridge] Ready — listening for remote input");
}

// ── Key Handler ─────────────────────────────────────────────────────

function handleKeyPress(event: RemoteKeyEvent): void {
  const { action, label, is_press } = event;

  // Defensive: ignore key-up events (the event listener already filters,
  // but this provides defense-in-depth if handleKeyPress is called directly)
  if (!is_press) return;

  console.log(`[ZattooBridge] Key: ${action} (${label})`);

  // Show OSD label
  showOsd(label);

  // Dispatch based on action type
  if (action.startsWith("digit_")) {
    handleDigitKey(action);
  } else if (action.startsWith("color_")) {
    handleColorKey(action);
  } else {
    handleActionKey(action);
  }
}

// ── Digit / Channel Input ───────────────────────────────────────────

function handleDigitKey(action: string): void {
  const digit = action.replace("digit_", "");
  channelInputBuffer += digit;

  // Show channel input overlay
  showChannelInput(channelInputBuffer);

  // Reset the confirmation timer
  if (channelInputTimer) clearTimeout(channelInputTimer);

  const timeout = config?.channel_input_timeout_ms ?? 2000;
  channelInputTimer = setTimeout(() => {
    confirmChannel();
  }, timeout);
}

function confirmChannel(): void {
  if (channelInputBuffer.length === 0) return;

  const channel = channelInputBuffer;
  console.log(`[ZattooBridge] Changing to channel: ${channel}`);
  channelInputBuffer = "";
  hideChannelInput();

  // Send channel change to Zattoo webview
  executeZattooAction("change_channel", channel);
}

function showChannelInput(digits: string): void {
  const overlay = document.getElementById("channel-input-overlay");
  const digitsEl = document.getElementById("channel-input-digits");
  const progressEl = document.getElementById("channel-input-progress");

  if (overlay && digitsEl && progressEl) {
    overlay.classList.remove("hidden");
    digitsEl.textContent = digits;

    // Show progress bar that shrinks toward timeout
    const timeout = config?.channel_input_timeout_ms ?? 2000;
    progressEl.style.transition = "none";
    progressEl.style.width = "100%";
    // Force reflow
    void progressEl.offsetWidth;
    progressEl.style.transition = `width ${timeout}ms linear`;
    progressEl.style.width = "0%";
  }
}

function hideChannelInput(): void {
  const overlay = document.getElementById("channel-input-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
  }
}

// ── Color / Favorite Keys ───────────────────────────────────────────

function handleColorKey(action: string): void {
  const color = action.replace("color_", "");
  const favorite = config?.favorites.find(
    (f) => f.color.toLowerCase() === color
  );

  if (favorite) {
    console.log(`[ZattooBridge] Favorite: ${favorite.name} → ${favorite.channel}`);
    showOsdFavorite(favorite.name);
    executeZattooAction("change_channel", favorite.channel);
  }
}

// ── Action Keys ─────────────────────────────────────────────────────

function handleActionKey(action: string): void {
  // Find the mapping entry for this action
  const entry = config?.mappings.find((m) => m.action === action);

  switch (action) {
    // Navigation — forward as keyboard events to Zattoo
    case "up":
      executeZattooAction("send_key", "ArrowUp");
      break;
    case "down":
      executeZattooAction("send_key", "ArrowDown");
      break;
    case "left":
      executeZattooAction("send_key", "ArrowLeft");
      break;
    case "right":
      executeZattooAction("send_key", "ArrowRight");
      break;
    case "ok":
      executeZattooAction("send_key", "Enter");
      break;
    case "back":
      executeZattooAction("press_escape");
      break;

    // Playback
    case "play_pause":
      executeZattooAction("toggle_play_pause");
      break;
    case "rewind":
      executeZattooAction("seek", "-15");
      break;
    case "fast_forward":
      executeZattooAction("seek", "15");
      break;
    case "stop":
      executeZattooAction("press_escape");
      break;

    // Channel up/down
    case "channel_up":
      executeZattooAction("send_key", "PageUp");
      break;
    case "channel_down":
      executeZattooAction("send_key", "PageDown");
      break;

    // Volume (system-level)
    case "volume_up":
      volumeLevel = Math.min(100, volumeLevel + (config?.volume_step ?? 5));
      showOsdVolume(volumeLevel);
      invoke("set_system_volume", { volumePercent: volumeLevel });
      break;
    case "volume_down":
      volumeLevel = Math.max(0, volumeLevel - (config?.volume_step ?? 5));
      showOsdVolume(volumeLevel);
      invoke("set_system_volume", { volumePercent: volumeLevel });
      break;
    case "mute":
      invoke("toggle_system_mute");
      showOsd("🔇 Mute");
      break;

    // Navigation
    case "home":
      executeZattooAction("navigate", "/live");
      break;
    case "menu":
      executeZattooAction("open_epg");
      break;
    case "search":
      executeZattooAction("focus_search");
      break;

    // Mouse mode
    case "mouse_mode":
      mouseModeActive = !mouseModeActive;
      showOsd(mouseModeActive ? "🖱 Mouse Mode ON" : "🖱 Mouse Mode OFF");
      break;

    default:
      // Try to use zattoo_action from the mapping
      if (entry?.zattoo_action) {
        const [zAction, zParam] = entry.zattoo_action.split(":");
        executeZattooAction(zAction, zParam || undefined);
      }
      break;
  }
}

// ── Zattoo Action Execution ─────────────────────────────────────────

async function executeZattooAction(action: string, param?: string): Promise<void> {
  try {
    const result = await invoke<string>("execute_zattoo_action", {
      action,
      param: param ?? null,
    });
    console.log(`[ZattooBridge] Action result:`, result);
  } catch (err) {
    console.error(`[ZattooBridge] Action '${action}' failed:`, err);
  }
}

// ── OSD Display ─────────────────────────────────────────────────────

let osdTimer: ReturnType<typeof setTimeout> | null = null;

function showOsd(text: string): void {
  const osd = document.getElementById("osd-channel");
  if (!osd) return;

  osd.textContent = text;
  osd.classList.add("visible");

  if (osdTimer) clearTimeout(osdTimer);
  osdTimer = setTimeout(() => {
    osd.classList.remove("visible");
  }, 1500);
}

function showOsdFavorite(name: string): void {
  const osd = document.getElementById("osd-favorite");
  if (!osd) return;

  osd.textContent = `⭐ ${name}`;
  osd.classList.add("visible");

  if (osdTimer) clearTimeout(osdTimer);
  osdTimer = setTimeout(() => {
    osd.classList.remove("visible");
  }, 1500);
}

function showOsdVolume(level: number): void {
  const osd = document.getElementById("osd-volume");
  const bar = document.getElementById("osd-volume-bar");
  if (!osd || !bar) return;

  bar.style.width = `${level}%`;
  osd.classList.add("visible");

  // Also show the numeric level
  const channelOsd = document.getElementById("osd-channel");
  if (channelOsd) {
    channelOsd.textContent = `🔊 ${level}%`;
    channelOsd.classList.add("visible");
  }

  if (osdTimer) clearTimeout(osdTimer);
  osdTimer = setTimeout(() => {
    osd.classList.remove("visible");
    if (channelOsd) channelOsd.classList.remove("visible");
  }, 1500);
}

// ── Test exports ──────────────────────────────────────────────────
// Exported for unit testing only. Not part of the public API.
export type { KeyMappingConfig, KeyMappingEntry, FavoriteChannel, RemoteKeyEvent };

export const __test__ = {
  handleKeyPress,
  handleDigitKey,
  handleColorKey,
  handleActionKey,
  confirmChannel,
  executeZattooAction,
  showOsd,
  showOsdFavorite,
  showOsdVolume,
  showChannelInput,
  hideChannelInput,
  getChannelInputBuffer: () => channelInputBuffer,
  getVolumeLevel: () => volumeLevel,
  getMouseModeActive: () => mouseModeActive,
  getConfig: () => config,
  resetState: () => {
    channelInputBuffer = "";
    if (channelInputTimer) clearTimeout(channelInputTimer);
    channelInputTimer = null;
    volumeLevel = 50;
    mouseModeActive = false;
    config = null;
    if (osdTimer) clearTimeout(osdTimer);
    osdTimer = null;
  },
  setConfig: (c: KeyMappingConfig) => {
    config = c;
  },
  setVolumeLevel: (v: number) => {
    volumeLevel = v;
  },
};
