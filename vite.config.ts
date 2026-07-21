import { defineConfig } from "vite";
import { env } from "node:process";

// TAURI_DEV_HOST is set by the Tauri CLI during `tauri dev`.
// Importing explicitly from "node:process" avoids bundler-scoping issues in Vite 8+.
const host = env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  root: ".",
  publicDir: "public",
  build: {
    target: "es2021",
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  clearScreen: false,
}));
