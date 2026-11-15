import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import vectors from "../lib/coverCropVectors.json";
import type { CoverFocus } from "../lib/coverFocus";
import { CoverAdjust } from "./CoverAdjust";
import { FocusedPicture } from "./FocusedPicture";

/*
 * The coordinator's check (15.11, the fox receipt): a card's tile, a collage
 * cell, a cover and the big view (FocusedPicture) cut the very rectangle the
 * Adjust window's preview of the same shape shows, and both are the shared
 * vectors' crop. Read back from what is drawn: the picture's place in its box.
 */

const HIGH = 90;

interface Case {
  width: number;
  height: number;
  aspect: number;
  focus: CoverFocus | null;
}

/** The part of the picture a box shows, from the picture's inline place in it. */
function cropOf(img: HTMLImageElement, box: { width: number; height: number }, picture: Case) {
  const percent = (value: string) => parseFloat(value) / 100;
  if (img.style.width === "") {
    // No place given: the plain covering picture, its middle.
    const scale = Math.max(box.width / picture.width, box.height / picture.height);
    const w = box.width / scale;
    const h = box.height / scale;
    return { x: (picture.width - w) / 2, y: (picture.height - h) / 2, width: w, height: h };
  }
  const scale = (percent(img.style.width) * box.width) / picture.width;
  return {
    x: (-percent(img.style.left) * box.width) / scale,
    y: (-percent(img.style.top) * box.height) / scale,
    width: box.width / scale,
    height: box.height / scale,
  };
}

function loaded(img: HTMLImageElement, picture: Case) {
  Object.defineProperty(img, "naturalWidth", { value: picture.width });
  Object.defineProperty(img, "naturalHeight", { value: picture.height });
  fireEvent.load(img);
}

describe("every cut picture against the Adjust preview of its shape", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(vectors.cases)("$name", (picture) => {
    const box = { width: HIGH * picture.aspect, height: HIGH };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      ...box,
    } as DOMRect);

    const tile = render(<FocusedPicture src="https://img/p.jpg" focus={picture.focus} />);
    const tileImg = tile.container.querySelector("img")!;
    loaded(tileImg, picture);
    const shown = cropOf(tileImg, box, picture);

    const adjust = render(
      <CoverAdjust
        src="https://img/p.jpg"
        focus={picture.focus}
        previews={[{ label: () => "Shape", aspect: picture.aspect }]}
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    loaded(adjust.getByRole("application").querySelector("img")!, picture);
    const preview = cropOf(
      document.querySelector<HTMLImageElement>(".cover-adjust__preview img")!,
      box,
      picture,
    );

    const near = vectors.tolerance + 0.01;
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(shown[key] - picture.crop[key])).toBeLessThanOrEqual(near);
      expect(Math.abs(preview[key] - shown[key])).toBeLessThanOrEqual(near);
    }
  });
});
