import { readdirSync, readFileSync } from "node:fs";
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

  it("keeps the faint ink readable, 4.5:1, on every light surface small text sits on", () => {
    const light = blockAfter(":root {");
    const value = (token: string) => light.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1]?.trim();
    const alpha = Number(value("--ink-faint")?.match(/^rgba\(0, 0, 0, ([\d.]+)\)$/)?.[1]);
    expect(alpha).toBeGreaterThan(0);
    const channel = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ([r, g, b]: number[]) =>
      0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
    for (const token of [
      "--surface",
      "--paper",
      "--pool",
      "--surface-container-low",
      "--surface-container",
      "--surface-container-high",
      "--surface-container-highest",
    ]) {
      const hex = value(token)!;
      const under = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
      const ink = under.map((c) => Math.round(c * (1 - alpha)));
      const ratio = (luminance(under) + 0.05) / (luminance(ink) + 0.05);
      expect(ratio, token).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("writes no text in --ink-quiet, which is for lines and outlines", () => {
    const sheets = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((path) =>
      path.endsWith(".css"),
    );
    const quietText = sheets.filter((path) =>
      /(^|[^-])color: var\(--ink-quiet\)/m.test(readFileSync(`src/${path}`, "utf8")),
    );
    expect(quietText).toEqual([]);
  });

  it("keeps the layout tokens out of the dark blocks: they do not change with the scheme", () => {
    const chosen = declared(blockAfter(':root[data-theme="dark"]'));
    expect(chosen).not.toContain("--space-4");
    expect(chosen).not.toContain("--font");
  });
});
