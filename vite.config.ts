/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import {
  DEBUG_TOKEN_VAR,
  debugTokenDefine,
  keepOutOfBundle,
  LEAKY_DEBUG_TOKEN_VAR,
  refuseLeakyDebugToken,
} from "./config/debug-token.ts";

// The same two paths are Hosting rewrites in production, so the client never
// needs a different base URL. In development they go to the backend's Firebase
// emulator, or to the live functions with `vite --mode live`.
const EMULATOR = "http://127.0.0.1:5001/tieryourlife/europe-west1";

const proxyFor = (functionsBase: string) => {
  const to = (name: string) => ({
    target: functionsBase,
    changeOrigin: true,
    rewrite: (path: string) => `/${name}${path}`,
  });
  return { "/lists": to("lists"), "/3/search": to("tmdb"), "/api": to("web") };
};

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  refuseLeakyDebugToken(command, env);
  return {
    plugins: [react(), keepOutOfBundle([env[DEBUG_TOKEN_VAR], env[LEAKY_DEBUG_TOKEN_VAR]])],
    define: debugTokenDefine(command, env),
    server: {
      proxy: proxyFor(env.PROXY_TARGET || EMULATOR),
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
  };
});
