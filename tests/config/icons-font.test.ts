import { createHash } from "node:crypto";
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
  });

  // Fonts are kept for a week; a font kept from before an icon was added drew
  // that icon as its name, "DASHBOARD" in the header. A new font is a new address.
  it("is asked for by an address that changes with the font", () => {
    const font = readFileSync("public/fonts/material-symbols-outlined.woff2");
    const version = createHash("sha256").update(font).digest("hex").slice(0, 10);
    const address = `/fonts/material-symbols-outlined.woff2?v=${version}`;
    expect(readFileSync("index.html", "utf8")).toContain(`href="${address}"`);
    expect(readFileSync("src/index.css", "utf8")).toContain(`url("${address}")`);
  });
});
