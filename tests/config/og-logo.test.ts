import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SITE_LOGO_SVG } from "../../functions/src/siteLogo";

// The link previews wear the site's real icon (Danylo through the Designer,
// 23.11): the functions carry a copy of public/favicon.svg, which must stay it.
describe("the icon on link previews", () => {
  it("is public/favicon.svg as it is", () => {
    expect(SITE_LOGO_SVG).toBe(readFileSync("public/favicon.svg", "utf8"));
  });
});
