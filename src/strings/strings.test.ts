import { describe, expect, it } from "vitest";
import { fill, formatCount, plural, strings } from "./index";

describe("strings", () => {
  it("fills named holes and leaves unknown ones visible", () => {
    expect(fill("by {name}", { name: "danylo" })).toBe("by danylo");
    expect(fill("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });

  it("picks the plural form and groups thousands", () => {
    expect(plural(strings.card.items, 1)).toBe("1 item");
    expect(plural(strings.card.items, 0)).toBe("0 items");
    expect(plural(strings.card.rankings, 2140)).toBe("2,140 rankings");
    expect(formatCount(1000000)).toBe("1,000,000");
  });

  it("keeps the attribution TMDB requires word for word", () => {
    expect(strings.footer.tmdb).toBe(
      "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    );
  });
});
