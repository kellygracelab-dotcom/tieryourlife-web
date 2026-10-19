import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICONS } from "../../src/ui/icons";

describe("the icon font", () => {
  // The font carries only the icons it was made for. An icon added to the
  // list but not to the font would show up as its name in letters.
  it("was made from the icons the site draws: run scripts/icons.mjs after changing the list", () => {
    const made = readFileSync("scripts/material-symbols-outlined.icons.txt", "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(made).toEqual([...ICONS].sort());
  });

  it("is served by the site itself, and stays small", () => {
    const size = statSync("public/fonts/material-symbols-outlined.woff2").size;
    expect(size).toBeGreaterThan(1_000);
    expect(size).toBeLessThan(60_000);
    const html = readFileSync("index.html", "utf8");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).toContain('href="/fonts/material-symbols-outlined.woff2"');
  });
});
