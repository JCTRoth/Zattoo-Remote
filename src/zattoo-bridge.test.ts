/**
 * Tests for zattoo-bridge.ts — the core remote control logic.
 *
 * Tests:
 * - Key event routing (digit, color, action, default)
 * - Channel input digit buffer + timeout
 * - OSD display functions
 * - Volume control
 * - Mouse mode toggle
 * - Tauri invoke integration
 * - Edge cases (null config, missing DOM elements)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { __test__ as bridge } from "./zattoo-bridge";
import {
  setInvokeHandler,
  resetInvokeHandler,
  emitMockEvent,
  clearMockListeners,
} from "./__mocks__/tauri-api";
import type { KeyMappingConfig } from "./zattoo-bridge";

// ── Helpers ───────────────────────────────────────────────────────

/** Create a minimal valid key mapping config for tests. */
function makeTestConfig(overrides: Partial<KeyMappingConfig> = {}): KeyMappingConfig {
  return {
    version: "1.0",
    channel_input_timeout_ms: 500,
    volume_step: 5,
    mappings: [
      { key: "UpArrow", action: "channel_up", label: "CH+", zattoo_action: "send_key:PageUp" },
      { key: "DownArrow", action: "channel_down", label: "CH-", zattoo_action: "send_key:PageDown" },
      { key: "Return", action: "ok", label: "OK", zattoo_action: "send_key:Enter" },
      { key: "Escape", action: "back", label: "Back", zattoo_action: "press_escape" },
      { key: "LeftArrow", action: "left", label: "Left", zattoo_action: "send_key:ArrowLeft" },
      { key: "RightArrow", action: "right", label: "Right", zattoo_action: "send_key:ArrowRight" },
      { key: "Space", action: "play_pause", label: "Play/Pause", zattoo_action: "toggle_play_pause" },
      { key: "F5", action: "rewind", label: "Rewind", zattoo_action: "seek:-15" },
      { key: "F6", action: "fast_forward", label: "FF", zattoo_action: "seek:15" },
      { key: "F7", action: "stop", label: "Stop", zattoo_action: "press_escape" },
      { key: "Num0", action: "digit_0", label: "0", zattoo_action: null },
      { key: "Num1", action: "digit_1", label: "1", zattoo_action: null },
      { key: "Num2", action: "digit_2", label: "2", zattoo_action: null },
      { key: "Num3", action: "digit_3", label: "3", zattoo_action: null },
      { key: "Num4", action: "digit_4", label: "4", zattoo_action: null },
      { key: "Num5", action: "digit_5", label: "5", zattoo_action: null },
      { key: "Num6", action: "digit_6", label: "6", zattoo_action: null },
      { key: "Num7", action: "digit_7", label: "7", zattoo_action: null },
      { key: "Num8", action: "digit_8", label: "8", zattoo_action: null },
      { key: "Num9", action: "digit_9", label: "9", zattoo_action: null },
      { key: "F1", action: "color_red", label: "Red", zattoo_action: null },
      { key: "F2", action: "color_green", label: "Green", zattoo_action: null },
      { key: "F3", action: "color_yellow", label: "Yellow", zattoo_action: null },
      { key: "F4", action: "color_blue", label: "Blue", zattoo_action: null },
      { key: "Alt", action: "home", label: "Home", zattoo_action: "navigate:/live" },
      { key: "ShiftRight", action: "menu", label: "EPG", zattoo_action: "open_epg" },
      { key: "ControlRight", action: "search", label: "Search", zattoo_action: "focus_search" },
      { key: "PageUp", action: "channel_up", label: "CH+", zattoo_action: "send_key:PageUp" },
      { key: "PageDown", action: "channel_down", label: "CH-", zattoo_action: "send_key:PageDown" },
      { key: "Backspace", action: "back", label: "Back", zattoo_action: "press_escape" },
    ],
    favorites: [
      { name: "ZDF", channel: "ZDF", color: "red" },
      { name: "Das Erste", channel: "Das Erste", color: "green" },
      { name: "RTL", channel: "RTL", color: "yellow" },
      { name: "ProSieben", channel: "ProSieben", color: "blue" },
    ],
    ...overrides,
  };
}

