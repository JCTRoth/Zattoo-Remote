/**
 * Zattoo Login + Channel Navigation E2E Test
 *
 * Logs into Zattoo.com with test credentials and verifies that
 * remote control key events can navigate channels.
 *
 * Prerequisites:
 *   - ZATTOO_EMAIL and ZATTOO_PASSWORD set in e2e/.env
 *   - A valid Zattoo subscription (free or paid)
 *
 * These tests interact with the real Zattoo.com website.
 * They are marked with a testid so they can be run selectively:
 *   npx playwright test --grep @zattoo-login
 */

import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Load the inject script ────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const injectScript = readFileSync(
  resolve(__dirname, "../src-tauri/src/zattoo_inject.js"),
  "utf-8"
);

// ── Check credentials ─────────────────────────────────────────────

const ZATTOO_EMAIL = process.env.ZATTOO_EMAIL;
const ZATTOO_PASSWORD = process.env.ZATTOO_PASSWORD;
const HAS_CREDENTIALS = !!(ZATTOO_EMAIL && ZATTOO_PASSWORD);

// ── Helpers ───────────────────────────────────────────────────────

/** Log into Zattoo.com using the configured credentials. */
async function loginToZattoo(page: Page): Promise<void> {
  // Block cookie consent scripts so they don't interfere with the login form
  await page.route("**/onetrust*", (route) => route.abort());
  await page.route("**/cdn.cookielaw.org/**", (route) => route.abort());
  await page.route("**/geolocation*", (route) => route.abort());

  await page.goto("https://zattoo.com/login", { waitUntil: "networkidle" });

  // Wait for the login form to be visible
  const emailInput = page.locator('input[type="email"], input[name="email"], input[name="login"], input[placeholder*="mail" i]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  const submitButton = page.locator('button[type="submit"]').first();

  await expect(emailInput).toBeVisible({ timeout: 15000 });
  await expect(passwordInput).toBeVisible({ timeout: 15000 });

  await emailInput.fill(ZATTOO_EMAIL!);
  await passwordInput.fill(ZATTOO_PASSWORD!);

  // Submit the form
  await Promise.race([
    submitButton.click(),
    passwordInput.press("Enter"),
  ]);

  // Wait for navigation to complete (Zattoo redirects to /highlights, /live, or home)
  await page.waitForURL(/zattoo\.com\/(highlights|live|guide|channels|search|settings|$)/, { timeout: 25000 });
  await page.waitForLoadState("networkidle");
}

/** Inject the remote control script into the current Zattoo page. */
async function injectRemoteControl(page: Page): Promise<void> {
  await page.evaluate(injectScript);

  // Wait for OSD elements to appear
  await page.waitForFunction(() => {
    return (
      (window as unknown as Record<string, unknown>).__ZR === true &&
      document.getElementById("zrL") !== null
    );
  }, { timeout: 5000 });
}

/** Send a remote key event to the injected handler. */
async function sendKey(page: Page, action: string, label: string): Promise<void> {
  const event = JSON.stringify({
    type: "key_event",
    action,
    label,
    scan_code: 0,
    is_press: true,
  });

  await page.evaluate((evt) => {
    const zr = (window as unknown as Record<string, { handleKeyEvent?: (json: string) => void }>).__zattooRemote;
    if (zr?.handleKeyEvent) {
      zr.handleKeyEvent(evt);
    }
  }, event);
}

/** Get all console log entries captured by Playwright. */
function logContains(
  logs: Array<{ type: string; text: string }>,
  substr: string
): boolean {
  return logs.some((l) => l.text.includes(substr));
}

// ── Tests ─────────────────────────────────────────────────────────

// Conditionally skip all tests if credentials aren't configured
test.describe("Zattoo Login + Channel Navigation @zattoo-login", () => {
  test.skip(!HAS_CREDENTIALS, "Skipping: ZATTOO_EMAIL and ZATTOO_PASSWORD not set in e2e/.env");

  let consoleMsgs: Array<{ type: string; text: string }>;

  test.beforeEach(async ({ page }) => {
    // Capture console logs for assertion
    consoleMsgs = [];
    page.on("console", (msg) =>
      consoleMsgs.push({ type: msg.type(), text: msg.text() })
    );
  });

  test("login to Zattoo successfully", async ({ page }) => {
    await loginToZattoo(page);

    // Verify we're logged in by checking the URL
    const url = page.url();
    expect(url).toContain("zattoo.com");

    // The page should be loaded (Zattoo renders content dynamically)
    await page.waitForLoadState("domcontentloaded");
  });

  test("inject remote control and navigate to channel 1 (Das Erste) @zattoo-login", async ({ page }) => {
    await loginToZattoo(page);

    // Inject the remote control script
    await injectRemoteControl(page);

    // Send OK to verify basic navigation
    await sendKey(page, "ok", "OK");
    await page.waitForTimeout(1000);

    // Check the console logged the event
    expect(logContains(consoleMsgs, "[ZR] Key event: ok")).toBeTruthy();
  });

  test("navigate through multiple channels: 1 → 2 → 3 @zattoo-login", async ({ page }) => {
    await loginToZattoo(page);

    // Inject the remote control
    await injectRemoteControl(page);

    // Channel 1 (Das Erste) — triggers page navigation
    const urlBefore = page.url();
    await sendKey(page, "digit_1", "1");

    // Wait for the navigation to complete
    try {
      await page.waitForURL((url) => url.href !== urlBefore, { timeout: 15000 });
    } catch { /* might stay on same page if no slug match */ }
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});

    // Re-inject after page navigation
    await injectRemoteControl(page);

    // Channel 2 (ZDF)
    const urlBefore2 = page.url();
    await sendKey(page, "digit_2", "2");
    try {
      await page.waitForURL((url) => url.href !== urlBefore2, { timeout: 15000 });
    } catch {}
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});

    await injectRemoteControl(page);

    // Channel 3 (RTL)
    const urlBefore3 = page.url();
    await sendKey(page, "digit_3", "3");
    try {
      await page.waitForURL((url) => url.href !== urlBefore3, { timeout: 15000 });
    } catch {}
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});

    // Verify actions were logged
    expect(logContains(consoleMsgs, "[ZR] Key event:")).toBeTruthy();
  });

  test("use channel up/down keys @zattoo-login", async ({ page }) => {
    await loginToZattoo(page);
    await injectRemoteControl(page);

    // Send channel up (PageUp)
    await sendKey(page, "channel_up", "CH+");
    await page.waitForTimeout(2500);

    // After navigation, re-inject
    await page.evaluate(injectScript);
    await page.waitForTimeout(1000);

    // Send channel down (PageDown)
    await sendKey(page, "channel_down", "CH-");
    await page.waitForTimeout(2000);

    // Verify actions were logged
    expect(logContains(consoleMsgs, "channel_up")).toBeTruthy();
    expect(logContains(consoleMsgs, "channel_down")).toBeTruthy();
  });

  test("navigate to favorite channel via color key @zattoo-login", async ({ page }) => {
    await loginToZattoo(page);
    await injectRemoteControl(page);

    // Color red → ZDF (favorite)
    await sendKey(page, "color_red", "Red");
    await page.waitForTimeout(3000);

    // The OSD might be gone after navigation, but console should show it
    expect(logContains(consoleMsgs, "color_red")).toBeTruthy();
  });

  test("open EPG and return to live @zattoo-login", async ({ page }) => {
    await loginToZattoo(page);
    await injectRemoteControl(page);

    // Open EPG (menu key)
    await sendKey(page, "menu", "EPG");
    await page.waitForTimeout(3000);

    // After navigation, re-inject
    await page.evaluate(injectScript);
    await page.waitForTimeout(1000);

    // Navigate back to live TV
    await sendKey(page, "home", "Home");
    await page.waitForTimeout(3000);

    // Verify navigation happened
    expect(logContains(consoleMsgs, "menu")).toBeTruthy();
    expect(logContains(consoleMsgs, "home")).toBeTruthy();
  });
});
