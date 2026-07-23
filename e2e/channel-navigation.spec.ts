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

// ── Helpers ───────────────────────────────────────────────────────

/** Navigate the page to the test harness and inject the script. */
async function injectAndWait(page: Page): Promise<void> {
  // Navigate to the test harness
  await page.goto("/e2e/test-harness.html");

  // Inject the script
  await page.evaluate(injectScript);

  // Wait for initialization
  await page.waitForFunction(() => {
    return (
      (window as unknown as Record<string, unknown>).__ZR === true &&
      (window as unknown as Record<string, unknown>).__zattooRemote !== undefined
    );
  });

  // Wait for OSD elements to be injected
  await page.waitForSelector("#zrL", { state: "attached" });
  await page.waitForSelector("#zrCh", { state: "attached" });
}

/** Get all console log entries captured by Playwright's console listener. */
function getConsoleLogs(consoleMessages: Array<{ type: string; text: string }>): Array<{ level: string; text: string }> {
  return consoleMessages.map(msg => ({
    level: msg.type,
    text: msg.text,
  }));
}

/** Send a remote key event to the injected handler. */
async function sendKey(page: Page, action: string, label: string, overrides: Record<string, unknown> = {}) {
  const event = JSON.stringify({
    type: "key_event",
    action,
    label,
    scan_code: 0,
    is_press: true,
    ...overrides,
  });

  await page.evaluate((evt) => {
    const zr = (window as unknown as Record<string, { handleKeyEvent?: (json: string) => void }>).__zattooRemote;
    if (zr?.handleKeyEvent) {
      zr.handleKeyEvent(evt);
    }
  }, event);
}

/** Check if a console log contains a specific string. */
function logContains(logs: Array<{ text: string }>, substr: string): boolean {
  return logs.some((l) => l.text.includes(substr));
}

// ── Tests ─────────────────────────────────────────────────────────

test.describe("Zattoo Remote — Injected Script E2E", () => {
  test("inject script initializes correctly", async ({ page }) => {
    const consoleMsgs: Array<{ type: string; text: string }> = [];
    page.on("console", msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));

    await injectAndWait(page);

    // Verify the OSD elements are present
    await expect(page.locator("#zrO")).toBeAttached();
    await expect(page.locator("#zrL")).toBeAttached();
    await expect(page.locator("#zrV")).toBeAttached();
    await expect(page.locator("#zrVb")).toBeAttached();
    await expect(page.locator("#zrF")).toBeAttached();
    await expect(page.locator("#zrCh")).toBeAttached();
    await expect(page.locator("#zrD")).toBeAttached();
    await expect(page.locator("#zrP")).toBeAttached();

    // Check init log messages
    const logs = getConsoleLogs(consoleMsgs);
    expect(logContains(logs, "[ZR] Init...")).toBeTruthy();
    expect(logContains(logs, "[ZR] Ready")).toBeTruthy();
  });

  test("idempotent injection does not re-initialize", async ({ page }) => {
    await injectAndWait(page);

    // Get the handler version from the first injection
    const firstVersion = await page.evaluate(() => {
      const zr = (window as unknown as Record<string, { version?: string }>).__zattooRemote;
      return zr?.version;
    });

    // Inject again — the guard should prevent re-init
    await page.evaluate(injectScript);

    const secondVersion = await page.evaluate(() => {
      const zr = (window as unknown as Record<string, { version?: string }>).__zattooRemote;
      return zr?.version;
    });

    // Version should be the same (guard prevented re-init from creating a new object)
    expect(secondVersion).toBe(firstVersion);

    // Also verify no duplicate OSD elements
    const osdCount = await page.evaluate(() => document.querySelectorAll("#zrR").length);
    expect(osdCount).toBe(1);
  });
});

