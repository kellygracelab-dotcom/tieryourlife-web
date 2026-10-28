import { afterEach, describe, expect, it, vi } from "vitest";
import { boardSizeOf, canvasMeasure, fitName, nameFitter, type Measure } from "./nameFit";

/** Every letter half as wide as the type is tall: "Machina" at 10 px is 35 px. */
const halfEm: Measure = (word, size) => word.length * size * 0.5;

describe("boardSizeOf", () => {
  it("follows the spec's widths: under 600, under 1200, and the rest", () => {
    expect([599, 600, 1199, 1200].map(boardSizeOf)).toEqual(["small", "medium", "medium", "large"]);
  });
});

describe("fitName", () => {
  it("keeps the size it starts at while the longest word fits the tile less its padding", () => {
    // A 52 px tile leaves 44: "Machina" (7 letters) is 35 at 10 px.
    expect(fitName("Ex Machina", "medium", halfEm)).toEqual({ size: 10, hyphenate: false });
    expect(fitName("Ex Machina", "large", halfEm)).toEqual({ size: 11, hyphenate: false });
    expect(fitName("Dune", "small", halfEm)).toEqual({ size: 9, hyphenate: false });
  });

  it("steps down half a pixel at a time until every word fits", () => {
    // A 44 px tile leaves 36: "Climaxes" (8 letters) is 36 at 9 px.
    expect(fitName("Climaxes", "small", halfEm)).toEqual({ size: 9, hyphenate: false });
    // Nine letters are 40.5 at 9 and 38.25 at 8.5; at 8 they are 36.
    expect(fitName("Moonlight", "small", halfEm)).toEqual({ size: 8, hyphenate: false });
    // On a 52 px tile eleven letters would need 8 px, under the floor of 9: hyphens.
    expect(fitName("Oppenheimer", "medium", halfEm)).toEqual({ size: 9, hyphenate: true });
    // At 64 px they are 57.75 at 10.5 and fit at 10 (55 of 56).
    expect(fitName("Oppenheimer", "large", halfEm)).toEqual({ size: 10, hyphenate: false });
  });

  it("measures the words, not the name, and leaves a name without words at its size", () => {
    const measure = vi.fn(halfEm);
    fitName("  In   the  Mood ", "large", measure);
    expect(measure.mock.calls.map(([word]) => word)).toEqual(["In", "the", "Mood"]);
    expect(fitName("   ", "small", halfEm)).toEqual({ size: 9, hyphenate: false });
  });

  it("goes below the floor never: a word too long even there is left to hyphens", () => {
    expect(fitName("Supercalifragilistic", "small", halfEm)).toEqual({
      size: 8,
      hyphenate: true,
    });
  });
});

describe("nameFitter", () => {
  it("measures a name once at each size of the board, and answers from memory after", () => {
    const measure = vi.fn(halfEm);
    const fit = nameFitter(measure);
    const first = fit("Ex Machina", "medium");
    const calls = measure.mock.calls.length;
    expect(fit("Ex Machina", "medium")).toBe(first);
    expect(measure).toHaveBeenCalledTimes(calls);
    fit("Ex Machina", "large");
    expect(measure.mock.calls.length).toBeGreaterThan(calls);
  });
});

describe("canvasMeasure", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sets the name's own type on the canvas and reads the word's width back", () => {
    const fonts: string[] = [];
    const context = {
      font: "",
      measureText(word: string) {
        fonts.push(this.font);
        return { width: word.length * 3 };
      },
    };
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return context;
        }
      },
    );
    const measure = canvasMeasure()!;
    expect(measure("Heat", 9.5)).toBe(12);
    expect(fonts).toEqual(["500 9.5px Roboto, system-ui, sans-serif"]);
  });

  it("gives nothing where there is no canvas to measure on", () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    expect(canvasMeasure()).toBeNull();
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return null;
        }
      },
    );
    expect(canvasMeasure()).toBeNull();
  });
});