/** Create OSD DOM elements that the bridge needs. */
function setupOsdDom(): void {
  document.body.innerHTML = `
    <div id="osd-overlay">
      <div id="osd-channel"></div>
      <div id="osd-favorite"></div>
    </div>
    <div id="osd-volume">
      <div id="osd-volume-bar"></div>
    </div>
    <div id="channel-input-overlay" class="hidden">
      <div id="channel-input-digits"></div>
      <div id="channel-input-progress"></div>
    </div>
  `;
}

// ── Setup & Teardown ─────────────────────────────────────────────

beforeEach(() => {
  bridge.resetState();
  bridge.setConfig(makeTestConfig());
  setupOsdDom();
  setInvokeHandler((cmd, args) => {
    return `ok: ${cmd}`;
  });
});

afterEach(() => {
  resetInvokeHandler();
  clearMockListeners();
  vi.useRealTimers();
});

// ── Digit / Channel Input Tests ──────────────────────────────────

describe("Digit key handling", () => {
  it("should append digit to channel input buffer", () => {
    bridge.handleDigitKey("digit_1");
    expect(bridge.getChannelInputBuffer()).toBe("1");

    bridge.handleDigitKey("digit_2");
    expect(bridge.getChannelInputBuffer()).toBe("12");

    bridge.handleDigitKey("digit_5");
    expect(bridge.getChannelInputBuffer()).toBe("125");
  });

  it("should show channel input overlay when digit is pressed", () => {
    bridge.handleDigitKey("digit_1");
    const overlay = document.getElementById("channel-input-overlay");
    expect(overlay?.classList.contains("hidden")).toBe(false);
    expect(document.getElementById("channel-input-digits")?.textContent).toBe("1");
  });

  it("should confirm channel after timeout", async () => {
    vi.useFakeTimers();
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleDigitKey("digit_1");
    bridge.handleDigitKey("digit_2");

    // Advance past the timeout (500ms)
    vi.advanceTimersByTime(600);

    expect(bridge.getChannelInputBuffer()).toBe("");
    // Should have called execute_zattoo_action for channel change
    expect(invokeCalls.length).toBeGreaterThanOrEqual(1);
    const channelCall = invokeCalls.find(([cmd]) => cmd === "execute_zattoo_action");
    expect(channelCall).toBeDefined();
    expect(channelCall![1]).toEqual({ action: "change_channel", param: "12" });
    vi.useRealTimers();
  });

  it("should hide channel input overlay after confirmation", () => {
    vi.useFakeTimers();
    bridge.handleDigitKey("digit_9");
    vi.advanceTimersByTime(600);
    const overlay = document.getElementById("channel-input-overlay");
    expect(overlay?.classList.contains("hidden")).toBe(true);
    vi.useRealTimers();
  });

  it("should reset timer on each new digit", () => {
    vi.useFakeTimers();
    bridge.handleDigitKey("digit_1");
    vi.advanceTimersByTime(300);
    bridge.handleDigitKey("digit_2"); // resets timer
    vi.advanceTimersByTime(300);
    // Buffer should still have "12" (not yet confirmed)
    expect(bridge.getChannelInputBuffer()).toBe("12");
    vi.advanceTimersByTime(300);
    expect(bridge.getChannelInputBuffer()).toBe("");
    vi.useRealTimers();
  });
});

// ── Color / Favorite Key Tests ────────────────────────────────────

describe("Color key handling", () => {
  it("should trigger favorite channel change", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleColorKey("color_red");
    const channelCall = invokeCalls.find(([cmd]) => cmd === "execute_zattoo_action");
    expect(channelCall).toBeDefined();
    expect(channelCall![1]).toEqual({ action: "change_channel", param: "ZDF" });
  });

  it("should show favorite name in OSD", () => {
    bridge.handleColorKey("color_green");
    const favOsd = document.getElementById("osd-favorite");
    expect(favOsd?.textContent).toContain("Das Erste");
    expect(favOsd?.classList.contains("visible")).toBe(true);
  });

  it("should do nothing for unknown color", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleColorKey("color_purple"); // no such favorite
    // Should not trigger execute_zattoo_action
    const channelCalls = invokeCalls.filter(
      ([cmd]) => cmd === "execute_zattoo_action"
    );
    expect(channelCalls.length).toBe(0);
  });
});

