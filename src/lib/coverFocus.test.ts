import { describe, expect, it } from "vitest";
import {
  CENTRE,
  defaultFocusOf,
  focusOf,
  shownFocus,
  TALL_DEFAULT,
  TALL_RATIO,
  focusOfFraming,
  frameOf,
  framingOfFocus,
  isCentre,
  placedBox,
  roundedFocus,
} from "./coverFocus";
import { CENTRED } from "./framing";
// Backend's shared cases (Proxy functions/test/cover-crop-vectors.json, #140, #142), copied unchanged.
import vectors from "./coverCropVectors.json";

describe("the shared cover crop vectors", () => {
  it.each(vectors.cases)("$name", ({ width, height, aspect, focus, crop }) => {
    // A case without a focus is drawn by the picture's default, as every tile draws it.
    const frame = frameOf({ width, height }, aspect, shownFocus(focus, { width, height }));
    expect(Math.abs(frame.left - crop.x)).toBeLessThanOrEqual(vectors.tolerance);
    expect(Math.abs(frame.top - crop.y)).toBeLessThanOrEqual(vectors.tolerance);
    expect(Math.abs(frame.width - crop.width)).toBeLessThanOrEqual(vectors.tolerance);
    expect(Math.abs(frame.height - crop.height)).toBeLessThanOrEqual(vectors.tolerance);
  });

  it("has the backend's defaults: high on a picture strictly taller than 1.2, else the middle", () => {
    expect(TALL_RATIO).toBe(vectors.defaults.tallRatio);
    expect(TALL_DEFAULT).toEqual(vectors.defaults.tall);
    expect(CENTRE).toEqual(vectors.defaults.other);
    expect(defaultFocusOf({ width: 1000, height: 1200 })).toEqual(vectors.defaults.other);
    expect(defaultFocusOf({ width: 1000, height: 1201 })).toEqual(vectors.defaults.tall);
  });

  it("takes the focus values the backend takes, and none it refuses", () => {
    for (const value of vectors.focusValues.accepted) {
      if (value === null) continue;
      const { x, y, zoom } = value;
      expect(focusOf(value)).toEqual({ x, y, zoom });
    }
    for (const value of vectors.focusValues.refused) expect(focusOf(value)).toBeNull();
  });
});

describe("frameOf, the SPEC's frame", () => {
  it("takes the largest crop of the frame's shape around the middle", () => {
    expect(frameOf({ width: 1000, height: 500 }, 1, CENTRE)).toEqual({
      left: 250,
      top: 0,
      width: 500,
      height: 500,
    });
    expect(frameOf({ width: 400, height: 800 }, 2, CENTRE)).toEqual({
      left: 0,
      top: 300,
      width: 400,
      height: 200,
    });
  });

  it("puts the focus in the middle, held inside the picture", () => {
    expect(frameOf({ width: 1000, height: 500 }, 1, { x: 0, y: 0.5, zoom: 1 })).toEqual({
      left: 0,
      top: 0,
      width: 500,
      height: 500,
    });
    expect(frameOf({ width: 1000, height: 500 }, 1, { x: 0.7, y: 0.5, zoom: 1 }).left).toBe(450);
  });

  it("zooms in past the largest crop", () => {
    expect(frameOf({ width: 400, height: 800 }, 2, { x: 0.5, y: 0.1, zoom: 2 })).toEqual({
      left: 100,
      top: 30,
      width: 200,
      height: 100,
    });
  });
});

describe("placedBox", () => {
  it("draws the frame filling its box, the picture spilling over by as much", () => {
    expect(placedBox({ width: 1000, height: 500 }, 1, CENTRE)).toEqual({
      left: "-50%",
      top: "0%",
      width: "200%",
      height: "100%",
    });
  });
});

describe("focusOf", () => {
  it("reads a focus in range and nothing else", () => {
    expect(focusOf({ x: 0.2, y: 1, zoom: 4 })).toEqual({ x: 0.2, y: 1, zoom: 4 });
    expect(focusOf({ x: 0.2, y: 1.1, zoom: 1 })).toBeNull();
    expect(focusOf({ x: 0.2, y: 0.5, zoom: 0.5 })).toBeNull();
    expect(focusOf({ x: "0.2", y: 0.5, zoom: 1 })).toBeNull();
    expect(focusOf(null)).toBeNull();
    expect(focusOf(undefined)).toBeNull();
  });

  it("knows the middle as no focus at all", () => {
    expect(isCentre(null)).toBe(true);
    expect(isCentre(CENTRE)).toBe(true);
    expect(isCentre({ x: 0.5, y: 0.5, zoom: 1.2 })).toBe(false);
  });
});

describe("the editor's framing and a focus", () => {
  const picture = { width: 1200, height: 800 };
  const aspect = 4 / 3;

  it("reads the middle as the middle", () => {
    expect(focusOfFraming(CENTRED, picture, aspect)).toEqual(CENTRE);
    expect(framingOfFocus(CENTRE, picture, aspect)).toEqual(CENTRED);
  });

  it("goes there and back for a focus the frame can reach", () => {
    const focus = { x: 0.3, y: 0.45, zoom: 2 };
    expect(
      roundedFocus(focusOfFraming(framingOfFocus(focus, picture, aspect), picture, aspect)),
    ).toEqual(focus);
  });

  it("holds a focus the frame cannot reach where the frame stops, as the frame shows it", () => {
    const back = focusOfFraming(
      framingOfFocus({ x: 0, y: 0.5, zoom: 1 }, picture, aspect),
      picture,
      aspect,
    );
    const frame = frameOf(picture, aspect, back);
    expect(frame.left).toBeCloseTo(0);
    expect(back.x).toBeCloseTo(frame.width / 2 / picture.width);
  });
});
