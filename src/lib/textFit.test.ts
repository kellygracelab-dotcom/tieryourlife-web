import { describe, expect, it } from "vitest";
import { drawnLines, estimateMeasure, fitText, linesOf, type Measure } from "./textFit";

// Every letter 0.6 of the size wide, a space too.
const measure: Measure = estimateMeasure;

describe("linesOf", () => {
  it("breaks between words only, a word too wide on a line of its own", () => {
    expect(linesOf("Good stuff", 60, 10, measure)).toEqual(["Good stuff"]);
    expect(linesOf("Good stuff", 40, 10, measure)).toEqual(["Good", "stuff"]);
    expect(linesOf("  a   Supercalifragilistic b ", 30, 10, measure)).toEqual([
      "a",
      "Supercalifragilistic",
      "b",
    ]);
  });
});

describe("fitText", () => {
  const type = { start: 32, floor: 12, line: 1.15 };

  it("keeps a letter or a short word at the band's own size", () => {
    expect(fitText("S", { width: 80, height: 98 }, type, measure)).toEqual({
      size: 32,
      broken: false,
    });
    expect(fitText("Love", { width: 80, height: 98 }, type, measure).size).toBe(32);
  });

  it("steps down until the widest word fits whole, never cutting it", () => {
    // "GOAT" on a phone's band: 4 × 0.6 × 22 = 52.8, too wide for 48.
    const fit = fitText("GOAT", { width: 48, height: 78 }, { ...type, start: 22 }, measure);
    expect(fit.broken).toBe(false);
    expect(4 * 0.6 * fit.size).toBeLessThanOrEqual(48);
    expect(fit.size).toBe(20);
  });

  it("steps down further until the lines fit the height", () => {
    const text = "Absolutely the best things I have ever seen";
    const room = { width: 80, height: 98 };
    const fit = fitText(text, room, type, measure);
    expect(fit.broken).toBe(false);
    const lines = linesOf(text, room.width, fit.size, measure);
    expect(lines.length * fit.size * 1.15).toBeLessThanOrEqual(room.height);
    expect(fit.size).toBeLessThan(32);
  });

  it("stops at the floor and lets the box grow when the lines are still too many", () => {
    const text = Array.from({ length: 30 }, () => "ab").join(" ");
    expect(fitText(text, { width: 40, height: 20 }, type, measure)).toEqual({
      size: 12,
      broken: false,
    });
  });

  it("says when one word is too wide even at the floor", () => {
    expect(
      fitText("Supercalifragilisticexpialidocious", { width: 80, height: 98 }, type, measure),
    ).toEqual({ size: 12, broken: true });
  });
});

describe("drawnLines", () => {
  it("cuts only a word wider than the box, with hyphens, by whole characters", () => {
    const lines = drawnLines("an Supercalifragilistic", 60, 10, measure);
    expect(lines[0]).toBe("an");
    expect(lines.slice(1, -1).every((line) => line.endsWith("-"))).toBe(true);
    expect(lines.slice(1).join("").replaceAll("-", "")).toBe("Supercalifragilistic");
    expect(lines.every((line) => measure(line, 10) <= 60)).toBe(true);
  });
});
