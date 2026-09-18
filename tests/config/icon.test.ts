import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The site wore a letter T for a week while the phone app had an icon of its
// own. These keep the site on that icon: the tier bands, the dark tile, the S.
describe("the site's icon", () => {
  const svg = readFileSync("public/favicon.svg", "utf8");

  it("is the phone app's icon: five tier bands behind a dark tile", () => {
    for (const colour of ["#B03A32", "#C06A25", "#A98B1F", "#3F7F55", "#3C6E99", "#121318"]) {
      expect(svg).toContain(`fill="${colour}"`);
    }
    // The launcher shows the middle 72 of the 108 it is drawn on.
    expect(svg).toContain('viewBox="18 18 72 72"');
  });

  it("is offered to a browser tab and to a phone's home screen", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    const png = readFileSync("public/apple-touch-icon.png");
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([180, 180]);
  });
});
