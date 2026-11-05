import { describe, expect, it } from "vitest";
import { initialOf } from "./initial";

describe("initialOf", () => {
  it("takes the first character whole, upper-cased, and ? for no name", () => {
    expect(initialOf(" danylo")).toBe("D");
    expect(initialOf("😀 emoji")).toBe("😀");
    expect(initialOf("𝒜lice")).toBe("𝒜");
    expect(initialOf("   ")).toBe("?");
    expect(initialOf(null)).toBe("?");
  });
});
