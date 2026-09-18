import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const HOST = "127.0.0.1";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? "list" : "github",
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
    // Safari's engine: the nearest thing to an iPhone a machine without one can run.
    { name: "safari", use: { ...devices["Desktop Safari"] } },
    { name: "iphone", use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    // The e2e mode runs without App Check, and every request the page makes
    // is answered by a fixture, so the smokes never leave the machine.
    command: `npx vite --mode e2e --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 60_000,
  },
});
