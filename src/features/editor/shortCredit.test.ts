import { describe, expect, it } from "vitest";
import { shortCredit } from "./shortCredit";

describe("a result's short credit (artboard 23)", () => {
  it("names the author and the licence without its version", () => {
    expect(
      shortCredit({
        credit: "Rosino, CC BY-SA 2.0, via Wikimedia Commons",
        attribution: { source: "commons", author: "Rosino", license: "CC BY-SA 2.0" },
      }),
    ).toBe("Rosino, CC BY-SA");
    expect(
      shortCredit({
        credit: null,
        attribution: { source: "inaturalist", author: "Ann", license: "CC0 1.0" },
      }),
    ).toBe("Ann, CC0");
    expect(
      shortCredit({
        credit: null,
        attribution: { source: "commons", author: "Bo", license: "Public domain" },
      }),
    ).toBe("Bo, Public domain");
  });

  it("keeps a plain credit, and shows no bare address as a name", () => {
    expect(shortCredit({ credit: "Photo: Ann", attribution: null })).toBe("Photo: Ann");
    expect(shortCredit({ credit: "https://example.org/pic", attribution: null })).toBeNull();
    expect(shortCredit({ credit: null, attribution: { source: "tmdb" } })).toBeNull();
  });
});
