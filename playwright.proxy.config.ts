import { defineConfig, devices } from "@playwright/test";
import { emulatorPort } from "./config/emulator-ports";

/*
 * The smokes in e2e-proxy/: the site in `vite --mode emulator` against the
 * proxy and the site's own functions running in the Firebase emulators. Run
 * them with `npm run e2e:proxy` (scripts/e2e-proxy.mjs starts the emulators).
 * Nothing here is answered by a fixture: every request reaches the real code.
 */
// TYL_PROXY_SITE_PORT, for a second suite on the same machine (e2e-proxy/README.md).
const PORT = emulatorPort("site");
const HOST = "127.0.0.1";

export default defineConfig({
  testDir: "e2e-proxy",
  // One emulator holds every test's data; one browser at a time keeps the
  // functions' cold starts from stacking up.
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  // A function's first request in the emulator loads its code: seconds, not ms.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI === undefined ? "list" : "github",
  outputDir: "test-results/proxy",
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  // The built site, as people get it, not the dev server: the dev server
  // fell over under a loaded machine, and it mounts everything twice.
  // `vite preview` keeps the dev server's proxy to the functions emulator.
  webServer: {
    command:
      `npx vite build --mode emulator --outDir dist-emulator --emptyOutDir && ` +
      `npx vite preview --mode emulator --outDir dist-emulator --host ${HOST} --port ${PORT} --strictPort`,
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
