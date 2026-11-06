/*
 * The ports of the Firebase emulators the smokes in e2e-proxy/ run against,
 * and of the site they serve. Each comes from an environment variable and
 * falls back to the proxy's own firebase.json, so a second suite on the same
 * machine needs its own variables, not edited sources (e2e-proxy/README.md).
 * The browser reads its two from import.meta.env (src/lib/emulators.ts).
 */

export const DEFAULT_PORTS = {
  functions: 5001,
  firestore: 8080,
  auth: 9099,
  storage: 9199,
  /** `vite preview` of the emulator build, for playwright.proxy.config.ts. */
  site: 4174,
} as const;

export type PortOf = keyof typeof DEFAULT_PORTS;

/** Auth and Storage are asked for by the browser too, so theirs carry Vite's prefix. */
export const PORT_VARIABLES: Record<PortOf, string> = {
  functions: "TYL_FUNCTIONS_EMULATOR_PORT",
  firestore: "TYL_FIRESTORE_EMULATOR_PORT",
  auth: "VITE_AUTH_EMULATOR_PORT",
  storage: "VITE_STORAGE_EMULATOR_PORT",
  site: "TYL_PROXY_SITE_PORT",
};

/** A port as a variable gives it: [fallback] when unset or empty, an error when it is no port. */
export function portFrom(value: string | undefined, fallback: number, name = "port"): number {
  if (value === undefined || value.trim() === "") return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a port number, not "${value}"`);
  }
  return port;
}

export const emulatorPort = (
  which: PortOf,
  env: Record<string, string | undefined> = process.env,
): number => portFrom(env[PORT_VARIABLES[which]], DEFAULT_PORTS[which], PORT_VARIABLES[which]);
