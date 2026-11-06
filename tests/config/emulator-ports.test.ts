import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_PORTS, emulatorPort, PORT_VARIABLES, portFrom } from "../../config/emulator-ports";

describe("emulator ports", () => {
  it("are the proxy's own unless the environment names others", () => {
    expect(emulatorPort("functions", {})).toBe(5001);
    expect(emulatorPort("firestore", {})).toBe(8080);
    expect(emulatorPort("auth", {})).toBe(9099);
    expect(emulatorPort("storage", {})).toBe(9199);
    expect(emulatorPort("site", {})).toBe(4174);
    expect(emulatorPort("firestore", { TYL_FIRESTORE_EMULATOR_PORT: "18080" })).toBe(18080);
    expect(emulatorPort("site", { TYL_PROXY_SITE_PORT: "" })).toBe(4174);
  });

  it("refuses a value that is no port instead of quietly using another", () => {
    expect(() => portFrom("80a", 1, "TYL_PROXY_SITE_PORT")).toThrow(/TYL_PROXY_SITE_PORT/);
    expect(() => portFrom("0", 1)).toThrow();
    expect(() => portFrom("65536", 1)).toThrow();
  });

  // The browser and the script that writes the emulators' config read the
  // same names; a rename in one place would leave a suite on two sets of ports.
  it("are read under the same names by the browser, the script and the README", () => {
    const browser = readFileSync("src/lib/emulators.ts", "utf8");
    const script = readFileSync("scripts/e2e-proxy.mjs", "utf8");
    const readme = readFileSync("e2e-proxy/README.md", "utf8");
    expect(browser).toContain(PORT_VARIABLES.auth);
    expect(browser).toContain(PORT_VARIABLES.storage);
    expect(browser).toContain(`${DEFAULT_PORTS.auth}`);
    expect(browser).toContain(`${DEFAULT_PORTS.storage}`);
    for (const which of ["functions", "firestore", "auth", "storage"] as const) {
      expect(script).toContain(PORT_VARIABLES[which]);
    }
    for (const variable of Object.values(PORT_VARIABLES)) expect(readme).toContain(variable);
  });
});
