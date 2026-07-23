/**
 * Mocks for @tauri-apps/api modules.
 * These provide in-memory implementations for testing without a real Tauri runtime.
 */

import { vi } from "vitest";

// ── invoke (core) ─────────────────────────────────────────────────

type InvokeHandler = (cmd: string, args?: Record<string, unknown>) => unknown;

let invokeHandler: InvokeHandler | null = null;

/** Set a custom handler for `invoke` calls during testing. */
export function setInvokeHandler(handler: InvokeHandler) {
  invokeHandler = handler;
}

export function resetInvokeHandler() {
  invokeHandler = null;
}

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (invokeHandler) {
    return invokeHandler(cmd, args) as T;
  }
  throw new Error(
    `Tauri invoke("${cmd}") called without a mock handler. Use setInvokeHandler() in your test.`
  );
}

// ── listen (event) ────────────────────────────────────────────────

type EventCallback<T> = (event: { payload: T }) => void;
type UnlistenFn = () => void;

interface RegisteredListener {
  event: string;
  callback: EventCallback<unknown>;
}

const listeners: RegisteredListener[] = [];

export async function listen<T>(
  event: string,
  callback: EventCallback<T>
): Promise<UnlistenFn> {
  const entry: RegisteredListener = {
    event,
    callback: callback as EventCallback<unknown>,
  };
  listeners.push(entry);
  return () => {
    const idx = listeners.indexOf(entry);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/** Simulate a Tauri event being emitted. Only used in tests. */
export function emitMockEvent(event: string, payload: unknown): void {
  for (const l of listeners) {
    if (l.event === event) {
      l.callback({ payload });
    }
  }
}

/** Clear all registered listeners. */
export function clearMockListeners(): void {
  listeners.length = 0;
}

// ── Window API ────────────────────────────────────────────────────

let mockFullscreen = false;

export function getCurrentWindow() {
  return {
    isFullscreen: async () => mockFullscreen,
    setFullscreen: async (val: boolean) => {
      mockFullscreen = val;
    },
  };
}

export function resetWindowMock() {
  mockFullscreen = false;
}

// ── Re-export vi for convenience ──────────────────────────────────
export { vi };
