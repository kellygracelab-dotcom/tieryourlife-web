import { useLayoutEffect, useState, type RefObject } from "react";

/** A picture not loaded yet is taken for a poster: two wide for three high. */
const GUESSED_ASPECT = 2 / 3;

/**
 * The width a picture's file has to be, in CSS pixels, to fill its box: a
 * covering picture as wide as its box or as its box's height makes it,
 * whichever is more (a wide picture in a tall tile is wider than the tile);
 * a picture stretched to its box (a focus placed by FocusedPicture) its box.
 */
export function neededWidth(
  box: { width: number; height: number },
  fit: string,
  aspect: number | null,
): number {
  if (fit !== "cover") return box.width;
  return Math.max(box.width, box.height * (aspect ?? GUESSED_ASPECT));
}

const PIXELS = /^\d+(?:\.\d+)?px$/;

/**
 * `sizes` for a picture as it is drawn: `guess` (sizedFor's, for the largest
 * box it is drawn in) until it is laid out, then the width its file needs in
 * the box it has on this window, with its own shape once it has loaded. So a
 * phone's small tile takes a small copy, and a wide picture a wider one
 * (Coordinator, 28.11: the copy that covers the box × density, with cover).
 * A `sizes` with media queries is left as it is.
 */
export function useCoverSizes(
  image: RefObject<HTMLImageElement | null>,
  guess: string | undefined,
): string | undefined {
  const [measured, setMeasured] = useState<string | null>(null);
  const active = guess !== undefined && PIXELS.test(guess);
  useLayoutEffect(() => {
    const element = image.current;
    if (!active || element === null) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!(width > 0 && height > 0)) return;
      const aspect =
        element.naturalWidth > 0 && element.naturalHeight > 0
          ? element.naturalWidth / element.naturalHeight
          : null;
      const fit = getComputedStyle(element).objectFit;
      setMeasured(`${Math.ceil(neededWidth({ width, height }, fit, aspect))}px`);
    };
    measure();
    element.addEventListener("load", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      element.removeEventListener("load", measure);
      observer?.disconnect();
    };
  }, [image, active]);
  return active && measured !== null ? measured : guess;
}
