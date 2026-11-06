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
export const AUTH_EMULATOR_PORT = 9099;
export const STORAGE_EMULATOR_PORT = 9199;
