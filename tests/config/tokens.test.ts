import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/ui/tokens.css", "utf8");

/** The custom properties a block declares, by name. */
const declared = (block: string): string[] =>
  [...block.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]!);

const blockAfter = (selector: string): string => {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
};

const isColourish = (line: string) => /:\s*(#|rgba?\(|\d+%|dark|light)/.test(line);

describe("tokens.css", () => {
  it("gives every colour of the light scheme a dark value, in both dark blocks", () => {
    const light = blockAfter(":root {");
    const colours = light
      .split("\n")
      .filter(isColourish)
      .flatMap((line) => declared(line));
    expect(colours.length).toBeGreaterThan(20);

    const chosen = blockAfter(':root[data-theme="dark"]');
    const system = blockAfter(':root:not([data-theme="light"])');
    for (const token of colours) {
      expect(declared(chosen), `${token} chosen`).toContain(token);
      expect(declared(system), `${token} system`).toContain(token);
    }
    expect(chosen.replace(/\s+/g, " ").trim()).toBe(system.replace(/\s+/g, " ").trim());
  });

  it("keeps the layout tokens out of the dark blocks: they do not change with the scheme", () => {
    const chosen = declared(blockAfter(':root[data-theme="dark"]'));
    expect(chosen).not.toContain("--space-4");
    expect(chosen).not.toContain("--font");
  });
});
