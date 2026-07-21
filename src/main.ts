/**
 * Zattoo Remote — Main entry point for the frontend application.
 *
 * Initializes the Zattoo bridge, sets up the webview iframe
 * for loading Zattoo, and manages application state.
 */

import { initZattooBridge } from "./zattoo-bridge";
import { invoke } from "@tauri-apps/api/core";

// ── DOM Elements ────────────────────────────────────────────────────

const zattooFrame = document.getElementById(
  "zattoo-frame"
) as HTMLIFrameElement | null;

// ── Application Setup ───────────────────────────────────────────────

async function initApp(): Promise<void> {
  console.log("[Zattoo Remote] Starting application...");

  // Show a loading indicator
  showStatus("Loading Zattoo...");

  // Initialize the bridge for remote key handling
  await initZattooBridge();

  // Set up window event listeners
  setupWindowControls();

  // Hide loading, show ready state
  hideStatus();
  console.log("[Zattoo Remote] Application ready");
}

// ── Window Controls ─────────────────────────────────────────────────

function setupWindowControls(): void {
  // On load, ensure we can receive focus for keyboard events
  window.addEventListener("load", () => {
    document.body.focus();
  });

  // Click-to-focus to ensure keyboard events work
  document.body.addEventListener("click", () => {
    document.body.focus();
  });

  // Handle keyboard shortcuts that should go to the app, not Zattoo
  document.addEventListener("keydown", (e) => {
    // Ctrl+Q or Alt+F4 to quit
    if ((e.ctrlKey || e.metaKey) && e.key === "q") {
      e.preventDefault();
      invoke("set_input_active", { active: false });
      window.close();
    }

    // F11 or Ctrl+Shift+F for fullscreen toggle
    if (e.key === "F11" || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "f")) {
      e.preventDefault();
      toggleFullscreen();
    }
  });
}

async function toggleFullscreen(): Promise<void> {
  try {
    // Use Tauri's window API for fullscreen
    const { getCurrentWindow } = await import(
      "@tauri-apps/api/window"
    );
    const win = getCurrentWindow();
    const isFullscreen = await win.isFullscreen();
    await win.setFullscreen(!isFullscreen);
  } catch (err) {
    console.error("Failed to toggle fullscreen:", err);
  }
}

// ── Status Display ──────────────────────────────────────────────────

function showStatus(message: string): void {
  const statusEl = document.getElementById("app-status");
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.classList.remove("hidden");
  }
}

function hideStatus(): void {
  const statusEl = document.getElementById("app-status");
  if (statusEl) {
    statusEl.classList.add("hidden");
  }
}

// ── Start ───────────────────────────────────────────────────────────

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
