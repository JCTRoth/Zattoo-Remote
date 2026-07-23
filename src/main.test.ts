/**
 * Tests for main.ts — the application entry point.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { setInvokeHandler, resetWindowMock } from "./__mocks__/tauri-api";

// ── Helpers ───────────────────────────────────────────────────────

function triggerKeydown(
  key: string,
  mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}
): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      ctrlKey: mods.ctrl ?? false,
      metaKey: mods.meta ?? false,
      shiftKey: mods.shift ?? false,
      bubbles: true,
      cancelable: true,
    })
  );
}

// ── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  setInvokeHandler((cmd) => {
    if (cmd === "get_key_mapping_json") {
      return JSON.stringify({
        version: "1.0",
        channel_input_timeout_ms: 2000,
        volume_step: 5,
        mappings: [],
        favorites: [],
      });
    }
    if (cmd === "set_input_active") return null;
    if (cmd === "execute_zattoo_action") return "ok";
    return "ok";
  });

  document.body.innerHTML =
    '<div id="app-status" class="hidden">Loading...</div><iframe id="zattoo-frame"></iframe>';
  resetWindowMock();
});

// ── Tests ──────────────────────────────────────────────────────────

describe("Application initialization", () => {
  it("should hide loading status after init completes", async () => {
    await import("./main");
    const statusEl = document.getElementById("app-status");
    await vi.waitFor(() => {
      expect(statusEl?.classList.contains("hidden")).toBe(true);
    });
  });
});

describe("Window controls — Ctrl+Q", () => {
  it("should call set_input_active(false) on Ctrl+Q", async () => {
    const invokeCalls: [string, unknown][] = [];
    setInvokeHandler((cmd, args) => {
      invokeCalls.push([cmd, args]);
      return "ok";
    });

    await import("./main");

    await vi.waitFor(() => {
      triggerKeydown("q", { ctrl: true });
      expect(invokeCalls).toContainEqual(["set_input_active", { active: false }]);
      expect(window.close).toHaveBeenCalled();
    });
  });

  it("should prevent default on Ctrl+Q", async () => {
    await import("./main");

    await vi.waitFor(() => {
      const event = new KeyboardEvent("keydown", {
        key: "q",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");
      document.dispatchEvent(event);
      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });
});

describe("Window controls — Fullscreen", () => {
  it("should toggle fullscreen on F11", async () => {
    await import("./main");
    await vi.waitFor(async () => {
      triggerKeydown("F11");
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      expect(await getCurrentWindow().isFullscreen()).toBe(true);
    });
  });

  it("should toggle fullscreen off on second F11", async () => {
    await import("./main");
    await vi.waitFor(async () => {
      triggerKeydown("F11");
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      expect(await getCurrentWindow().isFullscreen()).toBe(false);
    });
  });

  it("should NOT toggle fullscreen on Ctrl+F without Shift", async () => {
    await import("./main");
    await vi.waitFor(() => {
      triggerKeydown("f", { ctrl: true });
    }).then(async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      expect(await getCurrentWindow().isFullscreen()).toBe(false);
    });
  });
});

describe("Window controls — Click-to-focus", () => {
  it("should focus body on click", async () => {
    await import("./main");
    await vi.waitFor(() => {
      const focusSpy = vi.spyOn(document.body, "focus").mockImplementation(() => {});
      document.body.click();
      expect(focusSpy).toHaveBeenCalled();
    });
  });
});
