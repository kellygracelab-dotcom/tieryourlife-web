/*
 * `--mode emulator` (.env.emulator): the site against the proxy running in
 * the Firebase emulators, for the smokes in e2e-proxy/. firebase.ts asks
 * `import.meta.env.VITE_EMULATORS === "1"` where it decides, written out each
 * time: a production build replaces it with a constant false there, and the
 * minifier drops the branch and everything only it used.
 */

/**
 * A demo project: the emulators never reach a real Google service for it, and
 * the proxy accepts only tokens minted for the project it runs as.
 */
export const EMULATOR_PROJECT = "demo-tieryourlife";

export const EMULATOR_HOST = "127.0.0.1";

/**
 * A port from the build's environment, or the proxy's own when it gives none:
 * VITE_AUTH_EMULATOR_PORT and VITE_STORAGE_EMULATOR_PORT move a second suite
 * on the same machine to its own emulators (e2e-proxy/README.md).
 */
export function portOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : fallback;
}

export const authEmulatorPort = (): number => portOr(import.meta.env.VITE_AUTH_EMULATOR_PORT, 9099);
export const storageEmulatorPort = (): number =>
  portOr(import.meta.env.VITE_STORAGE_EMULATOR_PORT, 9199);