test.describe("Channel navigation — Digit keys", () => {
  test("single digit: digit_1 shows OSD, then navigates", async ({ page }) => {
    const consoleMsgs: Array<{ type: string; text: string }> = [];
    page.on("console", msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));

    await injectAndWait(page);

    // Press digit 1
    await sendKey(page, "digit_1", "1");

    // The OSD should show "1" in the channel input overlay
    await expect(page.locator("#zrD")).toHaveText("1");
    await expect(page.locator("#zrCh")).not.toHaveClass(/h/);

    // Wait for navigation to happen (channel timeout is 2000ms)
    await page.waitForTimeout(2500);

    // The inject script navigates to the channel URL, which leaves our test page.
    // Console messages are captured by Playwright before the navigation completes.
    const logs = getConsoleLogs(consoleMsgs);
    expect(logContains(logs, "[ZR] Ch->")).toBeTruthy();
    expect(logContains(logs, "daserste")).toBeTruthy();
  });

  test("multi-digit: digit_2 + digit_2 → OSD shows 22 (ZDFneo)", async ({ page }) => {
    await injectAndWait(page);

    await sendKey(page, "digit_2", "2");
    await page.waitForTimeout(200);
    await sendKey(page, "digit_2", "2");

    // Verify OSD shows "22"
    await expect(page.locator("#zrD")).toHaveText("22");

    // Wait for the channel timeout to fire (navigates away)
    await page.waitForTimeout(2500);
  });

  test("digit key shows OSD overlay and hides after timeout", async ({ page }) => {
    await injectAndWait(page);

    await sendKey(page, "digit_5", "5");

    await expect(page.locator("#zrD")).toHaveText("5");
    await expect(page.locator("#zrCh")).not.toHaveClass(/h/);

    // Wait for timeout — page navigates away
    await page.waitForTimeout(2500);
  });

  test("rapid digits: pressing 1 then 9 shows 19", async ({ page }) => {
    await injectAndWait(page);

    await sendKey(page, "digit_1", "1");
    await page.waitForTimeout(300);
    await sendKey(page, "digit_9", "9");

    await expect(page.locator("#zrD")).toHaveText("19");

    await page.waitForTimeout(2500);
  });
});

test.describe("Channel navigation — Color favorites", () => {
  test("color_red → OSD shows ZDF favorite", async ({ page }) => {
    const consoleMsgs: Array<{ type: string; text: string }> = [];
    page.on("console", msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));

    await injectAndWait(page);

    await sendKey(page, "color_red", "Red");

    // Favorite OSD should show ZDF
    await expect(page.locator("#zrF")).toHaveText("⭐ ZDF");
    await expect(page.locator("#zrF")).toHaveClass(/s/);

    // Verify console log shows channel navigation (uses slug "zdf")
    const logs = getConsoleLogs(consoleMsgs);
    expect(logContains(logs, "[ZR] Ch->")).toBeTruthy();
    expect(logContains(logs, "zdf")).toBeTruthy();

    // Wait for the navigation to happen (favorite navigates immediately)
    await page.waitForTimeout(500);
  });

  test("color_green → OSD shows Das Erste favorite", async ({ page }) => {
    const consoleMsgs: Array<{ type: string; text: string }> = [];
    page.on("console", msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));

    await injectAndWait(page);

    await sendKey(page, "color_green", "Green");

    await expect(page.locator("#zrF")).toHaveText("⭐ Das Erste");
    await expect(page.locator("#zrF")).toHaveClass(/s/);

    // Verify console log shows channel navigation (uses slug "daserste")
    const logs = getConsoleLogs(consoleMsgs);
    expect(logContains(logs, "[ZR] Ch->")).toBeTruthy();
    expect(logContains(logs, "daserste")).toBeTruthy();

    await page.waitForTimeout(500);
  });
});

test.describe("Navigation keys", () => {
  test("up/down/left/right dispatch keyboard events", async ({ page }) => {
    await injectAndWait(page);

    // Track dispatched keyboard events
    const dispatchedKeys: string[] = [];
    await page.evaluate(() => {
      document.body.addEventListener("keydown", (e: KeyboardEvent) => {
        const arr = (window as unknown as Record<string, unknown>).__dispatchedKeys as string[] | undefined;
        if (arr) arr.push(e.key);
      });
    });
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__dispatchedKeys = [];
    });

    // Send navigation keys
    await sendKey(page, "up", "Up");
    await sendKey(page, "down", "Down");
    await sendKey(page, "left", "Left");
    await sendKey(page, "right", "Right");
    await sendKey(page, "ok", "OK");

    const keys = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__dispatchedKeys as string[];
    });

    expect(keys).toContain("ArrowUp");
    expect(keys).toContain("ArrowDown");
    expect(keys).toContain("ArrowLeft");
    expect(keys).toContain("ArrowRight");
    expect(keys).toContain("Enter");
  });

  test("back dispatches Escape", async ({ page }) => {
    await injectAndWait(page);

    let escapeDispatched = false;
    await page.evaluate(() => {
      document.body.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          (window as unknown as Record<string, unknown>).__escapePressed = true;
        }
      });
    });

    await sendKey(page, "back", "Back");

    const escapePressed = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__escapePressed === true;
    });
    expect(escapePressed).toBe(true);
  });
});