// ── Action Key Tests ──────────────────────────────────────────────

describe("Action key handling", () => {
  it("should send ArrowUp for 'up' action", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("up");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "send_key", param: "ArrowUp" },
    ]);
  });

  it("should send ArrowDown for 'down' action", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("down");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "send_key", param: "ArrowDown" },
    ]);
  });

  it("should send ArrowLeft for 'left' action", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("left");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "send_key", param: "ArrowLeft" },
    ]);
  });

  it("should send ArrowRight for 'right' action", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("right");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "send_key", param: "ArrowRight" },
    ]);
  });

  it("should send Enter for 'ok' action", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("ok");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "send_key", param: "Enter" },
    ]);
  });

  it("should press escape for 'back' action", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("back");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "press_escape", param: null },
    ]);
  });

  it("should toggle play/pause", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("play_pause");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "toggle_play_pause", param: null },
    ]);
  });

  it("should seek -15s for rewind", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("rewind");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "seek", param: "-15" },
    ]);
  });

  it("should seek +15s for fast_forward", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("fast_forward");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "seek", param: "15" },
    ]);
  });

  it("should navigate to /live for home", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("home");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "navigate", param: "/live" },
    ]);
  });

  it("should open EPG for menu", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("menu");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "open_epg", param: null },
    ]);
  });

  it("should focus search for search action", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("search");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "focus_search", param: null },
    ]);
  });

  it("should use zattoo_action from mapping for channel_up", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("channel_up");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "send_key", param: "PageUp" },
    ]);
  });

  it("should handle unknown actions via mapping fallback", () => {
    // Add a custom mapping
    bridge.setConfig(
      makeTestConfig({
        mappings: [
          ...makeTestConfig().mappings,
          {
            key: "F10",
            action: "guide",
            label: "Guide",
            zattoo_action: "navigate_guide",
          },
        ],
      })
    );

    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("guide");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "navigate_guide", param: null },
    ]);
  });

  it("should do nothing for completely unknown actions", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("nonexistent_action");
    // Should not call execute_zattoo_action
    const actionCalls = invokeCalls.filter(
      ([cmd]) => cmd === "execute_zattoo_action"
    );
    expect(actionCalls.length).toBe(0);
  });
});

// ── Volume Control Tests ──────────────────────────────────────────

describe("Volume control", () => {
  it("should increase volume by configured step", () => {
    bridge.setVolumeLevel(50);
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("volume_up");
    expect(bridge.getVolumeLevel()).toBe(55);
    expect(invokeCalls).toContainEqual([
      "set_system_volume",
      { volumePercent: 55 },
    ]);
  });

  it("should decrease volume by configured step", () => {
    bridge.setVolumeLevel(50);
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("volume_down");
    expect(bridge.getVolumeLevel()).toBe(45);
    expect(invokeCalls).toContainEqual([
      "set_system_volume",
      { volumePercent: 45 },
    ]);
  });

  it("should not exceed 100% volume", () => {
    bridge.setVolumeLevel(98);
    bridge.handleActionKey("volume_up");
    expect(bridge.getVolumeLevel()).toBe(100);
  });

  it("should not go below 0% volume", () => {
    bridge.setVolumeLevel(3);
    bridge.handleActionKey("volume_down");
    expect(bridge.getVolumeLevel()).toBe(0);
  });

  it("should toggle mute", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleActionKey("mute");
    expect(invokeCalls).toContainEqual(["toggle_system_mute", undefined]);
  });

  it("should show volume OSD", () => {
    bridge.handleActionKey("volume_up");
    const volOsd = document.getElementById("osd-volume");
    expect(volOsd?.classList.contains("visible")).toBe(true);
  });
});

// ── Mouse Mode Toggle Tests ──────────────────────────────────────

