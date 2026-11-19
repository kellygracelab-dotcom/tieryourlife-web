import { describe, expect, it } from "vitest";
import vectors from "../test/theme-vectors.json";
import { PRESET_HUES } from "./colourTheme";
import { paletteCss, ROLES, rolesFor, rolesOf, seedOf, type Roles } from "./palette";
import { PRESET_ROLES } from "./presetPalettes";

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

const presets = Object.entries(vectors.presets) as [
  keyof typeof PRESET_ROLES,
  (typeof vectors.presets)["matcha"],
][];

describe("the palettes, the same as the app's (shared vectors)", () => {
  it("takes the ready colours' tables as they are, light and dark", () => {
    expect(Object.keys(PRESET_ROLES).sort()).toEqual(presets.map(([name]) => name).sort());
    for (const [name, preset] of presets) {
      for (const mode of ["light", "dark"] as const) {
        const theirs = Object.fromEntries(
          Object.entries(preset[mode]).map(([role, hex]) => [role, hex.toUpperCase()]),
        );
        expect(PRESET_ROLES[name][mode], `${name} ${mode}`).toEqual(theirs);
        expect(Object.keys(theirs).sort()).toEqual([...ROLES].sort());
      }
      expect(rolesFor(name, true)).toBe(PRESET_ROLES[name].dark);
    }
  });

  it("opens Your colour from a ready colour on its main hue", () => {
    for (const [name, preset] of presets) {
      expect(PRESET_HUES[name]).toBe(preset.palettes.primary.hue);
    }
  });

  it("builds every role of the own hues the vectors hold, light and dark", () => {
    for (const own of vectors.ownHues) {
      expect(seedOf(own.hue)).toBe(own.seed.toUpperCase());
      expectClose(rolesOf(own.hue, false), own.light, `hue ${own.hue} light`);
      expectClose(rolesOf(own.hue, true), own.dark, `hue ${own.hue} dark`);
      expectClose(rolesFor(own.hue, true), own.dark, `hue ${own.hue} dark`);
    }
  });

  it("draws the page and the main button from the palette and never touches a tier's colour", () => {
    const css = paletteCss("matcha");
    const light = PRESET_ROLES.matcha.light;
    expect(css).toContain(`--paper:${light.surfaceContainerHigh}`);
    expect(css).toContain(`--surface:${light.surfaceContainerLow}`);
    expect(css).toContain(`--accent:${light.primary}`);
    expect(css).toContain(`--accent:${PRESET_ROLES.matcha.dark.primary}`);
    expect(css).toContain(':root:root[data-theme="dark"]{');
    expect(css).not.toMatch(/--tier-|--band-light|--band-dark/);
    expect(paletteCss(300)).toContain(`--accent:${rolesOf(300, false).primary}`);
  });
});
