import { describe, expect, it } from "vitest";
import { portOr } from "./emulators";

describe("portOr", () => {
  it("takes a port the environment names, and the proxy's own otherwise", () => {
    expect(portOr("19099", 9099)).toBe(19099);
    expect(portOr(undefined, 9099)).toBe(9099);
    expect(portOr("", 9099)).toBe(9099);
    expect(portOr("not a port", 9099)).toBe(9099);
    expect(portOr("70000", 9099)).toBe(9099);
  });
});