describe("Mouse mode", () => {
  it("should toggle mouse mode on", () => {
    expect(bridge.getMouseModeActive()).toBe(false);
    bridge.handleActionKey("mouse_mode");
    expect(bridge.getMouseModeActive()).toBe(true);
  });

  it("should toggle mouse mode off", () => {
    bridge.handleActionKey("mouse_mode"); // on
    bridge.handleActionKey("mouse_mode"); // off
    expect(bridge.getMouseModeActive()).toBe(false);
  });

  it("should show OSD for mouse mode", () => {
    bridge.handleActionKey("mouse_mode");
    const osdEl = document.getElementById("osd-channel");
    expect(osdEl?.textContent).toContain("Mouse Mode");
  });
});

// ── OSD Display Tests ────────────────────────────────────────────

describe("OSD display", () => {
  it("should show text in OSD channel element", () => {
    bridge.showOsd("Test Label");
    const osd = document.getElementById("osd-channel");
    expect(osd?.textContent).toBe("Test Label");
    expect(osd?.classList.contains("visible")).toBe(true);
  });

  it("should hide OSD after timeout", () => {
    vi.useFakeTimers();
    bridge.showOsd("Test");
    vi.advanceTimersByTime(1600);
    const osd = document.getElementById("osd-channel");
    expect(osd?.classList.contains("visible")).toBe(false);
    vi.useRealTimers();
  });

  it("should show volume OSD with correct bar width", () => {
    bridge.showOsdVolume(75);
    const bar = document.getElementById("osd-volume-bar");
    expect(bar?.style.width).toBe("75%");
  });

  it("should gracefully handle missing DOM elements", () => {
    document.body.innerHTML = ""; // Remove all DOM
    // These should not throw
    expect(() => bridge.showOsd("test")).not.toThrow();
    expect(() => bridge.showOsdVolume(50)).not.toThrow();
    expect(() => bridge.showOsdFavorite("ZDF")).not.toThrow();
    expect(() => bridge.showChannelInput("12")).not.toThrow();
    expect(() => bridge.hideChannelInput()).not.toThrow();
  });
});

// ── Key Event Routing Tests ──────────────────────────────────────

describe("handleKeyPress routing", () => {
  it("should route digit_* actions to handleDigitKey", () => {
    bridge.handleKeyPress({
      action: "digit_3",
      label: "3",
      scan_code: 4,
      is_press: true,
    });
    expect(bridge.getChannelInputBuffer()).toBe("3");
  });

  it("should route color_* actions to handleColorKey", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleKeyPress({
      action: "color_red",
      label: "Red",
      scan_code: 59,
      is_press: true,
    });
    const channelCall = invokeCalls.find(([cmd]) => cmd === "execute_zattoo_action");
    expect(channelCall![1]).toEqual({ action: "change_channel", param: "ZDF" });
  });

  it("should route other actions to handleActionKey", () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    bridge.handleKeyPress({
      action: "ok",
      label: "OK",
      scan_code: 28,
      is_press: true,
    });
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "send_key", param: "Enter" },
    ]);
  });

  it("should ignore key-up events (is_press: false)", () => {
    bridge.handleKeyPress({
      action: "digit_5",
      label: "5",
      scan_code: 6,
      is_press: false,
    });
    // Buffer should remain empty because we ignore key-up
    expect(bridge.getChannelInputBuffer()).toBe("");
  });

  it("should show OSD label for every key press", () => {
    bridge.handleKeyPress({
      action: "channel_up",
      label: "CH+",
      scan_code: 103,
      is_press: true,
    });
    const osd = document.getElementById("osd-channel");
    expect(osd?.textContent).toBe("CH+");
  });
});

// ── Tauri Command Tests ──────────────────────────────────────────

describe("Tauri command execution", () => {
  it("should call execute_zattoo_action with correct params", async () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    await bridge.executeZattooAction("send_key", "PageUp");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "send_key", param: "PageUp" },
    ]);
  });

  it("should handle null param", async () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    await bridge.executeZattooAction("press_escape");
    expect(invokeCalls).toContainEqual([
      "execute_zattoo_action",
      { action: "press_escape", param: null },
    ]);
  });

  it("should not throw on invoke failure", async () => {
    setInvokeHandler(() => {
      throw new Error("Simulated failure");
    });

    // Should not throw — errors are caught internally
    await expect(
      bridge.executeZattooAction("send_key", "Enter")
    ).resolves.toBeUndefined();
  });
});
