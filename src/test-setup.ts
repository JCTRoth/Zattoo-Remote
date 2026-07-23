/**
 * Test setup — runs before all tests.
 * Mocks browser APIs that jsdom doesn't provide.
 */

// jsdom may not expose some browser APIs we need
if (typeof window !== "undefined") {
  // Mock requestAnimationFrame
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      return setTimeout(cb, 0) as unknown as number;
    };
  }

  // Mock cancelAnimationFrame
  if (!window.cancelAnimationFrame) {
    window.cancelAnimationFrame = (id: number) => {
      clearTimeout(id);
    };
  }
}

// Clear DOM between tests
beforeEach(() => {
  // Ensure document.body exists before clearing
  if (document?.body) {
    document.body.innerHTML = "";
  } else if (document?.documentElement) {
    document.documentElement.innerHTML = "<body></body>";
  }
  // Reset all mocks
  vi.clearAllMocks();
});

// Prevent window.close() from destroying the jsdom document across tests.
// Many Tauri apps call window.close() on certain shortcuts, and jsdom's
// native implementation actually closes the document, corrupting the
// test environment for all subsequent tests.
const origClose = window.close;
window.close = vi.fn() as typeof window.close;

// Suppress console noise during tests (optional)
const originalConsole = { ...console };
beforeAll(() => {
  console.log = vi.fn();
  console.error = vi.fn();
  console.warn = vi.fn();
});
afterAll(() => {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
});
