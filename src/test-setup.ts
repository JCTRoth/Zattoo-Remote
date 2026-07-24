/**
 * Test setup — runs before all tests.
 * Provides browser API polyfills that jsdom doesn't supply.
 */

// Polyfill requestAnimationFrame for jsdom
if (typeof window !== "undefined" && !window.requestAnimationFrame) {
  window.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(cb, 0) as unknown as number;
  window.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

// Reset DOM and mocks between tests
beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});