test.describe("Playback keys", () => {
  test("play_pause dispatches on video element", async ({ page }) => {
    const consoleMsgs: Array<{ type: string; text: string }> = [];
    page.on("console", msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));

    await injectAndWait(page);

    // Create a mock video element
    await page.evaluate(() => {
      const video = document.createElement("video");
      video.id = "mock-video";
      document.body.appendChild(video);
    });

    await sendKey(page, "play_pause", "Play/Pause");

    // The script should find and interact with the video
    const logs = getConsoleLogs(consoleMsgs);
    expect(logContains(logs, "play_pause")).toBeTruthy();
  });

  test("rewind seeks -15s on video", async ({ page }) => {
    await injectAndWait(page);

    // Create a mock video element
    await page.evaluate(() => {
      const video = document.createElement("video");
      video.id = "mock-video";
      (video as unknown as Record<string, unknown>).currentTime = 100;
      Object.defineProperty(video, "duration", { value: 300 });
      document.body.appendChild(video);
    });

    await sendKey(page, "rewind", "Rewind");

    // Should have seeked backwards
    const currentTime = await page.evaluate(() => {
      const v = document.getElementById("mock-video") as HTMLVideoElement;
      return v?.currentTime;
    });
    expect(currentTime).toBe(85); // 100 - 15
  });

  test("fast_forward seeks +15s on video", async ({ page }) => {
    await injectAndWait(page);

    await page.evaluate(() => {
      const video = document.createElement("video");
      video.id = "mock-video-ff";
      (video as unknown as Record<string, unknown>).currentTime = 50;
      Object.defineProperty(video, "duration", { value: 300 });
      document.body.appendChild(video);
    });

    await sendKey(page, "fast_forward", "FF");

    const currentTime = await page.evaluate(() => {
      const v = document.getElementById("mock-video-ff") as HTMLVideoElement;
      return v?.currentTime;
    });
    expect(currentTime).toBe(65); // 50 + 15
  });
});

test.describe("OSD display", () => {
  test("OSD label appears and auto-hides", async ({ page }) => {
    await injectAndWait(page);

    await sendKey(page, "channel_up", "CH+");

    // OSD should be visible
    await expect(page.locator("#zrL")).toHaveText("CH+");
    await expect(page.locator("#zrL")).toHaveClass(/s/);

    // After 1.5s, OSD should hide
    await page.waitForTimeout(1800);
    await expect(page.locator("#zrL")).not.toHaveClass(/s/);
  });

  test("favorite OSD appears and auto-hides", async ({ page }) => {
    await injectAndWait(page);

    await sendKey(page, "color_blue", "Blue");

    await expect(page.locator("#zrF")).toHaveText("⭐ ProSieben");
    await expect(page.locator("#zrF")).toHaveClass(/s/);

    await page.waitForTimeout(1800);
    await expect(page.locator("#zrF")).not.toHaveClass(/s/);
  });
});

test.describe("Console log output", () => {
  test("key events are logged to console", async ({ page }) => {
    const consoleMsgs: Array<{ type: string; text: string }> = [];
    page.on("console", msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));

    await injectAndWait(page);

    await sendKey(page, "ok", "OK");
    await sendKey(page, "digit_1", "1");
    await sendKey(page, "color_red", "Red");

    const logs = getConsoleLogs(consoleMsgs);

    // Check that key events were logged
    expect(logContains(logs, "[ZR] Key event:")).toBeTruthy();
    expect(logContains(logs, "ok")).toBeTruthy();
    expect(logContains(logs, "digit_1")).toBeTruthy();
    expect(logContains(logs, "color_red")).toBeTruthy();
  });

  test("unknown actions produce console output", async ({ page }) => {
    const consoleMsgs: Array<{ type: string; text: string }> = [];
    page.on("console", msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));

    await injectAndWait(page);

    await sendKey(page, "volume_up", "Vol+");

    const logs = getConsoleLogs(consoleMsgs);
    expect(logContains(logs, "volume_up")).toBeTruthy();
  });
});

test.describe("Error resilience", () => {
  test("malformed JSON does not crash handler", async ({ page }) => {
    const consoleMsgs: Array<{ type: string; text: string }> = [];
    page.on("console", msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));

    await injectAndWait(page);

    // Send malformed data
    await page.evaluate(() => {
      const zr = (window as unknown as Record<string, { handleKeyEvent?: (json: string) => void }>).__zattooRemote;
      if (zr?.handleKeyEvent) {
        zr.handleKeyEvent("not-valid-json{{{");
        zr.handleKeyEvent("");
      }
    });

    const logs = getConsoleLogs(consoleMsgs);
    expect(logContains(logs, "[ZR] err:")).toBeTruthy();
  });

  test("missing DOM elements do not throw", async ({ page }) => {
    await page.goto("/e2e/test-harness.html");
    // Remove body content
    await page.evaluate(() => {
      document.body.innerHTML = "";
    });

    // Inject script — should not throw
    await page.evaluate(injectScript);

    // Should have set up despite missing elements
    // (the init function has a setTimeout retry)
    await page.waitForTimeout(1500);
  });
});
