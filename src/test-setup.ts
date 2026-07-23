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
  document.body.innerHTML = "";
  // Reset all mocks
  vi.clearAllMocks();
});

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
