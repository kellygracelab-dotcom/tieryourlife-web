/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The proxy's Firebase emulator, for local development. The same two paths are
// Hosting rewrites in production, so the client never needs a different base URL.
const emulator = "http://127.0.0.1:5001";
const emulatorFunction = (name: string) => ({
  target: emulator,
  rewrite: (path: string) => `/tieryourlife/europe-west1/${name}${path}`,
});

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/lists": emulatorFunction("lists"),
      "/3/search": emulatorFunction("tmdb"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/test/**", "src/**/*.test.{ts,tsx}"],
      thresholds: {
        lines: 85,
        branches: 85,
        functions: 85,
        statements: 85,
      },
    },
  },
});
