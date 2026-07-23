import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.js"],
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.js"],
      exclude: ["src/**/*.test.*", "src/test-setup.ts"],
    },
  },
  resolve: {
    alias: {
      "@tauri-apps/api/core": resolve(__dirname, "src/__mocks__/tauri-api.ts"),
      "@tauri-apps/api/event": resolve(__dirname, "src/__mocks__/tauri-api.ts"),
      "@tauri-apps/api/window": resolve(__dirname, "src/__mocks__/tauri-api.ts"),
    },
  },
});
