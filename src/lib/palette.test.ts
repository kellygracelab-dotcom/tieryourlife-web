import { describe, expect, it } from "vitest";
import vectors from "../test/theme-vectors.json";
import { PRESET_HUES } from "./colourTheme";
import { paletteCss, ROLES, rolesOf, seedOf, type Roles } from "./palette";

const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

/** Each channel within the file's tolerance of the shared vectors. */
function expectClose(ours: Roles, theirs: Record<string, string>, where: string) {
  for (const role of ROLES) {
    const expected = theirs[role];
    if (expected === undefined) throw new Error(`${where}: no ${role} in the vectors`);
    const [r, g, b] = rgb(ours[role]);
    const [R, G, B] = rgb(expected);
    const off = Math.max(Math.abs(r! - R!), Math.abs(g! - G!), Math.abs(b! - B!));
    expect(off, `${where} ${role}: ${ours[role]} against ${expected}`).toBeLessThanOrEqual(
      vectors.tolerance,
    );
  }
}

describe("a palette from one hue, the same as the app's (shared vectors)", () => {
  it("knows the ready colours by the vectors' hues", () => {
    for (const [name, hue] of Object.entries(PRESET_HUES)) {
      expect(vectors.presets[name as keyof typeof vectors.presets].hue).toBe(hue);
    }
  });

  it("builds every role of the ready colours, light and dark, within the tolerance", () => {
    for (const [name, preset] of Object.entries(vectors.presets)) {
      expect(seedOf(preset.hue)).toBe(preset.seed.toUpperCase());
      expectClose(rolesOf(preset.hue, false), preset.light, `${name} light`);
      expectClose(rolesOf(preset.hue, true), preset.dark, `${name} dark`);
    }
  });

  it("builds every role of the own hues the vectors hold, light and dark", () => {
    for (const own of vectors.ownHues) {
      expectClose(rolesOf(own.hue, false), own.light, `hue ${own.hue} light`);
      expectClose(rolesOf(own.hue, true), own.dark, `hue ${own.hue} dark`);
    }
  });

  it("draws the page and the main button from the palette and never touches a tier's colour", () => {
    const css = paletteCss(PRESET_HUES.matcha);
    const light = rolesOf(PRESET_HUES.matcha, false);
    expect(css).toContain(`--paper:${light.surfaceContainerHigh}`);
    expect(css).toContain(`--surface:${light.surfaceContainerLow}`);
    expect(css).toContain(`--accent:${light.primary}`);
    expect(css).toContain(':root:root[data-theme="dark"]{');
    expect(css).not.toMatch(/--tier-|--band-light|--band-dark/);
  });
});
